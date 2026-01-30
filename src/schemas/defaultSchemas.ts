import type { CsvSchema } from "./types";

export const defaultSchemas: CsvSchema[] = [
  {
    id: "empty_schema",
    name: "Empty schema",
    description: "Start with an empty list of expected columns.",
    columns: [],
  },
];
