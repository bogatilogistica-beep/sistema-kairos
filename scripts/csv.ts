import fs from "node:fs";

/** Parser CSV simple que respeta comillas dobles y comas dentro de campos entrecomillados. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") pushField();
      else if (ch === "\r") continue;
      else if (ch === "\n") pushRow();
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export function readCsvAsObjects(path: string): Record<string, string>[] {
  const text = fs.readFileSync(path, "utf-8");
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}
