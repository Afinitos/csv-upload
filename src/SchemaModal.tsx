import { FC, useState, useEffect } from "react";
import { JsonEditor } from "json-edit-react";
import type { CsvSchema } from "./schemas/types";

type SchemaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (schema: CsvSchema) => void;
  schema?: CsvSchema | null;
  mode: "add" | "edit";
};

export const SchemaModal: FC<SchemaModalProps> = ({
  isOpen,
  onClose,
  onSave,
  schema,
  mode,
}) => {
  const [jsonData, setJsonData] = useState<CsvSchema>(() =>
    schema
      ? schema
      : {
          id: `custom_${Date.now()}`,
          name: "New Schema",
          description: "",
          columns: [],
        },
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (schema) {
      setJsonData(schema);
    } else {
      setJsonData({
        id: `custom_${Date.now()}`,
        name: "New Schema",
        description: "",
        columns: [],
      });
    }
    setError(null);
  }, [schema, isOpen]);

  const handleSave = () => {
    try {
      // Validate schema structure
      if (!jsonData.id || typeof jsonData.id !== "string") {
        setError("Schema must have a valid 'id' field");
        return;
      }
      if (!jsonData.name || typeof jsonData.name !== "string") {
        setError("Schema must have a valid 'name' field");
        return;
      }
      if (!Array.isArray(jsonData.columns)) {
        setError("Schema must have a 'columns' array");
        return;
      }

      // Validate each column
      for (let i = 0; i < jsonData.columns.length; i++) {
        const col = jsonData.columns[i];
        if (!col.key || typeof col.key !== "string") {
          setError(`Column ${i + 1} must have a valid 'key' field`);
          return;
        }
        if (!col.label || typeof col.label !== "string") {
          setError(`Column ${i + 1} must have a valid 'label' field`);
          return;
        }
      }

      setError(null);
      onSave(jsonData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {mode === "add" ? "Add Schema" : "Edit Schema"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          className="overflow-y-auto px-6 py-4"
          style={{ maxHeight: "calc(90vh - 140px)" }}
        >
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Edit the schema JSON below. The schema must include:
            </p>
            <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
              <li>
                <code className="bg-gray-100 px-1 rounded">id</code>: Unique
                identifier (string)
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">name</code>: Display
                name (string)
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">description</code>:
                Optional description (string)
              </li>
              <li>
                <code className="bg-gray-100 px-1 rounded">columns</code>: Array
                of column definitions, each with{" "}
                <code className="bg-gray-100 px-1 rounded">key</code>,{" "}
                <code className="bg-gray-100 px-1 rounded">label</code>,
                optional{" "}
                <code className="bg-gray-100 px-1 rounded">required</code>, and
                optional <code className="bg-gray-100 px-1 rounded">rules</code>
              </li>
            </ul>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <JsonEditor
              data={jsonData}
              setData={(data: unknown) => setJsonData(data as CsvSchema)}
              rootName="schema"
              collapse={false}
              restrictEdit={false}
              restrictDelete={false}
              restrictAdd={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="h-10 rounded-lg border border-red-500 bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600"
          >
            {mode === "add" ? "Add Schema" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};
