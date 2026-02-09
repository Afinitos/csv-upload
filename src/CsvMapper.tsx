import { useCallback, useMemo, useState, useEffect, type FC } from "react";
import fieldCatalogData from "./fieldCatalog.json";
import type { CsvSchema, ColumnRule } from "./schemas/types";
import type {
  Step,
  ExpectedColumn,
  ColumnMapping,
  MappedRow,
  CellError,
  RowValidation,
  CsvMapperProps,
} from "./CsvMapper.types";
export type {
  Step,
  ExpectedColumn,
  ColumnMapping,
  MappedRow,
  CellError,
  RowValidation,
  CsvMapperProps,
} from "./CsvMapper.types";
export { Validators, defaultAssetColumns } from "./CsvMapper.types";

type SavedSession = {
  step?: Step;
  headers?: string[];
  rows?: string[][];
  mapping?: ColumnMapping;
  mappedRows?: MappedRow[];
  rowErrors?: RowValidation[];
  filterMode?: "all" | "valid" | "invalid";
  submitted?: boolean;
};

function normalizeHeader(s: string): string {
  return s.replace(/[\s_\-]/g, "").toLowerCase();
}

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
    mapping[col.key] = match;
  }
  return mapping;
}

function detectBestSchemaId(schemas: CsvSchema[], headers: string[]): string | null {
  if (schemas.length === 0 || headers.length === 0) return null;
  const normalizedHeaders = new Set(headers.map((h) => normalizeHeader(h)));
  let bestId: string | null = null;
  let bestScore = -1;
  let bestRequiredMatches = -1;

  schemas.forEach((schema) => {
    if (!schema.columns || schema.columns.length === 0) return;
    let score = 0;
    let requiredMatches = 0;
    schema.columns.forEach((col) => {
      const candidates = [col.label, col.key];
      const matched = candidates.some((c) => normalizedHeaders.has(normalizeHeader(c)));
      if (matched) {
        score += 1;
        if (col.required) requiredMatches += 1;
      }
    });
    if (score > bestScore || (score === bestScore && requiredMatches > bestRequiredMatches)) {
      bestScore = score;
      bestRequiredMatches = requiredMatches;
      bestId = schema.id;
    }
  });

  if (bestScore <= 0) return null;
  return bestId;
}

function applyMapping(
  rows: string[][],
  headers: string[],
  expected: ExpectedColumn[],
  mapping: ColumnMapping,
): MappedRow[] {
  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => headerIndex.set(h, idx));

  return rows.map((csvRow) => {
    const obj: MappedRow = {};
    for (const col of expected) {
      const header = mapping[col.key];
      const idx = header ? (headerIndex.get(header) ?? -1) : -1;
      obj[col.key] = idx >= 0 ? (csvRow[idx] ?? "") : "";
    }
    return obj;
  });
}

