import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import CsvUploadMapper, { type MappedRow, type ColumnMapping } from "./CsvUploadMapper";

export default function App() {
  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
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

  // Ask DB modal state
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askSql, setAskSql] = useState<string | null>(null);
  const [askRows, setAskRows] = useState<any[] | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await fetch(`${API_BASE}/api/ask/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        // Try to show backend-provided detail if it's JSON.
        try {
          const j = JSON.parse(text);
          throw new Error(j?.detail ? String(j.detail) : `Ask failed (${res.status})`);
        } catch {
          throw new Error(text || `Ask failed (${res.status})`);
        }
      }
      return JSON.parse(text) as { sql: string; rows: any[] };
    },
    onMutate: () => {
      setAskError(null);
      setAskSql(null);
      setAskRows(null);
    },
    onSuccess: (data) => {
      setAskSql(data.sql);
      setAskRows(Array.isArray(data.rows) ? data.rows : []);
    },
    onError: (err) => {
      setAskError(err instanceof Error ? err.message : String(err));
    },
  });

  function closeAsk() {
    setIsAskOpen(false);
  }

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

  const uploadMutation = useMutation({
    mutationFn: async (payload: { rows: MappedRow[]; mapping: ColumnMapping }) => {
      const res = await fetch(`${API_BASE}/api/uploads/`, {
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
      return res.json();
    },
    retry: 2,
  });

  const uploadsQuery = useQuery({
    queryKey: ["uploads", activeName, 0, 10],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/uploads/?limit=10&offset=0&workbook=${encodeURIComponent(activeName)}`
      );
      if (!res.ok) throw new Error(`Failed to load uploads: ${res.status}`);
      const items = await res.json();
      const total = Number(res.headers.get("X-Total-Count") ?? items.length);
      return { items, total } as { items: any[]; total: number };
    },
  });

  async function handleSubmit(payload: { rows: MappedRow[]; mapping: ColumnMapping }) {
    await uploadMutation.mutateAsync(payload);
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
            <span className="cx-muted">
              {uploadsQuery.isLoading
                ? "Loading uploads…"
                : `Saved uploads: ${uploadsQuery.data?.total ?? 0}`}
            </span>

            <div className="cx-sep" />
            <button
              className="cx-btn"
              onClick={() => {
                setIsAskOpen(true);
                setAskQuestion("");
                setAskSql(null);
                setAskRows(null);
                setAskError(null);
              }}
            >
              Ask DB
            </button>
          </div>
        </div>

        {/* CSV Upload + Mapping + Edit */}
        <CsvUploadMapper
          key={activeName}
          expectedColumns={[]}
          onSubmit={handleSubmit}
          onRowCountChange={setRowCount}
          storageKey={storageKey}
          submitting={uploadMutation.isPending}
          submitError={
            uploadMutation.isError
              ? uploadMutation.error instanceof Error
                ? uploadMutation.error.message
                : String(uploadMutation.error)
              : null
          }
        />

        {/* Ask DB modal */}
        {isAskOpen && (
          <div className="cx-modal-backdrop" onClick={closeAsk} role="dialog" aria-modal="true">
            <div className="cx-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cx-modal-header">
                <div className="cx-modal-title">Ask database</div>
                <button className="cx-modal-close" onClick={closeAsk} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="cx-modal-body">
                <label className="cx-label">Question</label>
                <textarea
                  className="cx-textarea"
                  rows={3}
                  value={askQuestion}
                  placeholder="eg. How many uploads are there?"
                  onChange={(e) => setAskQuestion(e.target.value)}
                />

                <div className="cx-modal-actions">
                  <button
                    className="cx-btn"
                    type="button"
                    disabled={askMutation.isPending || !askQuestion.trim()}
                    onClick={() => askMutation.mutate(askQuestion.trim())}
                  >
                    {askMutation.isPending ? "Asking…" : "Submit"}
                  </button>
                  <button className="cx-btn cx-btn-secondary" onClick={closeAsk}>
                    Close
                  </button>
                </div>

                {askError && <div className="cx-error">{askError}</div>}

                {askSql && (
                  <div className="cx-block">
                    <div className="cx-block-title">Generated SQL</div>
                    <pre className="cx-pre">{askSql}</pre>
                  </div>
                )}

                {askRows && (
                  <div className="cx-block">
                    <div className="cx-block-title">Result</div>
                    {askRows.length === 0 ? (
                      <div className="cx-muted">No rows returned.</div>
                    ) : (
                      <div className="cx-table-wrap">
                        <table className="cx-table">
                          <thead>
                            <tr>
                              {Object.keys(askRows[0] ?? {}).map((k) => (
                                <th key={k}>{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {askRows.slice(0, 50).map((row, idx) => (
                              <tr key={idx}>
                                {Object.keys(askRows[0] ?? {}).map((k) => (
                                  <td key={k}>{String((row as any)?.[k] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {askRows.length > 50 && (
                          <div className="cx-muted" style={{ marginTop: 6 }}>
                            Showing first 50 rows.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
