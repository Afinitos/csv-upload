import type { FC } from "react";

export interface CsvUploadProps {
  onFileSelect: (file: File) => void;
}

export const CsvUpload: FC<CsvUploadProps> = ({ onFileSelect }) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type === "text/csv") {
      onFileSelect(file);
    }
  };

  return (
    <div className="p-4">
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-2 text-lg font-bold text-gray-900">Import</div>
        <div className="mb-4 text-xs text-gray-500">
          Drag and drop or upload a file to get started
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
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
  );
};

export default CsvUpload;
