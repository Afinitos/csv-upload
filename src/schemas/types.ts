import type { ExpectedColumn } from "../CsvMapper.types";

export type ColumnRule =
  | { type: "regex"; pattern: string; message?: string }
  | { type: "enum"; values: string[]; message?: string };

export type CsvSchemaColumn = Omit<ExpectedColumn, "validator"> & {
  /**
   * Optional declarative validation rule(s). If provided, they will be converted to validators.
   */
  rules?: ColumnRule[];
};

export type CsvSchema = {
  id: string;
  name: string;
  description?: string;
  columns: CsvSchemaColumn[];
};
