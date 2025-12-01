import { useCallback, useMemo, useState, useEffect, type FC } from "react";
import fieldCatalogData from "./fieldCatalog.json";
import styles from "./CsvUploadMapper.styles";
import type {
  Step,
  ExpectedColumn,
  ColumnMapping,
  MappedRow,
  CellError,
  RowValidation,
  CsvUploadMapperProps,
} from "./CsvUploadMapper.types";
export type {
  Step,
  ExpectedColumn,
  ColumnMapping,
  MappedRow,
  CellError,
  RowValidation,
  CsvUploadMapperProps,
} from "./CsvUploadMapper.types";
export { Validators, defaultAssetColumns } from "./CsvUploadMapper.types";

/**
 * Types
 */

type SavedSession = {
  step?: Step;
  rawCsvText?: string;
  headers?: string[];
  rows?: string[][];
  mapping?: ColumnMapping;
  mappedRows?: MappedRow[];
  rowErrors?: RowValidation[];
  filterMode?: "all" | "valid" | "invalid";
  submitted?: boolean;
};

/**
 * Minimal CSV parser supporting:
 * - Delimiter: comma
 * - Newlines: \n or \r\n
 * - Quoted fields with double-quotes and escaped double-quotes ("")
 * - Trims BOM
 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Auto-detect delimiter between comma (,) and semicolon (;)
  // We scan the first logical line (until newline outside quotes)
  let detectInQuotes = false;
  let commaCount = 0;
  let semiCount = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (detectInQuotes && next === '"') {
        i++;
      } else {
        detectInQuotes = !detectInQuotes;
      }
      continue;
    }
    if (!detectInQuotes) {
      if (ch === ",") commaCount++;
      else if (ch === ";") semiCount++;
      else if (ch === "\n" || ch === "\r") break;
    }
  }
  const delimiter = semiCount > commaCount ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        // Escaped quote
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      // Handle CRLF: if \r and next is \n, skip the \n
      if (char === "\r" && next === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  // Push the last field/row if any content remains
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
}

/**
 * Normalize a header/label string for matching.
 */
function normalizeHeader(s: string): string {
  return s.replace(/[\s_\-]/g, "").toLowerCase();
}

/**
 * Attempt to auto-map CSV headers to expected columns using label/key similarity.
 */
function autoMapColumns(expected: ExpectedColumn[], headers: string[]): ColumnMapping {
  const normalizedHeaderMap = new Map<string, string>();
  headers.forEach((h) => normalizedHeaderMap.set(normalizeHeader(h), h));

  const mapping: ColumnMapping = {};
  for (const col of expected) {
    const candidates = [col.label, col.key];
    let match: string | null = null;
    for (const c of candidates) {
      const normalized = normalizeHeader(c);
      const found = normalizedHeaderMap.get(normalized);
      if (found) {
        match = found;
        break;
      }
    }
    mapping[col.key] = match; // can be null
  }
  return mapping;
}

/**
 * Build mapped rows using the column mapping. Unmapped expected columns become empty strings.
 */
function applyMapping(
  rows: string[][],
  headers: string[],
  expected: ExpectedColumn[],
  mapping: ColumnMapping
): MappedRow[] {
  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => headerIndex.set(h, idx));

  return rows.map((csvRow) => {
    const obj: MappedRow = {};
    for (const col of expected) {
      const header = mapping[col.key];
      const idx = header ? headerIndex.get(header) ?? -1 : -1;
      obj[col.key] = idx >= 0 ? csvRow[idx] ?? "" : "";
    }
    return obj;
  });
}

/**
 * Validate a row against expected columns and per-column validators.
 */
function validateRow(row: MappedRow, expected: ExpectedColumn[]): CellError[] {
  const errors: CellError[] = [];
  for (const col of expected) {
    const value = row[col.key] ?? "";
    if (col.required && (!value || value.trim() === "")) {
      errors.push({ columnKey: col.key, message: `${col.label} is required` });
      continue; // still allow validator to run? Typically skip if empty, required handles it
    }
    if (col.validator) {
      const res = col.validator(value);
      if (res) {
        errors.push({ columnKey: col.key, message: res });
      }
    }
  }
  return errors;
}

