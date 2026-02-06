import { useCallback, useMemo, useState, useEffect, type FC } from "react";
import fieldCatalogData from "./fieldCatalog.json";
import { defaultSchemas } from "./schemas/defaultSchemas";
import type { CsvSchema, ColumnRule } from "./schemas/types";
import Papa from "papaparse";
import { SchemaModal } from "./SchemaModal";
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

async function parseCsv(
  text: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  return await new Promise((resolve, reject) => {
    const useWorker = text.length > 2_000_000;
    // PapaParse auto-detects delimiter if left undefined
    const config = {
      skipEmptyLines: "greedy",
      ...(useWorker ? { worker: true as const } : {}),
      complete: (result: Papa.ParseResult<string[]>) => {
        const data = (result.data ?? []).filter((r) =>
          Array.isArray(r),
        ) as string[][];
        if (data.length === 0) {
          resolve({ headers: [], rows: [] });
          return;
        }

        const headers = (data[0] ?? []).map((x) => String(x ?? ""));
        const rows = data.slice(1).map((r) => r.map((x) => String(x ?? "")));
        resolve({ headers, rows });
      },
      error: (error: Error) => reject(error),
    } as Papa.ParseConfig<string[]>;
    Papa.parse<string[]>(text, config);
  });
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
function autoMapColumns(
  expected: ExpectedColumn[],
  headers: string[],
): ColumnMapping {
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

function detectBestSchemaId(
  schemas: CsvSchema[],
  headers: string[],
): string | null {
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
      const matched = candidates.some((c) =>
        normalizedHeaders.has(normalizeHeader(c)),
      );
      if (matched) {
        score += 1;
        if (col.required) requiredMatches += 1;
      }
    });
    if (
      score > bestScore ||
      (score === bestScore && requiredMatches > bestRequiredMatches)
    ) {
      bestScore = score;
      bestRequiredMatches = requiredMatches;
      bestId = schema.id;
    }
  });

  if (bestScore <= 0) return null;
  return bestId;
}

/**
 * Build mapped rows using the column mapping. Unmapped expected columns become empty strings.
 */
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

