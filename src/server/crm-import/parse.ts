import "server-only";

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { posix } from "node:path";
import { fold, type RawRow } from "@/domain/crm-import/map";

// Pestañas que se importan y el encabezado que las identifica (docs/03-migracion-crm-sheets.md §2).
// El resto (INICIO, CENTRO DE CONTROL, CAMPO, DATOS…) son vistas o se importan después del piloto.
export const SHEETS = {
  companies: { name: "empresas", key: "ID anterior", required: ["ID", "Empresa / establecimiento"] },
  contacts: { name: "red | contactos", key: "Acceso / vínculo", required: ["ID", "Nombre", "Empresa ID"] },
  tasks: { name: "actividades", key: "Actividad / objetivo", required: ["ID", "Empresa ID"] },
  sources: { name: "fuentes", key: "Entidad vinculada", required: ["ID", "URL original"] },
} as const;
export type SheetKey = keyof typeof SHEETS;

export type ParsedWorkbook = {
  rows: Record<SheetKey, RawRow[]>;
  /** Pestañas cuyo ID es una fórmula que depende de la posición de la fila (se corre si se insertan filas). */
  formulaIds: string[];
};

type Cell = ExcelJS.CellValue;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Valor visible de una celda: resultado de fórmulas, texto de enlaces, fechas en ISO. */
function cellText(v: Cell): { text: string | null; link?: string; formula?: boolean } {
  if (v === null || v === undefined) return { text: null };
  if (v instanceof Date) return { text: isoDate(v) };
  if (typeof v === "string") return { text: v.trim() || null };
  if (typeof v === "number" || typeof v === "boolean") return { text: String(v) };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) {
      const r = cellText((v as { result?: Cell }).result ?? null);
      return { ...r, formula: true };
    }
    if ("hyperlink" in v) {
      const t = (v as { text?: Cell }).text;
      return { text: cellText(t ?? null).text, link: (v as { hyperlink: string }).hyperlink };
    }
    if ("richText" in v) return { text: (v as { richText: { text: string }[] }).richText.map((p) => p.text).join("").trim() || null };
    if ("error" in v) return { text: null };
  }
  return { text: String(v) };
}

export class WorkbookError extends Error {}

/**
 * Algunas herramientas re-guardan el .xlsx con rutas internas absolutas ("/xl/tables/table1.xml") y
 * comentarios en carpetas propias. Es válido en el formato pero exceljs no lo lee: se reescriben las
 * rutas como relativas y se descartan los comentarios de celda (el importador no los usa).
 */
export async function normalizePackage(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) {
    const file = zip.file(path);
    if (!file) continue; // carpeta
    if (/(^|\/)_rels\/[^/]+\.rels$/.test(path)) {
      // Carpeta de la parte dueña de las relaciones: xl/worksheets/_rels/sheet1.xml.rels → xl/worksheets
      const sourceDir = path.replace(/_rels\/[^/]+\.rels$/, "").replace(/\/$/, "");
      const xml = await file.async("string");
      zip.file(
        path,
        xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
          if (/relationships\/(comments|vmlDrawing)"/.test(tag)) return "";
          if (/TargetMode="External"/.test(tag)) return tag;
          return tag.replace(/Target="\/([^"]+)"/, (_, abs: string) => `Target="${posix.relative(sourceDir || ".", abs)}"`);
        }),
      );
    } else if (/^xl\/worksheets\/[^/]+\.xml$/.test(path)) {
      zip.file(path, (await file.async("string")).replace(/<legacyDrawing\b[^>]*\/>/g, ""));
    }
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

export async function parseCrmWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    try {
      await wb.xlsx.load(await normalizePackage(buffer));
    } catch {
      throw new WorkbookError("El archivo no es un .xlsx válido. Exportalo desde Google Sheets con Archivo → Descargar → Microsoft Excel.");
    }
  }
  const rows = {} as Record<SheetKey, RawRow[]>;
  const formulaIds: string[] = [];

  for (const [key, spec] of Object.entries(SHEETS) as [SheetKey, (typeof SHEETS)[SheetKey]][]) {
    const ws = wb.worksheets.find((w) => fold(w.name) === spec.name);
    if (!ws) throw new WorkbookError(`No encontré la pestaña "${spec.name.toUpperCase()}". ¿Es el CRM de RELEVO?`);

    let header: string[] | null = null;
    let headerRow = 0;
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (header) return;
      const vals = (r.values as Cell[]).map((c) => cellText(c).text ?? "");
      if (vals.includes(spec.key)) {
        header = vals;
        headerRow = n;
      }
    });
    if (!header) throw new WorkbookError(`La pestaña "${ws.name}" no tiene la columna "${spec.key}".`);
    const hdr: string[] = header;
    for (const col of spec.required) {
      if (!hdr.includes(col)) throw new WorkbookError(`La pestaña "${ws.name}" no tiene la columna "${col}".`);
    }

    const out: RawRow[] = [];
    let idIsFormula = false;
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n <= headerRow) return;
      const values: Record<string, string | null> = {};
      let rowIdFormula = false;
      (r.values as Cell[]).forEach((c, i) => {
        const h = hdr[i];
        if (!h) return;
        const { text, link, formula } = cellText(c);
        values[h] = text;
        if (link) values[`${h}#link`] = link;
        if (h === "ID" && formula) rowIdFormula = true;
      });
      if (!values["ID"] && !values["ID anterior"]) return; // filas vacías o de plantilla (fórmula sin dato)
      // Solo cuenta si el registro tiene datos: las filas vacías de plantilla pueden tener la fórmula precargada.
      if (rowIdFormula) idIsFormula = true;
      out.push({ sheet: ws.name, row: n, values });
    });
    if (idIsFormula && key !== "companies") formulaIds.push(ws.name);
    rows[key] = out;
  }
  return { rows, formulaIds };
}
