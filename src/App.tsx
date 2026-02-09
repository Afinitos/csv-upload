import { useMemo, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import CsvMapper, { type MappedRow, type ColumnMapping } from "./CsvMapper";
import CsvUploadAndSchema from "./CsvUploadAndSchema";
import { defaultSchemas } from "./schemas/defaultSchemas";
import type { CsvSchema } from "./schemas/types";
import { parseCsv, readFileText, detectBestSchemaId } from "./csvUtils";

type AppStep = "upload" | "mapping";

export default function App() {
  const API_BASE =
    (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

  const activeName = "Assets";

  const [step, setStep] = useState<AppStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  const [schemas, setSchemas] = useState<CsvSchema[]>(() => defaultSchemas);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(
    () => defaultSchemas[0]?.id ?? "",
  );
  const [schemaAutoSelected, setSchemaAutoSelected] = useState(false);

  const selectedSchema =
    schemas.find((s) => s.id === selectedSchemaId) ?? schemas[0] ?? null;

  const storageKey = useMemo(
    () => `csvUploadFieldCatalog:${activeName}`,
    [activeName],
  );

  const uploadMutation = useMutation({
    mutationFn: async (payload: {
      rows: MappedRow[];
      mapping: ColumnMapping;
    }) => {
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

  async function handleSubmit(payload: {
    rows: MappedRow[];
    mapping: ColumnMapping;
  }) {
    await uploadMutation.mutateAsync(payload);
  }

  const handleFileSelect = useCallback(
    async (file: File) => {
      try {
        setSelectedFile(file);
        const text = await readFileText(file);
        const parsed = await parseCsv(text);
        setCsvHeaders(parsed.headers);
        setCsvRows(parsed.rows);

        const detectedSchemaId = detectBestSchemaId(schemas, parsed.headers);
        if (detectedSchemaId) {
          setSelectedSchemaId(detectedSchemaId);
          setSchemaAutoSelected(true);
        } else {
          setSchemaAutoSelected(false);
        }
      } catch (error) {
        console.error("Error processing file:", error);
        alert("Failed to process CSV file. Please check the file format.");
      }
    },
    [schemas],
  );

  const handleSchemaChange = useCallback((schemaId: string) => {
    setSelectedSchemaId(schemaId);
    setSchemaAutoSelected(false);
  }, []);

  const handleSchemasUpdate = useCallback((updatedSchemas: CsvSchema[]) => {
    setSchemas(updatedSchemas);
  }, []);

  const handleContinueToMapping = useCallback(() => {
    setStep("mapping");
  }, []);

  const handleReset = useCallback(() => {
    setStep("upload");
    setSelectedFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setSchemaAutoSelected(false);
    try {
      localStorage.removeItem(`${storageKey}:session`);
    } catch {}
  }, [storageKey]);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          {step === "upload" && (
            <CsvUploadAndSchema
              schemas={schemas}
              selectedSchemaId={selectedSchemaId}
              onSchemaChange={handleSchemaChange}
              onSchemasUpdate={handleSchemasUpdate}
              schemaAutoSelected={schemaAutoSelected}
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              onContinue={handleContinueToMapping}
            />
          )}

          {step === "mapping" && selectedFile && selectedSchema && (
            <CsvMapper
              key={activeName}
              schema={selectedSchema}
              headers={csvHeaders}
              rows={csvRows}
              onSubmit={handleSubmit}
              onReset={handleReset}
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
          )}
        </div>
      </main>
    </div>
  );
}
