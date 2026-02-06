import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import CsvUploadMapper, { type MappedRow, type ColumnMapping } from "./CsvUploadMapper";

export default function App() {
  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

  // Single-workbook mode
  const activeName = "Assets";

  // Storage key is scoped per-workbook so that catalog/mapping can differ
  const storageKey = useMemo(() => `csvUploadFieldCatalog:${activeName}`, [activeName]);

  const uploadMutation = useMutation({
    mutationFn: async (payload: { rows: MappedRow[]; mapping: ColumnMapping }) => {
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

  async function handleSubmit(payload: { rows: MappedRow[]; mapping: ColumnMapping }) {
    await uploadMutation.mutateAsync(payload);
  }

  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] bg-gray-50">
      {/* Left menu: workbook name + new file */}
      <aside className="flex flex-col gap-3 border-r border-gray-200 bg-white px-3 py-4">
        <div>
          <div className="text-xs font-semibold tracking-wider text-gray-500">WORKBOOK</div>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-100 px-2.5 py-2 text-gray-900">
            <i
              className="fa-solid fa-table-cells-large text-sm text-gray-600"
              aria-hidden="true"
            ></i>
            <span className="font-semibold">{activeName}</span>
          </div>
        </div>

        <button
          className="mt-1 h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-900 hover:bg-gray-50"
          onClick={() => {
            // Start a new file: clear current in-progress session for this workbook
            try {
              localStorage.removeItem(`${storageKey}:session`);
            } catch {}
            window.location.reload();
          }}
        >
          + New file
        </button>
      </aside>

      {/* Main content */}
      <main className="p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          {/* CSV Upload + Mapping + Edit */}
          <CsvUploadMapper
            key={activeName}
            expectedColumns={[]}
            onSubmit={handleSubmit}
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
        </div>
      </main>
    </div>
  );
}
