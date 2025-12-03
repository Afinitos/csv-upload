import { useMemo, useState, useEffect } from "react";
import CsvUploadMapper, { type MappedRow, type ColumnMapping } from "./CsvUploadMapper";

export default function App() {
  // Multiple workbooks support (persisted)
  const WORKBOOKS_KEY = "csvUpload:workbooks";
  const ACTIVE_KEY = "csvUpload:activeIdx";
  const COUNTER_KEY = "csvUpload:workbookCounter";

  const [workbooks, setWorkbooks] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WORKBOOKS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.every((s) => typeof s === "string")) {
          return arr.length > 0 ? (arr as string[]) : ["Assets"];
        }
      }
    } catch {}
    return ["Assets"];
  });

  const [activeIdx, setActiveIdx] = useState(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (raw != null) {
        const idx = Number(raw);
        if (Number.isInteger(idx)) return idx;
      }
    } catch {}
    return 0;
  });

  const activeName = workbooks[activeIdx] ?? "Assets";
  const [rowCount, setRowCount] = useState(0);

  // Persist list + active selection
  useEffect(() => {
    try {
      localStorage.setItem(WORKBOOKS_KEY, JSON.stringify(workbooks));
      localStorage.setItem(ACTIVE_KEY, String(activeIdx));
    } catch {}
  }, [workbooks, activeIdx]);

  // Clamp active index if list shrinks
  useEffect(() => {
    if (activeIdx >= workbooks.length) {
      setActiveIdx(workbooks.length > 0 ? workbooks.length - 1 : 0);
    }
  }, [workbooks]);

  // Storage key is scoped per-workbook so that catalog/mapping can differ
  const storageKey = useMemo(() => `csvUploadFieldCatalog:${activeName}`, [activeName]);

  async function handleSubmit(payload: { rows: MappedRow[]; mapping: ColumnMapping }) {
    try {
      const res = await fetch("http://localhost:8000/api/uploads/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workbook: activeName,
          rows: payload.rows,
          mapping: payload.mapping,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Backend error ${res.status}: ${text}`);
      }
      const saved = await res.json();
      // eslint-disable-next-line no-console
      console.log("Saved to backend:", saved);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to save to backend:", err);
    }
  }

  function addWorkbook() {
    const base = "Workbook";
    // Monotonic counter so names are not reused after delete
    let nextNum: number;
    try {
      const raw = localStorage.getItem(COUNTER_KEY);
      const n = raw != null ? Number(raw) : 0;
      nextNum = Number.isInteger(n) ? n + 1 : 1;
    } catch {
      nextNum = 1;
    }
    let name = `${base} ${nextNum}`;
    const used = new Set(workbooks);
    while (used.has(name)) {
      nextNum++;
      name = `${base} ${nextNum}`;
    }
    try {
      localStorage.setItem(COUNTER_KEY, String(nextNum));
    } catch {}
    setWorkbooks((prev) => {
      const next = [...prev, name];
      setActiveIdx(next.length - 1);
      return next;
    });
  }

  function storageKeyFor(name: string) {
    return `csvUploadFieldCatalog:${name}`;
  }

  function deleteWorkbook(index: number) {
    const name = workbooks[index];
    const prefix = storageKeyFor(name);
    try {
      localStorage.removeItem(prefix);
      localStorage.removeItem(`${prefix}:session`);
    } catch {}
    setWorkbooks((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        const fallback = ["Assets"];
        setActiveIdx(0);
        return fallback;
      }
      // fix active index
      if (activeIdx >= next.length) {
        setActiveIdx(next.length - 1);
      } else if (index < activeIdx) {
        setActiveIdx((i) => Math.max(0, i - 1));
      }
      return next;
    });
  }

  return (
    <div className="cx-app-layout" style={{ height: "100vh" }}>
      {/* Sidebar like screenshot (WORKBOOK) */}
      <aside className="cx-sidebar">
        <div className="cx-sidebar-title">WORKBOOK</div>
        <ul className="cx-sidebar-list">
          {workbooks.map((name, i) => {
            const active = i === activeIdx;
            return (
              <li
                key={name}
                className={`cx-sidebar-item${active ? " active" : ""}`}
                onClick={() => setActiveIdx(i)}
              >
                <i className="fa-solid fa-table-cells-large cx-sidebar-icon" aria-hidden="true"></i>
                <span className="cx-sidebar-name">{name}</span>
                <button
                  className="cx-sidebar-delete"
                  aria-label={`Delete ${name}`}
                  title="Delete workbook"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteWorkbook(i);
                  }}
                >
                  <i className="fa-solid fa-trash" aria-hidden="true"></i>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="cx-btn" style={{ marginTop: 8 }} onClick={addWorkbook}>
          + New workbook
        </button>
      </aside>

      {/* Main content */}
      <main className="cx-content">
        {/* Top tab bar (simple, single tab selected - Assets) */}
        <div className="cx-headerbar">
          <div className="cx-tabs">
            <button className="cx-tab active">{activeName}</button>
          </div>
          {/* Right cluster (icons placeholders + Submit lives in component) */}
          <div className="cx-header-actions">
            <span className="cx-muted">{rowCount} Records</span>
            <div className="cx-sep" />
            <button className="cx-btn">All</button>
            <button className="cx-btn">Valid</button>
            <button className="cx-btn">Invalid</button>
          </div>
        </div>

        {/* CSV Upload + Mapping + Edit */}
        <CsvUploadMapper
          key={activeName}
          expectedColumns={[]}
          onSubmit={handleSubmit}
          onRowCountChange={setRowCount}
          storageKey={storageKey}
        />
      </main>
    </div>
  );
}