function validateRow(row: MappedRow, expected: ExpectedColumn[]): CellError[] {
  const errors: CellError[] = [];
  for (const col of expected) {
    const value = row[col.key] ?? "";
    if (col.required && (!value || value.trim() === "")) {
      errors.push({ columnKey: col.key, message: `${col.label} is required` });
      continue;
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

function ruleToValidator(label: string, rule: ColumnRule): (value: string) => string | null {
  if (rule.type === "regex") {
    const re = new RegExp(rule.pattern);
    return (v: string) =>
      v.trim() === "" ? null : re.test(v) ? null : (rule.message ?? `${label} is invalid`);
  }
  if (rule.type === "enum") {
    const set = new Set(rule.values);
    return (v: string) =>
      v.trim() === ""
        ? null
        : set.has(v)
          ? null
          : (rule.message ?? `${label} must be one of ${rule.values.join(", ")}`);
  }
  return () => null;
}

function schemaToExpectedColumns(schema: CsvSchema): ExpectedColumn[] {
  return schema.columns.map((c) => {
    const base: ExpectedColumn = {
      key: c.key,
      label: c.label,
      required: c.required,
    };
    if (!c.rules || c.rules.length === 0) return base;
    const validators = c.rules.map((r) => ruleToValidator(c.label, r));
    return {
      ...base,
      validator: (v) => {
        for (const fn of validators) {
          const msg = fn(v);
          if (msg) return msg;
        }
        return null;
      },
    };
  });
}

type CatalogField = { key: string; label: string; required?: boolean };

function toKey(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "field";
  const parts = cleaned.split(/\s+/);
  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
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

export const CsvMapper: FC<CsvMapperProps> = ({
  schema,
  headers: initialHeaders,
  rows: initialRows,
  onSubmit,
  onRowCountChange,
  allowSubmitWithErrors = false,
  onReset,
  className,
  style,
  storageKey,
  submitting = false,
  submitError = null,
}) => {
  const effectiveExpectedColumns = useMemo<ExpectedColumn[]>(() => {
    return schemaToExpectedColumns(schema);
  }, [schema]);

  const [step, setStep] = useState<Step>("map");
  const [headers] = useState<string[]>(initialHeaders);
  const [rows] = useState<string[][]>(initialRows);

  const [mapping, setMapping] = useState<ColumnMapping>({});

  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);

  const [rowErrors, setRowErrors] = useState<RowValidation[]>([]);

  useEffect(() => {
    onRowCountChange?.(mappedRows.length);
  }, [mappedRows, onRowCountChange]);

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
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(200);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    columnKey: string;
  } | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);

  useEffect(() => {
    const auto = autoMapColumns(effectiveExpectedColumns, headers);
    setMapping(auto);
  }, [effectiveExpectedColumns, headers]);

  useEffect(() => {
    if (headers.length === 0) return;
    const inc: Record<string, boolean> = {};
    const h2f: Record<string, string | "__new__"> = {};
    const newNames: Record<string, string> = {};
    headers.forEach((h) => {
      inc[h] = headerInclude[h] ?? true;
      const norm = normalizeHeader(h);
      const match = catalog.find(
        (f) => normalizeHeader(f.label) === norm || normalizeHeader(f.key) === norm,
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

  useEffect(() => {
    try {
      const data: SavedSession = {
        step,
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
  }, [SESSION, step, headers, rows, mapping, mappedRows, rowErrors, filterMode, submitted]);

  const displayColumns = useMemo<ExpectedColumn[] | null>(() => {
    if ((effectiveExpectedColumns ?? []).length > 0) return null;
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
  }, [effectiveExpectedColumns, headers, headerInclude, headerToField, headerNewName, catalog]);

  const requiredColumnsUnmapped = useMemo(() => {
    return effectiveExpectedColumns.filter((c) => c.required && !mapping[c.key]);
  }, [effectiveExpectedColumns, mapping]);

  const handleApplyMapping = useCallback(() => {
    const cols: ExpectedColumn[] = displayColumns ?? effectiveExpectedColumns;

    const revMap: Record<string, string | null> = {};
    if (displayColumns) {
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
      for (const col of effectiveExpectedColumns) {
        revMap[col.key] = mapping[col.key] ?? null;
      }
    }

    const colMapping: ColumnMapping = {};
    cols.forEach((c) => {
      colMapping[c.key] = revMap[c.key] ?? null;
    });

    setMapping(colMapping);

    const mRows = applyMapping(rows, headers, cols, colMapping);
    setMappedRows(mRows);

    const errs = mRows.map((r, idx) => ({
      rowIndex: idx,
      errors: validateRow(r, cols),
    }));
    setRowErrors(errs);
    setStep("edit");
  }, [
    rows,
    headers,
    effectiveExpectedColumns,
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

  const filteredRowIndexes = useMemo(() => {
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

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredRowIndexes.length / pageSize));
  }, [filteredRowIndexes.length, pageSize]);

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [pageIndex, totalPages]);

  const visibleRowIndexes = useMemo(() => {
    const start = pageIndex * pageSize;
    const end = start + pageSize;
    return filteredRowIndexes.slice(start, end);
  }, [filteredRowIndexes, pageIndex, pageSize]);

  const allVisibleSelected = useMemo(() => {
    return (
      filteredRowIndexes.length > 0 && filteredRowIndexes.every((idx) => selectedRows.has(idx))
    );
  }, [filteredRowIndexes, selectedRows]);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredRowIndexes.forEach((idx) => next.delete(idx));
      } else {
        filteredRowIndexes.forEach((idx) => next.add(idx));
      }
      return next;
    });
  }, [allVisibleSelected, filteredRowIndexes]);

  const toggleRowSelected = useCallback((idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const updateCellValue = useCallback(
    (rowIndex: number, columnKey: string, value: string) => {
      setMappedRows((prev) => {
        const updated = [...prev];
        updated[rowIndex] = { ...updated[rowIndex], [columnKey]: value };
        return updated;
      });

      setRowErrors((prev) => {
        const updated = [...prev];
        const rowData = { ...mappedRows[rowIndex], [columnKey]: value };
        const errors = validateRow(rowData, effectiveExpectedColumns);
        updated[rowIndex] = { rowIndex, errors };
        return updated;
      });
    },
    [mappedRows, effectiveExpectedColumns],
  );

  const deleteSelectedColumnValues = useCallback(() => {
    if (!selectedColumn) return;

    const rowsToClear = selectedRows.size > 0 ? new Set(selectedRows) : new Set(filteredRowIndexes);

    setMappedRows((prev) => {
      return prev.map((row, idx) => {
        if (rowsToClear.has(idx)) {
          return {
            ...row,
            [selectedColumn]: "",
          };
        }
        return row;
      });
    });

    setRowErrors((prev) => {
      return prev.map((rowErr, idx) => {
        if (rowsToClear.has(idx)) {
          const rowData = { ...mappedRows[idx], [selectedColumn]: "" };
          const errors = validateRow(rowData, effectiveExpectedColumns);
          return { rowIndex: idx, errors };
        }
        return rowErr;
      });
    });

    setSelectedColumn(null);
  }, [selectedColumn, mappedRows, effectiveExpectedColumns, selectedRows, filteredRowIndexes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedColumn && (e.key === "Delete" || e.key === "Backspace")) {
        if (!editingCell) {
          e.preventDefault();
          deleteSelectedColumnValues();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedColumn, editingCell, deleteSelectedColumnValues]);

  const deleteSelectedRows = useCallback(() => {
    if (selectedRows.size === 0 || submitted || submitting) return;
    setMappedRows((prev) => prev.filter((_, idx) => !selectedRows.has(idx)));
    setRowErrors((prev) => {
      const remaining = prev.filter((_, idx) => !selectedRows.has(idx));
      return remaining.map((row, newIndex) => ({ ...row, rowIndex: newIndex }));
    });
    setSelectedRows(new Set());
  }, [selectedRows, submitted, submitting]);

  const handleSubmit = useCallback(async () => {
    if (!allowSubmitWithErrors && invalidCount > 0) {
      return;
    }
    await onSubmit({ rows: mappedRows, mapping });
    setSubmitted(true);
  }, [allowSubmitWithErrors, invalidCount, onSubmit, mappedRows, mapping]);

  const resetToUpload = useCallback(() => {
    setMapping({});
    setMappedRows([]);
    setRowErrors([]);
    setFilterMode("all");
    setStep("map");
    try {
      localStorage.removeItem(SESSION);
    } catch {}
    onReset?.();
  }, [SESSION, onReset]);

  const canContinue = useMemo(() => {
    if (displayColumns && displayColumns.length > 0) return true;
    return !anyUnmappedRequired;
  }, [displayColumns, anyUnmappedRequired]);

  return (
    <div className={className} style={style} data-testid="csv-mapper">
      {step === "map" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-base font-semibold text-gray-900">
              Map CSV columns to expected fields
            </div>
            <div className="flex items-center gap-2">
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
                onClick={resetToUpload}
              >
                Exit
              </button>
              <button
                className="h-8 rounded-lg border border-red-500 bg-red-500 px-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleApplyMapping}
                disabled={!canContinue}
                data-testid="apply-mapping"
              >
                Continue
              </button>
            </div>
          </div>
          {headers.length === 0 ? (
            <div style={{ color: "#d32f2f" }}>No headers detected. Check your CSV file.</div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                    <div className="font-semibold text-gray-900">
                      Review and confirm each mapping choice
                    </div>
                    <div className="flex gap-6 text-xs text-gray-500">
                      <div>
                        EXPECTED COLUMNS{" "}
                        <span className="ml-1 font-semibold text-gray-900">
                          {effectiveExpectedColumns.length}
                        </span>{" "}
                        required of{" "}
                        <span className="font-semibold text-gray-900">
                          {effectiveExpectedColumns.filter((c) => c.required).length}
                        </span>
                      </div>
                      <div>
                        UPLOADED COLUMNS{" "}
                        <span className="ml-1 font-semibold text-gray-900">{headers.length}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {effectiveExpectedColumns.map((col) => {
                      const mappedHeader = mapping[col.key] ?? "";
                      return (
                        <div
                          key={col.key}
                          className="grid grid-cols-1 items-center gap-2 rounded-xl border border-gray-200 bg-white p-2.5 lg:grid-cols-[1fr_24px_360px]"
                          onMouseEnter={() => setPreviewHeader(mappedHeader || null)}
                        >
                          <div className="inline-flex w-fit items-center gap-2 rounded-md bg-gray-100 px-2 py-1 text-[13px] font-semibold text-gray-700">
                            <span>{col.label}</span>
                            {col.required ? <span className="text-red-600">*</span> : null}
                          </div>
                          <div className="text-center text-sm text-gray-500">→</div>
                          <div>
                            <select
                              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                              value={mappedHeader}
                              onChange={(e) => {
                                const val = e.target.value || null;
                                setMapping((prev) => ({
                                  ...prev,
                                  [col.key]: val,
                                }));
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
                            {!mappedHeader && col.required ? (
                              <span className="mt-1.5 inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600">
                                Required
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:sticky lg:top-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 font-semibold text-gray-900">
                      Data preview for {previewHeader ?? headers[0] ?? "—"}
                    </div>
                    <ul className="m-0 list-none p-0">
                      {(() => {
                        const h = previewHeader ?? headers[0];
                        if (!h) return null;
                        const idx = headers.indexOf(h);
                        return (rows.length > 0 ? rows.slice(0, 9) : []).map((r, i) => {
                          return (
                            <li
                              key={i}
                              className="border-b border-gray-200 px-1.5 py-2 text-sm text-gray-900 last:border-b-0"
                            >
                              {idx >= 0 ? (r[idx] ?? "") : ""}
                            </li>
                          );
                        });
                      })()}
                      {rows.length === 0 ? (
                        <li className="px-1.5 py-2 text-sm text-gray-500">No data</li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </div>

              <div style={{ display: "none" }}>
                <div>CSV preview</div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(rows.length > 0 ? rows.slice(0, 10) : []).map((r, i) => (
                        <tr key={i}>
                          {headers.map((_, j) => (
                            <td key={j}>{r[j] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={headers.length}>No rows</td>
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-base font-semibold text-gray-900">Validate data</div>
            <div className="flex items-center gap-2">
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setStep("map")}
                disabled={submitted || submitting}
              >
                Back
              </button>
              {submitted ? (
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm"
                  disabled
                >
                  Submitted
                </button>
              ) : (
                <>
                  <button
                    className="h-8 rounded-lg border border-red-500 bg-red-500 px-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleSubmit}
                    disabled={(invalidRowCount > 0 && !allowSubmitWithErrors) || submitting}
                    data-testid="submit-button"
                  >
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                  {submitError ? (
                    <>
                      <span className="text-sm text-red-600">{submitError}</span>
                      <button
                        className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleSubmit}
                        disabled={submitting}
                      >
                        Retry
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
                onClick={() => setFilterMode("all")}
                aria-pressed={filterMode === "all"}
              >
                All ({rowErrors.length})
              </button>
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
                onClick={() => setFilterMode("valid")}
                aria-pressed={filterMode === "valid"}
              >
                Valid ({validRowCount})
              </button>
              <button
                className={
                  "h-8 rounded-lg border bg-white px-2.5 text-sm hover:bg-gray-50 " +
                  (filterMode === "invalid" ? "border-red-500 text-red-600" : "border-gray-300")
                }
                onClick={() => setFilterMode("invalid")}
                aria-pressed={filterMode === "invalid"}
              >
                Invalid ({invalidRowCount})
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {selectedColumn && (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1 text-sm text-blue-700">
                    <span>
                      Column "
                      {
                        (displayColumns ?? effectiveExpectedColumns).find(
                          (c) => c.key === selectedColumn,
                        )?.label
                      }
                      " selected
                    </span>
                    <span className="text-xs text-blue-600">
                      {selectedRows.size > 0
                        ? `(Press Delete/Backspace to clear ${selectedRows.size} selected cells)`
                        : `(Press Delete/Backspace to clear ${filteredRowIndexes.length} filtered cells)`}
                    </span>
                  </div>
                )}
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={deleteSelectedRows}
                  disabled={selectedRows.size === 0 || submitted || submitting}
                >
                  Delete selected ({selectedRows.size})
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th
                    className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-2.5 text-center text-[13px] text-gray-500"
                    style={{ width: "60px", maxWidth: "60px" }}
                  >
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all filtered rows"
                    />
                  </th>
                  {(displayColumns ?? effectiveExpectedColumns).map((col) => (
                    <th
                      key={col.key}
                      className={
                        "border-b border-r border-gray-200 px-2.5 py-2.5 text-left text-[13px] text-gray-500 cursor-pointer transition-colors " +
                        (selectedColumn === col.key
                          ? "bg-blue-100"
                          : "bg-gray-50 hover:bg-gray-100")
                      }
                      style={{ whiteSpace: "nowrap", maxWidth: "200px" }}
                      onClick={() => {
                        setSelectedColumn(selectedColumn === col.key ? null : col.key);
                      }}
                      title="Click to select all cells in this column"
                    >
                      {col.label}{" "}
                      {col.required ? <span style={{ color: "var(--primary)" }}>*</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRowIndexes.map((idx) => {
                  const row = mappedRows[idx];
                  const errors = rowErrors[idx]?.errors ?? [];
                  const errorByCol = new Map(errors.map((e) => [e.columnKey, e.message]));
                  return (
                    <tr key={idx}>
                      <td
                        className="border-b border-r border-gray-200 px-2.5 py-2 align-top text-center"
                        style={{ width: "60px", maxWidth: "60px" }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRows.has(idx)}
                          onChange={() => toggleRowSelected(idx)}
                          aria-label={`Select row ${idx + 1}`}
                        />
                      </td>
                      {(displayColumns ?? effectiveExpectedColumns).map((col) => {
                        const errMsg = errorByCol.get(col.key);
                        const isEditing =
                          editingCell?.rowIndex === idx && editingCell?.columnKey === col.key;
                        return (
                          <td
                            key={col.key}
                            className={
                              "border-b border-r border-gray-200 px-2.5 py-2 align-top relative group " +
                              (isEditing
                                ? "bg-gray-50"
                                : selectedColumn === col.key
                                  ? "bg-blue-50"
                                  : errMsg
                                    ? "bg-red-50"
                                    : "bg-white")
                            }
                            style={{ maxWidth: "200px" }}
                            onClick={() => {
                              if (!isEditing) {
                                setEditingCell({
                                  rowIndex: idx,
                                  columnKey: col.key,
                                });
                                setSelectedColumn(null);
                              }
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                className={
                                  "w-full border-none bg-transparent px-0 py-1 text-sm outline-none focus:ring-0 " +
                                  (errMsg ? "cx-cell invalid" : "cx-cell")
                                }
                                style={{ overflow: "auto" }}
                                value={row[col.key] ?? ""}
                                onChange={(e) => updateCellValue(idx, col.key, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                onFocus={(e) => {
                                  e.target.setSelectionRange(0, 0);
                                }}
                                autoFocus
                                data-testid={`cell-${idx}-${col.key}`}
                              />
                            ) : (
                              <div
                                className={
                                  "cursor-text px-0 py-1 text-sm " +
                                  (errMsg ? "cx-cell invalid" : "cx-cell")
                                }
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                data-testid={`cell-${idx}-${col.key}`}
                              >
                                {row[col.key] ?? ""}
                              </div>
                            )}
                            {errMsg ? (
                              <div
                                className="absolute left-0 top z-10 hidden w-full rounded-md border border-red-200 bg-white px-2 py-1.5 text-xs text-gray-900 shadow group-hover:block group-focus-within:block"
                                role="tooltip"
                              >
                                {errMsg}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {visibleRowIndexes.length === 0 && (
                  <tr>
                    <td
                      className="border-b border-gray-200 px-2.5 py-2 align-top"
                      colSpan={(displayColumns ?? effectiveExpectedColumns).length + 1}
                    >
                      No rows to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                className="flex h-9 items-center gap-2 px-3 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-400"
                onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
                disabled={pageIndex === 0}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Previous
              </button>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Page</span>
                <span className="font-semibold text-gray-900">{pageIndex + 1}</span>
                <span>of</span>
                <span className="font-semibold text-gray-900">{totalPages}</span>
              </div>
              <button
                className="flex h-9 items-center gap-2 px-3 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-400"
                onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
                disabled={pageIndex >= totalPages - 1}
              >
                Next
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Rows per page:</span>
              <select
                className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:border-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                value={pageSize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPageSize(next);
                  setPageIndex(0);
                }}
              >
                {[50, 100, 200, 500, 1000].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "none" }} />
        </div>
      )}
    </div>
  );
};

export default CsvMapper;