/**
 * Styles kept simple inline to keep this component self-contained.
 */

type CatalogField = { key: string; label: string; required?: boolean };

function toKey(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "field";
  const parts = cleaned.split(/\s+/);
  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .join("");
}

function loadCatalogDefault(): CatalogField[] {
  const fromJson = (fieldCatalogData as any)?.fields;
  return Array.isArray(fromJson) ? (fromJson as CatalogField[]) : [];
}

function storageKeyName(custom?: string) {
  return custom && custom.trim().length > 0 ? custom : "csvUploadFieldCatalog";
}

function loadCatalogFromStorage(key: string): CatalogField[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const arr = parsed?.fields;
    return Array.isArray(arr) ? (arr as CatalogField[]) : null;
  } catch {
    return null;
  }
}

/**
 * CsvUploadMapper
 * - Upload CSV
 * - Map CSV headers to expected columns or catalog-based fields
 * - Validate and edit values
 * - Submit to backend via onSubmit callback
 */
export const CsvUploadMapper: FC<CsvUploadMapperProps> = ({
  expectedColumns,
  onSubmit,
  allowSubmitWithErrors = false,
  initialCsvText,
  className,
  style,
  storageKey,
}) => {
  const [step, setStep] = useState<Step>(initialCsvText ? "map" : "upload");
  const [rawCsvText, setRawCsvText] = useState<string>(initialCsvText ?? "");
  const [{ headers, rows }, setParsed] = useState<{ headers: string[]; rows: string[][] }>({
    headers: [],
    rows: [],
  });

  // Mapping state: expected key -> header name (or null)
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Mapped editable rows
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);

  // Validation state
  const [rowErrors, setRowErrors] = useState<RowValidation[]>([]);

  type FilterMode = "all" | "valid" | "invalid";
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  // Field catalog state and header-based mapping
  const STORAGE = storageKeyName(storageKey);
  const SESSION = `${STORAGE}:session`;
  const [catalog, setCatalog] = useState<CatalogField[]>(() => {
    const stored = loadCatalogFromStorage(STORAGE);
    return stored ?? loadCatalogDefault();
  });
  const [headerInclude, setHeaderInclude] = useState<Record<string, boolean>>({});
  const [headerToField, setHeaderToField] = useState<Record<string, string | "__new__">>({});
  const [headerNewName, setHeaderNewName] = useState<Record<string, string>>({});
  const [previewHeader, setPreviewHeader] = useState<string | null>(null);
  const creationAllowed = catalog.length === 0;
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState(true);

  // Parse CSV when initialCsvText provided
  useEffect(() => {
    if (initialCsvText) {
      const parsed = parseCsv(initialCsvText);
      setParsed(parsed);
      const auto = autoMapColumns(expectedColumns, parsed.headers);
      setMapping(auto);
      setStep("map");
    }
  }, [initialCsvText, expectedColumns]);

  // Hydrate saved session per-workbook
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION);
      if (!raw) return;
      const s: SavedSession = JSON.parse(raw);
      if (s.step) setStep(s.step);
      if (typeof s.rawCsvText === "string") setRawCsvText(s.rawCsvText);
      setParsed({ headers: s.headers ?? [], rows: s.rows ?? [] });
      setMapping(s.mapping ?? {});
      setMappedRows(s.mappedRows ?? []);
      setRowErrors(s.rowErrors ?? []);
      if (s.filterMode) setFilterMode(s.filterMode);
      if (typeof s.submitted === "boolean") setSubmitted(s.submitted);
    } catch {}
  }, [SESSION]);

  // Initialize header mapping when headers change
  useEffect(() => {
    if (headers.length === 0) return;
    const inc: Record<string, boolean> = {};
    const h2f: Record<string, string | "__new__"> = {};
    const newNames: Record<string, string> = {};
    headers.forEach((h) => {
      inc[h] = headerInclude[h] ?? true;
      const norm = normalizeHeader(h);
      const match = catalog.find(
        (f) => normalizeHeader(f.label) === norm || normalizeHeader(f.key) === norm
      );
      if (match) {
        h2f[h] = match.key;
      } else {
        h2f[h] = creationAllowed ? "__new__" : "";
        newNames[h] = newNames[h] ?? h;
      }
    });
    setHeaderInclude((prev) => ({ ...inc, ...prev }));
    setHeaderToField((prev) => ({ ...h2f, ...prev }));
    setHeaderNewName((prev) => ({ ...newNames, ...prev }));
  }, [headers, catalog, creationAllowed]);

  // Persist session per-workbook
  useEffect(() => {
    try {
      const data: SavedSession = {
        step,
        rawCsvText,
        headers,
        rows,
        mapping,
        mappedRows,
        rowErrors,
        filterMode,
        submitted,
      };
      localStorage.setItem(SESSION, JSON.stringify(data));
    } catch {}
  }, [
    SESSION,
    step,
    rawCsvText,
    headers,
    rows,
    mapping,
    mappedRows,
    rowErrors,
    filterMode,
    submitted,
  ]);

  // If expectedColumns is provided (tests rely on it), use that path.
  // Otherwise (e.g., App wants no predefined columns), derive columns from CSV headers + catalog.
  const displayColumns = useMemo<ExpectedColumn[] | null>(() => {
    if ((expectedColumns ?? []).length > 0) return null;
    const includedHeaders = headers.filter((h) => headerInclude[h]);
    if (includedHeaders.length === 0) return null;
    const cols: ExpectedColumn[] = [];
    const usedKeys = new Set<string>();
    for (const h of includedHeaders) {
      const sel = headerToField[h];
      if (!sel) continue;
      if (sel === "__new__") {
        const name = headerNewName[h] || h;
        const key = toKey(name);
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        cols.push({ key, label: name });
      } else {
        const cat = catalog.find((c) => c.key === sel);
        if (!cat) continue;
        if (usedKeys.has(cat.key)) continue;
        usedKeys.add(cat.key);
        cols.push({ key: cat.key, label: cat.label, required: cat.required });
      }
    }
    return cols.length > 0 ? cols : null;
  }, [expectedColumns, headers, headerInclude, headerToField, headerNewName, catalog]);

  // Save any new fields chosen in mapping into catalog (localStorage)
  const saveCatalog = useCallback(() => {
    const newOnes: CatalogField[] = [];
    for (const h of headers) {
      if (!headerInclude[h]) continue;
      const sel = headerToField[h];
      if (sel === "__new__") {
        const name = headerNewName[h] || h;
        const key = toKey(name);
        if (!catalog.find((c) => c.key === key)) {
          newOnes.push({ key, label: name });
        }
      }
    }
    if (newOnes.length === 0) return;
    const merged = [...catalog, ...newOnes];
    setCatalog(merged);
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ fields: merged }));
    } catch {}
  }, [headers, headerInclude, headerToField, headerNewName, catalog, STORAGE]);

  const readFileText = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await readFileText(file);
      setRawCsvText(text);
      const parsed = parseCsv(text);
      setParsed(parsed);
      const auto = autoMapColumns(expectedColumns, parsed.headers);
      setMapping(auto);
      setStep("map");
    },
    [readFileText, expectedColumns]
  );

  const requiredColumnsUnmapped = useMemo(() => {
    return expectedColumns.filter((c) => c.required && !mapping[c.key]);
  }, [expectedColumns, mapping]);

  const handleApplyMapping = useCallback(() => {
    // Determine which columns to use: header-based mapping if available, else expectedColumns mapping
    const cols: ExpectedColumn[] = displayColumns ?? expectedColumns;

    // Build column mapping: key -> header
    const revMap: Record<string, string | null> = {};
    if (displayColumns) {
      // derive from header selection
      for (const h of headers) {
        if (!headerInclude[h]) continue;
        const sel = headerToField[h];
        if (!sel) continue;
        const key = sel === "__new__" ? toKey(headerNewName[h] || h) : sel;
        if (key && revMap[key] == null) {
          revMap[key] = h;
        }
      }
    } else {
      // use existing expected mapping state
      for (const col of expectedColumns) {
        revMap[col.key] = mapping[col.key] ?? null;
      }
    }

    const colMapping: ColumnMapping = {};
    cols.forEach((c) => {
      colMapping[c.key] = revMap[c.key] ?? null;
    });

    // keep mapping state in sync (used by onSubmit)
    setMapping(colMapping);

    const mRows = applyMapping(rows, headers, cols, colMapping);
    setMappedRows(mRows);

    // Validate all
    const errs = mRows.map((r, idx) => ({
      rowIndex: idx,
      errors: validateRow(r, cols),
    }));
    setRowErrors(errs);
    setStep("edit");
  }, [
    rows,
    headers,
    expectedColumns,
    mapping,
    displayColumns,
    headerInclude,
    headerToField,
    headerNewName,
  ]);

  const invalidCount = useMemo(() => {
    return rowErrors.reduce((acc, r) => acc + r.errors.length, 0);
  }, [rowErrors]);

  const invalidRowCount = useMemo(() => {
    return rowErrors.filter((r) => r.errors.length > 0).length;
  }, [rowErrors]);

  const validRowCount = useMemo(() => {
    return rowErrors.length - invalidRowCount;
  }, [rowErrors, invalidRowCount]);

  const anyUnmappedRequired = requiredColumnsUnmapped.length > 0;

  const visibleRowIndexes = useMemo(() => {
    const all = mappedRows.map((_, idx) => idx);
    if (filterMode === "invalid") {
      const set = new Set(rowErrors.filter((r) => r.errors.length > 0).map((r) => r.rowIndex));
      return all.filter((idx) => set.has(idx));
    }
    if (filterMode === "valid") {
      const set = new Set(rowErrors.filter((r) => r.errors.length === 0).map((r) => r.rowIndex));
      return all.filter((idx) => set.has(idx));
    }
    return all;
  }, [mappedRows, rowErrors, filterMode]);

  const updateCell = useCallback(
    (rowIndex: number, columnKey: string, value: string) => {
      if (submitted) return;
      setMappedRows((prev) => {
        const copy = [...prev];
        copy[rowIndex] = { ...copy[rowIndex], [columnKey]: value };
        return copy;
      });
      setRowErrors((prev) => {
        const copy = [...prev];
        const row = { ...mappedRows[rowIndex], [columnKey]: value };
        copy[rowIndex] = { rowIndex, errors: validateRow(row, expectedColumns) };
        return copy;
      });
    },
    [expectedColumns, mappedRows, submitted]
  );

  const handleSubmit = useCallback(async () => {
    if (!allowSubmitWithErrors && invalidCount > 0) {
      return;
    }
    await onSubmit({ rows: mappedRows, mapping });
    setSubmitted(true);
  }, [allowSubmitWithErrors, invalidCount, onSubmit, mappedRows, mapping]);

  const resetToUpload = useCallback(() => {
    setStep("upload");
    setRawCsvText("");
    setParsed({ headers: [], rows: [] });
    setMapping({});
    setMappedRows([]);
    setRowErrors([]);
    setFilterMode("all");
    try {
      localStorage.removeItem(SESSION);
    } catch {}
  }, [SESSION]);

  const canContinue = useMemo(() => {
    if (displayColumns && displayColumns.length > 0) return true;
    return !anyUnmappedRequired;
  }, [displayColumns, anyUnmappedRequired]);

  return (
    <div
      className={className}
      style={{ ...styles.container, ...style }}
      data-testid="csv-upload-mapper"
    >
      {step === "upload" && (
        <div className="cx-page">
          <div className="cx-panel" style={{ textAlign: "center", padding: 32 }}>
            <div className="cx-h1" style={{ marginBottom: 8 }}>
              Import
            </div>
            <div className="cx-subtle" style={{ marginBottom: 16 }}>
              Drag and drop or upload a file to get started
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={async (e) => {
                e.preventDefault();
                const files = e.dataTransfer?.files;
                if (!files || files.length === 0) return;
                const file = files[0];
                const text = await readFileText(file);
                setRawCsvText(text);
                const parsed = parseCsv(text);
                setParsed(parsed);
                const auto = autoMapColumns(expectedColumns, parsed.headers);
                setMapping(auto);
                setStep("map");
              }}
              style={{
                border: "2px dashed var(--border)",
                borderRadius: 12,
                padding: 24,
                background: "#fff",
                marginBottom: 16,
              }}
            >
              <div className="cx-subtle">Drop CSV here</div>
            </div>

            <input
              id="upload-input"
              data-testid="file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <label htmlFor="upload-input">
                <span className="cx-btn cx-btn-big cx-btn-outline" role="button">
                  <svg
                    className="cx-btn-icon"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M3 16.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 3 16.5Zm0 3a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 19.5Zm9.72-15.28a.75.75 0 0 1 1.06 0l3.97 3.97a.75.75 0 1 1-1.06 1.06l-2.69-2.69V15a.75.75 0 0 1-1.5 0V6.56L9.78 9.25a.75.75 0 1 1-1.06-1.06l3.97-3.97ZM18.75 12a.75.75 0 0 1 .75.75V18a3 3 0 0 1-3 3H9.5a3 3 0 0 1-3-3v-1.25a.75.75 0 0 1 1.5 0V18a1.5 1.5 0 0 0 1.5 1.5h7.25A1.5 1.5 0 0 0 18.75 18v-5.25a.75.75 0 0 1 .75-.75Z" />
                  </svg>
                  Upload file
                </span>
              </label>
              <button
                className="cx-btn cx-btn-big cx-btn-outline"
                onClick={() => {
                  setParsed({ headers: [], rows: [] });
                  setStep("map");
                }}
              >
                <svg
                  className="cx-btn-icon"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M16.862 4.487a1.5 1.5 0 0 1 2.121 2.121l-9.9 9.9a3 3 0 0 1-1.272.757l-2.7.772a.75.75 0 0 1-.927-.927l.772-2.7a3 3 0 0 1 .757-1.272l9.9-9.9Zm-2.1-.439-9.9 9.9a1.5 1.5 0 0 0-.379.636l-.5 1.752 1.752-.5a1.5 1.5 0 0 0 .636-.379l9.9-9.9-1.509-1.509Z" />
                </svg>
                Manually enter data
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "map" && (
        <div style={styles.panel}>
          <div style={styles.header}>2. Map CSV columns to expected fields</div>
          {headers.length === 0 ? (
            <div style={{ color: "#d32f2f" }}>No headers detected. Check your CSV file.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Top actions like screenshots */}
              <div className="cx-topbar">
                <button className="cx-btn" onClick={resetToUpload}>
                  Exit
                </button>
                <button className="cx-btn" onClick={() => setStep("upload")}>
                  Back
                </button>
                <button
                  className="cx-btn cx-btn-primary"
                  onClick={handleApplyMapping}
                  disabled={!canContinue}
                  data-testid="apply-mapping"
                >
                  Continue
                </button>
              </div>

              {/* Styled two-column layout */}
              <div className="cx-map-layout">
                {/* Left: mapping rows */}
                <div className="cx-map-left">
                  <div className="cx-map-head">
                    <div className="cx-map-title">Review and confirm each mapping choice</div>
                    <div className="cx-counters">
                      <div>
                        INCOMING FIELDS{" "}
                        <strong>{headers.filter((h) => headerInclude[h]).length}</strong> of{" "}
                        <strong>{headers.length}</strong>
                      </div>
                      <div>
                        DESTINATION FIELDS{" "}
                        <strong>{(displayColumns ?? expectedColumns).length}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="cx-map-rows">
                    {headers.map((h) => {
                      const sel = headerToField[h] ?? (catalog.length === 0 ? "__new__" : "");
                      const included = headerInclude[h] ?? true;
                      return (
                        <div
                          key={h}
                          className="cx-map-row"
                          onMouseEnter={() => setPreviewHeader(h)}
                        >
                          <div className="cx-chip">{h}</div>
                          <div className="cx-arrow">→</div>
                          <div>
                            <select
                              className="cx-select"
                              value={sel}
                              onChange={(e) =>
                                setHeaderToField((prev) => ({ ...prev, [h]: e.target.value }))
                              }
                              disabled={!included}
                            >
                              {catalog.length === 0 ? (
                                <option value="__new__">Create new…</option>
                              ) : null}
                              {catalog.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                              {!catalog.length && <></>}
                            </select>
                            {sel === "__new__" && catalog.length === 0 ? (
                              <input
                                className="cx-input"
                                style={{ marginTop: 6 }}
                                value={headerNewName[h] ?? h}
                                onChange={(e) =>
                                  setHeaderNewName((prev) => ({ ...prev, [h]: e.target.value }))
                                }
                                placeholder="Field name (suggested from CSV header)"
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {catalog.length === 0 ? (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <button className="cx-btn" onClick={saveCatalog}>
                        Save selected fields to catalog
                      </button>
                      <span className="cx-muted">
                        New fields are stored locally (browser localStorage). Existing fields are
                        offered for reuse next time.
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Right: preview card */}
                <div className="cx-map-right">
                  <div className="cx-card">
                    <div className="cx-card-title">
                      Data preview for{" "}
                      {previewHeader ?? headers.find((h) => headerInclude[h]) ?? headers[0] ?? "—"}
                    </div>
                    <ul className="cx-list">
                      {(() => {
                        const h =
                          previewHeader ?? headers.find((x) => headerInclude[x]) ?? headers[0];
                        if (!h) return null;
                        const idx = headers.indexOf(h);
                        return (rows.length > 0 ? rows.slice(0, 9) : []).map((r, i) => (
                          <li key={i}>{idx >= 0 ? r[idx] ?? "" : ""}</li>
                        ));
                      })()}
                      {rows.length === 0 ? <li>No data</li> : null}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Existing mapping by expected columns */}
              {expectedColumns.map((col) => (
                <div key={col.key} style={styles.row}>
                  <label style={{ minWidth: 220, fontWeight: 500 }} htmlFor={`map-${col.key}`}>
                    {col.label} {col.required ? <span style={{ color: "#d32f2f" }}>*</span> : null}
                  </label>
                  <select
                    id={`map-${col.key}`}
                    style={styles.select}
                    value={mapping[col.key] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      setMapping((prev) => ({ ...prev, [col.key]: val }));
                    }}
                    data-testid={`mapping-select-${col.key}`}
                  >
                    <option value="">-- Unmapped --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {!mapping[col.key] && col.required ? (
                    <span style={styles.badgeError}>Required</span>
                  ) : null}
                </div>
              ))}

              {/* New: mapping by CSV headers to catalog or new fields (legacy table hidden) */}
              <div style={{ display: "none" }}>
                <div style={styles.header}>
                  Map by CSV header (choose existing field or create new)
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Include</th>
                        <th style={styles.th}>CSV Header</th>
                        <th style={styles.th}>Map to</th>
                        <th style={styles.th}>New field name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headers.map((h) => {
                        const sel = headerToField[h] ?? "__new__";
                        const included = headerInclude[h] ?? true;
                        return (
                          <tr key={h}>
                            <td style={styles.td}>
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={(e) =>
                                  setHeaderInclude((prev) => ({ ...prev, [h]: e.target.checked }))
                                }
                              />
                            </td>
                            <td style={{ ...styles.td, fontWeight: 500 }}>{h}</td>
                            <td style={styles.td}>
                              <select
                                value={sel}
                                onChange={(e) =>
                                  setHeaderToField((prev) => ({ ...prev, [h]: e.target.value }))
                                }
                                style={styles.select}
                              >
                                {creationAllowed ? (
                                  <option value="__new__">Create new…</option>
                                ) : null}
                                {catalog.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={styles.td}>
                              {sel === "__new__" && creationAllowed ? (
                                <input
                                  style={styles.input}
                                  value={headerNewName[h] ?? h}
                                  onChange={(e) =>
                                    setHeaderNewName((prev) => ({ ...prev, [h]: e.target.value }))
                                  }
                                  placeholder="Field name (suggested from CSV header)"
                                />
                              ) : (
                                <span style={{ color: "#666" }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {creationAllowed ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button style={styles.button} onClick={saveCatalog}>
                      Save selected fields to catalog
                    </button>
                    <span style={{ color: "#666", fontSize: 12 }}>
                      New fields are stored locally (browser localStorage). Existing fields are
                      offered for reuse.
                    </span>
                  </div>
                ) : null}
              </div>

              {/* CSV preview (legacy table hidden) */}
              <div style={{ display: "none" }}>
                <div style={styles.header}>CSV preview</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h} style={styles.th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(rows.length > 0 ? rows.slice(0, 10) : []).map((r, i) => (
                        <tr key={i}>
                          {headers.map((_, j) => (
                            <td key={j} style={styles.td}>
                              {r[j] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td style={styles.td} colSpan={headers.length}>
                            No rows
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                  Showing first {Math.min(rows.length, 10)} of {rows.length} row(s)
                </div>
              </div>

              <div style={{ display: "none" }} />
            </div>
          )}
        </div>
      )}

      {step === "edit" && (
        <div style={styles.panel}>
          <div style={styles.header}>3. Validate and edit data</div>
          <div className="cx-subtle">
            {invalidRowCount > 0 ? `${invalidRowCount} validation issue(s)` : "All rows valid"}
          </div>
          <div className="cx-topbar" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="cx-btn"
                onClick={() => setFilterMode("all")}
                aria-pressed={filterMode === "all"}
              >
                All ({rowErrors.length})
              </button>
              <button
                className="cx-btn"
                onClick={() => setFilterMode("valid")}
                aria-pressed={filterMode === "valid"}
              >
                Valid ({validRowCount})
              </button>
              <button
                className="cx-btn"
                onClick={() => setFilterMode("invalid")}
                aria-pressed={filterMode === "invalid"}
                style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
              >
                Invalid ({invalidRowCount})
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={filterMode === "invalid"}
                  onChange={(e) => setFilterMode(e.target.checked ? "invalid" : "all")}
                  aria-label="Show invalid rows only"
                />
                <span>Show invalid rows only</span>
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={editing}
                  onChange={(e) => setEditing(e.target.checked)}
                  aria-label="Enable editing"
                />
                <span>Enable editing</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="cx-btn" onClick={() => setStep("map")} disabled={submitted}>
                Back
              </button>
              {submitted ? (
                <button className="cx-btn" disabled>
                  Submitted
                </button>
              ) : (
                <button
                  className="cx-btn cx-btn-primary"
                  onClick={handleSubmit}
                  disabled={invalidRowCount > 0 && !allowSubmitWithErrors}
                  data-testid="submit-button"
                >
                  Submit
                </button>
              )}
            </div>
          </div>

          <div className="cx-sheet">
            <table className="cx-table">
              <thead>
                <tr>
                  <th className="cx-th">#</th>
                  {(displayColumns ?? expectedColumns).map((col) => (
                    <th key={col.key} className="cx-th">
                      {col.label}{" "}
                      {col.required ? <span style={{ color: "var(--primary)" }}>*</span> : null}
                    </th>
                  ))}
                  <th className="cx-th">Errors</th>
                </tr>
              </thead>
              <tbody>
                {visibleRowIndexes.map((idx) => {
                  const row = mappedRows[idx];
                  const errors = rowErrors[idx]?.errors ?? [];
                  const errorByCol = new Map(errors.map((e) => [e.columnKey, e.message]));
                  return (
                    <tr key={idx}>
                      <td className="cx-td">{idx + 1}</td>
                      {(displayColumns ?? expectedColumns).map((col) => {
                        const errMsg = errorByCol.get(col.key);
                        return (
                          <td key={col.key} className="cx-td">
                            <input
                              className={`cx-cell${errMsg ? " invalid" : ""}`}
                              value={row[col.key] ?? ""}
                              onChange={(e) => updateCell(idx, col.key, e.target.value)}
                              data-testid={`cell-${idx}-${col.key}`}
                              disabled={!editing}
                            />
                          </td>
                        );
                      })}
                      <td className="cx-td">
                        {errors.length > 0 ? (
                          <ul className="cx-error-list">
                            {errors.map((e, i) => (
                              <li key={i}>
                                {(displayColumns ?? expectedColumns).find(
                                  (c) => c.key === e.columnKey
                                )?.label ?? e.columnKey}
                                : {e.message}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="cx-muted">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleRowIndexes.length === 0 && (
                  <tr>
                    <td className="cx-td" colSpan={(displayColumns ?? expectedColumns).length + 2}>
                      No rows to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "none" }} />
        </div>
      )}
    </div>
  );
};

export default CsvUploadMapper;

/**
 * Example validators you can reuse.
 */

/**
 * Helper to build a common expectedColumns config for "Asset ID" and "Unique Identifier"
 */