function ruleToValidator(
  label: string,
  rule: ColumnRule,
): (value: string) => string | null {
  if (rule.type === "regex") {
    const re = new RegExp(rule.pattern);
    return (v: string) =>
      v.trim() === ""
        ? null
        : re.test(v)
          ? null
          : (rule.message ?? `${label} is invalid`);
  }
  if (rule.type === "enum") {
    const set = new Set(rule.values);
    return (v: string) =>
      v.trim() === ""
        ? null
        : set.has(v)
          ? null
          : (rule.message ??
            `${label} must be one of ${rule.values.join(", ")}`);
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
      i === 0
        ? p.toLowerCase()
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
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
  onRowCountChange,
  allowSubmitWithErrors = false,
  initialCsvText,
  className,
  style,
  storageKey,
  submitting = false,
  submitError = null,
}) => {
  const [schemas, setSchemas] = useState<CsvSchema[]>(() => defaultSchemas);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(
    () => defaultSchemas[0]?.id ?? "",
  );
  const [schemaAutoSelected, setSchemaAutoSelected] = useState(false);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [schemaModalMode, setSchemaModalMode] = useState<"add" | "edit">("add");

  const selectedSchema = useMemo(() => {
    return schemas.find((s) => s.id === selectedSchemaId) ?? schemas[0] ?? null;
  }, [schemas, selectedSchemaId]);

  const schemaExpectedColumns = useMemo<ExpectedColumn[]>(() => {
    return selectedSchema ? schemaToExpectedColumns(selectedSchema) : [];
  }, [selectedSchema]);

  // We treat the selected schema as the “expected columns” in the UI.
  // If parent passes expectedColumns (tests), it still works, but schema takes precedence for the wizard UX.
  const effectiveExpectedColumns = (
    schemaExpectedColumns.length > 0 ? schemaExpectedColumns : expectedColumns
  ) as ExpectedColumn[];

  const [step, setStep] = useState<Step>(initialCsvText ? "map" : "upload");
  const [rawCsvText, setRawCsvText] = useState<string>(initialCsvText ?? "");
  const [{ headers, rows }, setParsed] = useState<{
    headers: string[];
    rows: string[][];
  }>({
    headers: [],
    rows: [],
  });

  // Mapping state: expected key -> header name (or null)
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Mapped editable rows
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);

  // Validation state
  const [rowErrors, setRowErrors] = useState<RowValidation[]>([]);

  // Notify parent about row count changes
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
  const [headerInclude, setHeaderInclude] = useState<Record<string, boolean>>(
    {},
  );
  const [headerToField, setHeaderToField] = useState<
    Record<string, string | "__new__">
  >({});
  const [headerNewName, setHeaderNewName] = useState<Record<string, string>>(
    {},
  );
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

  // Parse CSV when initialCsvText provided
  useEffect(() => {
    if (initialCsvText) {
      void (async () => {
        const parsed = await parseCsv(initialCsvText);
        setParsed(parsed);
        const auto = autoMapColumns(effectiveExpectedColumns, parsed.headers);
        setMapping(auto);
        setStep("map");
      })();
    }
  }, [initialCsvText, effectiveExpectedColumns]);

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
        (f) =>
          normalizeHeader(f.label) === norm || normalizeHeader(f.key) === norm,
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
  }, [
    effectiveExpectedColumns,
    headers,
    headerInclude,
    headerToField,
    headerNewName,
    catalog,
  ]);

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
      reader.onload = () => {
        try {
          const buf = reader.result as ArrayBuffer;
          const bytes = new Uint8Array(buf);
          let encoding: string = "utf-8";
          if (bytes.length >= 2) {
            const b0 = bytes[0];
            const b1 = bytes[1];
            const b2 = bytes[2];
            if (b0 === 0xfe && b1 === 0xff) encoding = "utf-16be";
            else if (b0 === 0xff && b1 === 0xfe) encoding = "utf-16le";
            else if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf)
              encoding = "utf-8";
          }
          const dec = new TextDecoder(encoding as any);
          resolve(dec.decode(bytes));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await readFileText(file);
      setRawCsvText(text);
      const parsed = await parseCsv(text);
      setParsed(parsed);
      const detectedSchemaId = detectBestSchemaId(schemas, parsed.headers);
      if (detectedSchemaId) {
        setSelectedSchemaId(detectedSchemaId);
        const schema = schemas.find((s) => s.id === detectedSchemaId);
        if (schema) {
          setMapping(
            autoMapColumns(schemaToExpectedColumns(schema), parsed.headers),
          );
        }
        setSchemaAutoSelected(true);
      } else {
        setMapping(autoMapColumns(effectiveExpectedColumns, parsed.headers));
        setSchemaAutoSelected(false);
      }
      setStep("map");
    },
    [readFileText, effectiveExpectedColumns, schemas],
  );

  const requiredColumnsUnmapped = useMemo(() => {
    return effectiveExpectedColumns.filter(
      (c) => c.required && !mapping[c.key],
    );
  }, [effectiveExpectedColumns, mapping]);

  const handleApplyMapping = useCallback(() => {
    // Determine which columns to use: header-based mapping if available, else expectedColumns mapping
    const cols: ExpectedColumn[] = displayColumns ?? effectiveExpectedColumns;

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
      for (const col of effectiveExpectedColumns) {
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
      const set = new Set(
        rowErrors.filter((r) => r.errors.length > 0).map((r) => r.rowIndex),
      );
      return all.filter((idx) => set.has(idx));
    }
    if (filterMode === "valid") {
      const set = new Set(
        rowErrors.filter((r) => r.errors.length === 0).map((r) => r.rowIndex),
      );
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
      visibleRowIndexes.length > 0 &&
      visibleRowIndexes.every((idx) => selectedRows.has(idx))
    );
  }, [visibleRowIndexes, selectedRows]);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleRowIndexes.forEach((idx) => next.delete(idx));
      } else {
        visibleRowIndexes.forEach((idx) => next.add(idx));
      }
      return next;
    });
  }, [allVisibleSelected, visibleRowIndexes]);

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

      // Re-validate the updated row
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

  const exportInvalidRows = useCallback(() => {
    const cols = displayColumns ?? effectiveExpectedColumns;
    const invalid = rowErrors
      .filter((r) => r.errors.length > 0)
      .map((r) => r.rowIndex);
    const csvRows: string[] = [];
    const headers = [...cols.map((c) => c.label), "Errors"];
    const escape = (v: string) => {
      const s = v ?? "";
      if (
        s.includes('"') ||
        s.includes(",") ||
        s.includes("\n") ||
        s.includes("\r")
      ) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    csvRows.push(headers.map(escape).join(","));
    invalid.forEach((idx) => {
      const row = mappedRows[idx] ?? {};
      const errs =
        rowErrors[idx]?.errors
          ?.map((e) => `${e.columnKey}: ${e.message}`)
          .join("; ") ?? "";
      const values = cols.map((c) => String(row[c.key] ?? ""));
      csvRows.push([...values, errs].map(escape).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invalid_rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [displayColumns, effectiveExpectedColumns, mappedRows, rowErrors]);

  const exportAllRows = useCallback(() => {
    const cols = displayColumns ?? effectiveExpectedColumns;
    const headers = cols.map((c) => c.label);
    const escape = (v: string) => {
      const s = v ?? "";
      if (
        s.includes('"') ||
        s.includes(",") ||
        s.includes("\n") ||
        s.includes("\r")
      ) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const csvRows: string[] = [];
    csvRows.push(headers.map(escape).join(","));
    mappedRows.forEach((row) => {
      const values = cols.map((c) => String(row[c.key] ?? ""));
      csvRows.push(values.map(escape).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workbook.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [displayColumns, effectiveExpectedColumns, mappedRows]);

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

  const schemaSelector = (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-semibold tracking-wider text-gray-500">
        SCHEMA
      </div>
      <div className="flex w-full flex-col gap-2">
        <select
          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
          value={selectedSchemaId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedSchemaId(id);
            setSchemaAutoSelected(false);

            // reset mapping when schema changes
            const schema = schemas.find((s) => s.id === id) ?? schemas[0];
            if (schema) {
              setMapping(
                autoMapColumns(schemaToExpectedColumns(schema), headers),
              );
            } else {
              setMapping({});
            }
          }}
          data-testid="schema-select"
        >
          {schemas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="text-xs text-gray-500">
          {selectedSchema?.description ??
            "Select which columns are expected in the CSV."}
        </div>
        {schemaAutoSelected ? (
          <div className="text-xs text-emerald-600">
            Schema auto-selected based on your CSV headers. You can change it if
            needed.
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
            onClick={() => {
              setSchemaModalMode("add");
              setIsSchemaModalOpen(true);
            }}
            type="button"
          >
            + Add schema
          </button>
          <button
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setSchemaModalMode("edit");
              setIsSchemaModalOpen(true);
            }}
            type="button"
            disabled={!selectedSchema}
          >
            Edit schema
          </button>
          <span className="text-xs text-gray-500">
            (for now stored only in memory)
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className={className} style={style} data-testid="csv-upload-mapper">
      {step === "upload" && (
        <div className="p-4">
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-2 text-lg font-bold text-gray-900">Import</div>
            <div className="mb-4 text-xs text-gray-500">
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
                const parsed = await parseCsv(text);
                setParsed(parsed);
                const detectedSchemaId = detectBestSchemaId(
                  schemas,
                  parsed.headers,
                );
                if (detectedSchemaId) {
                  setSelectedSchemaId(detectedSchemaId);
                  const schema = schemas.find((s) => s.id === detectedSchemaId);
                  if (schema) {
                    setMapping(
                      autoMapColumns(
                        schemaToExpectedColumns(schema),
                        parsed.headers,
                      ),
                    );
                  }
                  setSchemaAutoSelected(true);
                } else {
                  setMapping(
                    autoMapColumns(effectiveExpectedColumns, parsed.headers),
                  );
                  setSchemaAutoSelected(false);
                }
                setStep("map");
              }}
              className="mb-4 rounded-xl border-2 border-dashed border-gray-200 bg-white p-6"
            >
              <div className="text-xs text-gray-500">Drop CSV here</div>
            </div>

            <input
              id="upload-input"
              data-testid="file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div className="flex justify-center gap-2">
              <label htmlFor="upload-input">
                <span
                  className="inline-flex h-11 w-[200px] items-center justify-center gap-2 rounded-xl border border-red-500 bg-white px-4 text-sm font-semibold text-red-500 hover:bg-red-50"
                  role="button"
                >
                  <i
                    className="fa-solid fa-upload cx-btn-icon"
                    aria-hidden="true"
                  ></i>
                  Upload file
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-base font-semibold text-gray-900">
            2. Map CSV columns to expected fields
          </div>
          {schemaSelector}
          {headers.length === 0 ? (
            <div style={{ color: "#d32f2f" }}>
              No headers detected. Check your CSV file.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Top actions like screenshots */}
              <div className="flex items-center justify-end gap-2">
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
                  onClick={resetToUpload}
                >
                  Exit
                </button>
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50"
                  onClick={() => setStep("upload")}
                >
                  Back
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

              {/* Styled two-column layout */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
                {/* Left: expected-to-uploaded mapping rows */}
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
                          {
                            effectiveExpectedColumns.filter((c) => c.required)
                              .length
                          }
                        </span>
                      </div>
                      <div>
                        UPLOADED COLUMNS{" "}
                        <span className="ml-1 font-semibold text-gray-900">
                          {headers.length}
                        </span>
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
                          onMouseEnter={() =>
                            setPreviewHeader(mappedHeader || null)
                          }
                        >
                          <div className="inline-flex w-fit items-center gap-2 rounded-md bg-gray-100 px-2 py-1 text-[13px] font-semibold text-gray-700">
                            <span>{col.label}</span>
                            {col.required ? (
                              <span className="text-red-600">*</span>
                            ) : null}
                          </div>
                          <div className="text-center text-sm text-gray-500">
                            →
                          </div>
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

                {/* Right: preview card */}
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
                        return (rows.length > 0 ? rows.slice(0, 9) : []).map(
                          (r, i) => {
                            return (
                              <li
                                key={i}
                                className="border-b border-gray-200 px-1.5 py-2 text-sm text-gray-900 last:border-b-0"
                              >
                                {idx >= 0 ? (r[idx] ?? "") : ""}
                              </li>
                            );
                          },
                        );
                      })()}
                      {rows.length === 0 ? (
                        <li className="px-1.5 py-2 text-sm text-gray-500">
                          No data
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </div>

              {/* CSV preview (legacy table hidden) */}
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
                      {(rows.length > 0 ? rows.slice(0, 10) : []).map(
                        (r, i) => (
                          <tr key={i}>
                            {headers.map((_, j) => (
                              <td key={j}>{r[j] ?? ""}</td>
                            ))}
                          </tr>
                        ),
                      )}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={headers.length}>No rows</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                  Showing first {Math.min(rows.length, 10)} of {rows.length}{" "}
                  row(s)
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
            <div className="text-base font-semibold text-gray-900">
              3. Validate data
            </div>
            <div className="text-xs text-gray-500">
              {invalidRowCount > 0
                ? `${invalidRowCount} invalid row(s)`
                : "No validation issues"}
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
                  (filterMode === "invalid"
                    ? "border-red-500 text-red-600"
                    : "border-gray-300")
                }
                onClick={() => setFilterMode("invalid")}
                aria-pressed={filterMode === "invalid"}
              >
                Invalid ({invalidRowCount})
              </button>
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={deleteSelectedRows}
                disabled={selectedRows.size === 0 || submitted || submitting}
              >
                Delete selected ({selectedRows.size})
              </button>
              <button
                className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={exportAllRows}
                disabled={submitting}
              >
                Export workbook (CSV)
              </button>
              {invalidRowCount > 0 ? (
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={exportInvalidRows}
                  disabled={submitting}
                >
                  Export invalid (CSV)
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
                  disabled={pageIndex === 0}
                >
                  Prev
                </button>
                <span className="text-xs text-gray-500">
                  Page {pageIndex + 1} / {totalPages}
                </span>
                <button
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() =>
                    setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))
                  }
                  disabled={pageIndex >= totalPages - 1}
                >
                  Next
                </button>
              </div>
              <label className="flex h-8 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700">
                Rows/page
                <select
                  className="h-6 rounded border border-gray-300 bg-white text-sm"
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
              </label>
            </div>
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
                    disabled={
                      (invalidRowCount > 0 && !allowSubmitWithErrors) ||
                      submitting
                    }
                    data-testid="submit-button"
                  >
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                  {submitError ? (
                    <>
                      <span className="text-sm text-red-600">
                        {submitError}
                      </span>
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

          <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full border-collapse table-fixed">
              <colgroup>
                <col style={{ width: "80px" }} />
                <col style={{ width: "60px" }} />
                {(displayColumns ?? effectiveExpectedColumns).map((col) => (
                  <col key={col.key} style={{ width: "200px" }} />
                ))}
                <col style={{ width: "250px" }} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-2.5 text-left text-[13px] text-gray-500">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible rows"
                      />
                      <span>Select</span>
                    </label>
                  </th>
                  <th className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-2.5 text-left text-[13px] text-gray-500">
                    #
                  </th>
                  {(displayColumns ?? effectiveExpectedColumns).map((col) => (
                    <th
                      key={col.key}
                      className="border-b border-r border-gray-200 bg-gray-50 px-2.5 py-2.5 text-left text-[13px] text-gray-500"
                    >
                      {col.label}{" "}
                      {col.required ? (
                        <span style={{ color: "var(--primary)" }}>*</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="border-b border-gray-200 bg-gray-50 px-2.5 py-2.5 text-left text-[13px] text-gray-500">
                    Errors
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRowIndexes.map((idx) => {
                  const row = mappedRows[idx];
                  const errors = rowErrors[idx]?.errors ?? [];
                  const errorByCol = new Map(
                    errors.map((e) => [e.columnKey, e.message]),
                  );
                  return (
                    <tr key={idx}>
                      <td className="border-b border-r border-gray-200 px-2.5 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(idx)}
                          onChange={() => toggleRowSelected(idx)}
                          aria-label={`Select row ${idx + 1}`}
                        />
                      </td>
                      <td className="border-b border-r border-gray-200 px-2.5 py-2 align-top">
                        {idx + 1}
                      </td>
                      {(displayColumns ?? effectiveExpectedColumns).map(
                        (col) => {
                          const errMsg = errorByCol.get(col.key);
                          const isEditing =
                            editingCell?.rowIndex === idx &&
                            editingCell?.columnKey === col.key;
                          return (
                            <td
                              key={col.key}
                              className={
                                "border-b border-r border-gray-200 px-2.5 py-2 align-top " +
                                (isEditing
                                  ? "bg-gray-50"
                                  : errMsg
                                    ? "bg-red-50"
                                    : "bg-white")
                              }
                              onClick={() => {
                                if (!isEditing) {
                                  setEditingCell({
                                    rowIndex: idx,
                                    columnKey: col.key,
                                  });
                                }
                              }}
                            >
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="w-full border-none bg-transparent px-0 py-1 text-sm outline-none focus:ring-0"
                                  style={{ overflow: "auto" }}
                                  value={row[col.key] ?? ""}
                                  onChange={(e) =>
                                    updateCellValue(
                                      idx,
                                      col.key,
                                      e.target.value,
                                    )
                                  }
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={(e) => {
                                    if (
                                      e.key === "Enter" ||
                                      e.key === "Escape"
                                    ) {
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
                                  className="cursor-text px-0 py-1 text-sm"
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
                            </td>
                          );
                        },
                      )}
                      <td className="border-b border-gray-200 px-2.5 py-2 align-top">
                        {errors.length > 0 ? (
                          <ul className="m-0 list-disc pl-5 text-xs text-red-600">
                            {errors.map((e, i) => (
                              <li key={i}>
                                {(
                                  displayColumns ?? effectiveExpectedColumns
                                ).find((c) => c.key === e.columnKey)?.label ??
                                  e.columnKey}
                                : {e.message}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-gray-500">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleRowIndexes.length === 0 && (
                  <tr>
                    <td
                      className="border-b border-gray-200 px-2.5 py-2 align-top"
                      colSpan={
                        (displayColumns ?? effectiveExpectedColumns).length + 3
                      }
                    >
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

      <SchemaModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        onSave={(schema) => {
          if (schemaModalMode === "add") {
            setSchemas((prev) => [...prev, schema]);
            setSelectedSchemaId(schema.id);
          } else {
            setSchemas((prev) =>
              prev.map((s) => (s.id === selectedSchemaId ? schema : s)),
            );
          }
        }}
        schema={schemaModalMode === "edit" ? selectedSchema : null}
        mode={schemaModalMode}
      />
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
