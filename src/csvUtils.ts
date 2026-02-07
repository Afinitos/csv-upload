import Papa from "papaparse";
import type { CsvSchema } from "./schemas/types";

export async function parseCsv(
  text: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  return await new Promise((resolve, reject) => {
    const useWorker = text.length > 2_000_000;
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

export function readFileText(file: File): Promise<string> {
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
}

function normalizeHeader(s: string): string {
  return s.replace(/[\s_\-]/g, "").toLowerCase();
}

export function detectBestSchemaId(
  schemas: CsvSchema[],
  headers: string[],
): string | null {
  if (schemas.length === 0 || headers.length === 0) return null;

  const normalizedHeaders = headers.map((h) => normalizeHeader(h));

  let bestId: string | null = null;
  let bestScore = 0;
  let bestRequiredMatches = 0;

  for (const schema of schemas) {
    let score = 0;
    let requiredMatches = 0;

    for (const col of schema.columns) {
      const candidates = [col.label, col.key];
      const matched = candidates.some((c) =>
        normalizedHeaders.includes(normalizeHeader(c)),
      );

      if (matched) {
        score += 1;
        if (col.required) {
          requiredMatches += 1;
        }
      }
    }

    const isBetter =
      requiredMatches > bestRequiredMatches ||
      (requiredMatches === bestRequiredMatches && score > bestScore);

    if (isBetter) {
      bestId = schema.id;
      bestScore = score;
      bestRequiredMatches = requiredMatches;
    }
  }

  return bestScore > 0 ? bestId : null;
}
