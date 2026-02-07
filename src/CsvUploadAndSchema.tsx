import { type FC, useState, useCallback } from "react";
import type { CsvSchema } from "./schemas/types";
import { SchemaModal } from "./SchemaModal";

export interface CsvUploadAndSchemaProps {
  schemas: CsvSchema[];
  selectedSchemaId: string;
  onSchemaChange: (schemaId: string) => void;
  onSchemasUpdate: (schemas: CsvSchema[]) => void;
  schemaAutoSelected?: boolean;
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
  onContinue: () => void;
}

export const CsvUploadAndSchema: FC<CsvUploadAndSchemaProps> = ({
  schemas,
  selectedSchemaId,
  onSchemaChange,
  onSchemasUpdate,
  schemaAutoSelected = false,
  selectedFile,
  onFileSelect,
  onContinue,
}) => {
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [schemaModalMode, setSchemaModalMode] = useState<"add" | "edit">("add");

  const selectedSchema =
    schemas.find((s) => s.id === selectedSchemaId) ?? schemas[0] ?? null;

  const canContinue = selectedFile !== null && selectedSchema !== null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type === "text/csv") {
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mb-2 text-lg font-bold text-gray-900">
              Upload File
            </div>
            <div className="text-xs text-gray-500">
              Drag and drop or upload a CSV file
            </div>
          </div>

          {!selectedFile ? (
            <>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="mb-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-8"
              >
                <div className="text-center text-sm text-gray-500">
                  Drop CSV file here
                </div>
              </div>

              <input
                id="upload-input"
                data-testid="file-input"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <div className="flex justify-center">
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
            </>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
              <div className="flex items-start gap-3">
                <i
                  className="fa-solid fa-file-csv text-2xl text-emerald-600"
                  aria-hidden="true"
                ></i>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">
                    {selectedFile.name}
                  </div>
                  <div className="text-sm text-gray-500">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </div>
                </div>
                <button
                  onClick={() => {
                    const input = document.getElementById(
                      "upload-input",
                    ) as HTMLInputElement;
                    if (input) input.value = "";
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Remove file"
                >
                  <i className="fa-solid fa-times"></i>
                </button>
              </div>
              <div className="mt-4 flex justify-center">
                <label htmlFor="upload-input">
                  <span
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50"
                    role="button"
                  >
                    Change file
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mb-2 text-lg font-bold text-gray-900">
              Select Schema
            </div>
            <div className="text-xs text-gray-500">
              Choose which schema matches your CSV
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-3">
            <div className="text-xs font-semibold tracking-wider text-gray-500">
              SCHEMA
            </div>
            <select
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              value={selectedSchemaId}
              onChange={(e) => onSchemaChange(e.target.value)}
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
            {schemaAutoSelected && (
              <div className="text-xs text-emerald-600">
                ✓ Schema auto-selected based on your CSV headers. You can change
                it if needed.
              </div>
            )}
            <div className="flex flex-col gap-2">
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
      </div>

      <div className="mt-6 flex justify-center">
        <button
          className="h-11 rounded-xl border border-red-500 bg-red-500 px-8 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:border-gray-300"
          onClick={onContinue}
          disabled={!canContinue}
          data-testid="continue-to-mapping"
        >
          Continue to Mapping
        </button>
      </div>

      {isSchemaModalOpen && (
        <SchemaModal
          isOpen={isSchemaModalOpen}
          mode={schemaModalMode}
          schema={schemaModalMode === "edit" ? selectedSchema : null}
          onClose={() => setIsSchemaModalOpen(false)}
          onSave={(newOrUpdatedSchema) => {
            if (schemaModalMode === "add") {
              onSchemasUpdate([...schemas, newOrUpdatedSchema]);
              onSchemaChange(newOrUpdatedSchema.id);
            } else {
              onSchemasUpdate(
                schemas.map((s) =>
                  s.id === newOrUpdatedSchema.id ? newOrUpdatedSchema : s,
                ),
              );
            }
            setIsSchemaModalOpen(false);
          }}
        />
      )}
    </>
  );
};

export default CsvUploadAndSchema;
