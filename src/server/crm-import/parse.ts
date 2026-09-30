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

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/**
 * Notas de celda por pestaña ("P30" → texto). exceljs no trae su texto; se leen del paquete.
 * En el CRM ahí viven, p. ej., los borradores de mensajes para AOG de cada contacto.
 */
export async function readCellNotes(buffer: ArrayBuffer): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  try {
    const zip = await JSZip.loadAsync(buffer);
    const workbook = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
    const wbRels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
    const target = new Map([...wbRels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?xl\//, "")]));
    for (const m of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      const sheetPath = target.get(m[2]);
      if (!sheetPath) continue;
      const relsPath = `xl/${sheetPath.replace(/([^/]+)$/, "_rels/$1.rels")}`;
      const rels = (await zip.file(relsPath)?.async("string")) ?? "";
      const commentsTarget = rels.match(/Target="([^"]*comments\d*\.xml)"/)?.[1];
      if (!commentsTarget) continue;
      const commentsPath = commentsTarget.startsWith("/") ? commentsTarget.slice(1) : posix.normalize(posix.join(posix.dirname(`xl/${sheetPath}`), commentsTarget));
      const xml = (await zip.file(commentsPath)?.async("string")) ?? "";
      const notes = new Map<string, string>();
      for (const c of xml.matchAll(/<comment\b[^>]*ref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
        const text = decodeXml([...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")).trim();
        if (text) notes.set(c[1], text);
      }
      out.set(decodeXml(m[1]), notes);
    }
  } catch {
    // Sin notas legibles: se importa igual (las notas son un extra).
  }
  return out;
}

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export async function parseCrmWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const cellNotes = await readCellNotes(buffer);
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
    const notes = cellNotes.get(ws.name);
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
      if (notes) hdr.forEach((h, i) => {
        const note = h ? notes.get(`${colLetter(i)}${n}`) : undefined;
        if (note) values[`${h}#nota`] = note;
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

/** Filas de una pestaña cualquiera (por nombre plegado), detectando el encabezado por una columna clave. */
export async function parseTab(buffer: ArrayBuffer, sheetName: string, key: string): Promise<{ row: number; values: Record<string, string | null> }[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    await wb.xlsx.load(await normalizePackage(buffer));
  }
  const ws = wb.worksheets.find((w) => fold(w.name) === fold(sheetName));
  if (!ws) return [];
  let header: string[] | null = null;
  let headerRow = 0;
  const out: { row: number; values: Record<string, string | null> }[] = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    const vals = (r.values as Cell[]).map((c) => cellText(c).text ?? "");
    if (!header) {
      if (vals.includes(key)) {
        header = vals;
        headerRow = n;
      }
      return;
    }
    if (n <= headerRow) return;
    const values: Record<string, string | null> = {};
    (r.values as Cell[]).forEach((c, i) => {
      const h = header![i];
      if (h) values[h] = cellText(c).text;
    });
    if (Object.values(values).some(Boolean)) out.push({ row: n, values });
  });
  return out;
}
