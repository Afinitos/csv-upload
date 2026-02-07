import type { CSSProperties } from "react";
import type { CsvSchema } from "./schemas/types";

export type Step = "map" | "edit";

export type ExpectedColumn = {
  key: string;
  label: string;
  required?: boolean;
  validator?: (value: string) => string | null;
};

export type ColumnMapping = Record<string, string | null>;
export type MappedRow = Record<string, string>;

export type CellError = { columnKey: string; message: string };
export type RowValidation = { rowIndex: number; errors: CellError[] };

export type CsvMapperProps = {
  schema: CsvSchema;
  headers: string[];
  rows: string[][];
  onSubmit: (payload: {
    rows: MappedRow[];
    mapping: ColumnMapping;
  }) => Promise<void> | void;
  onRowCountChange?: (count: number) => void;
  allowSubmitWithErrors?: boolean;
  onReset?: () => void;
  className?: string;
  style?: CSSProperties;
  storageKey?: string;
  submitting?: boolean;
  submitError?: string | null;
};

export const Validators = {
  required: (label: string) => (v: string) =>
    v && v.trim() !== "" ? null : `${label} is required`,
  numeric: (label: string) => (v: string) =>
    v.trim() === ""
      ? null
      : /^-?\d+(\.\d+)?$/.test(v)
        ? null
        : `${label} must be a number`,
  uuid: (label: string) => (v: string) =>
    v.trim() === ""
      ? null
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            v,
          )
        ? null
        : `${label} must be a valid UUID`,
};

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
      validator: (v) =>
        v && v.trim() !== "" ? null : "Unique Identifier is required",
    },
  ];
}
