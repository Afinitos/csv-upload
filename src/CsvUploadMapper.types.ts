import type { CSSProperties } from "react";

export type Step = "upload" | "map" | "edit";

/**
 * Public types
 */
export type ExpectedColumn = {
  key: string; // internal key used in mapped rows
  label: string; // user-facing label
  required?: boolean; // defaults to false
  validator?: (value: string) => string | null; // return null if valid, otherwise error message
};

export type ColumnMapping = Record<string, string | null>; // expected key -> csv header (or null for unmapped)
export type MappedRow = Record<string, string>;

export type CellError = { columnKey: string; message: string };
export type RowValidation = { rowIndex: number; errors: CellError[] };

export type CsvUploadMapperProps = {
  expectedColumns: ExpectedColumn[];
  onSubmit: (payload: { rows: MappedRow[]; mapping: ColumnMapping }) => Promise<void> | void;
  onRowCountChange?: (count: number) => void;
  allowSubmitWithErrors?: boolean;
  /**
   * For testing or preloading CSV without using a file input.
   */
  initialCsvText?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Optional per-workbook storage key for catalog persistence.
   * Defaults to "csvUploadFieldCatalog" if not provided.
   */
  storageKey?: string;
  /**
   * Submission state from parent (e.g., React Query).
   */
  submitting?: boolean;
  submitError?: string | null;
};

/**
 * Example validators you can reuse.
 */
export const Validators = {
  required: (label: string) => (v: string) => v && v.trim() !== "" ? null : `${label} is required`,
  numeric: (label: string) => (v: string) =>
    v.trim() === "" ? null : /^-?\d+(\.\d+)?$/.test(v) ? null : `${label} must be a number`,
  uuid: (label: string) => (v: string) =>
    v.trim() === ""
      ? null
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
      ? null
      : `${label} must be a valid UUID`,
};

/**
 * Helper to build a common expectedColumns config for "Asset ID" and "Unique Identifier"
 */
export function defaultAssetColumns(): ExpectedColumn[] {
  return [
    {
      key: "assetId",
      label: "Asset ID",
      required: true,
      validator: Validators.numeric("Asset ID"),
    },
    {
      key: "uniqueIdentifier",
      label: "Unique Identifier",
      required: true,
      // Example: allow any non-empty string
      validator: (v) => (v && v.trim() !== "" ? null : "Unique Identifier is required"),
    },
  ];
}
