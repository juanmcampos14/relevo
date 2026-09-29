import ExcelJS from "exceljs";
import JSZip from "jszip";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkbookError, parseCrmWorkbook } from "./parse";

async function crmLike(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, header: string[], row: string[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(header);
    ws.addRow(row);
    return ws;
  };
  const emp = add("EMPRESAS", ["ID anterior", "ID", "Empresa / establecimiento"], ["AN-0001", "AN-0001", "Empresa Uno"]);
  emp.getCell("C2").note = "Comentario de celda";
  add("RED | CONTACTOS", ["ID", "Nombre", "Empresa ID", "Acceso / vínculo"], ["CT-001", "Ana", "AN-0001", "Teléfono público"]);
  add("ACTIVIDADES", ["ID", "Empresa ID", "Actividad / objetivo"], ["ACT-001", "AN-0001", "Llamar"]);
  add("FUENTES", ["ID", "Entidad vinculada", "URL original"], ["SRC-001", "AN-0001", "https://example.com"]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Reescribe las rutas internas como absolutas, como hacen algunas herramientas al re-guardar. */
async function withAbsolutePaths(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const path of Object.keys(zip.files).filter((p) => /^xl\/(worksheets\/)?_rels\/.+\.rels$/.test(p))) {
    const base = path.startsWith("xl/worksheets/") ? "xl/worksheets" : "xl";
    const xml = await zip.file(path)!.async("string");
    zip.file(path, xml.replace(/Target="(?!https?:)([^"]+)"/g, (_, rel: string) => `Target="/${posix.join(base, rel)}"`));
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("lectura del .xlsx", () => {
  it("lee las cuatro pestañas", async () => {
    const wb = await parseCrmWorkbook(await crmLike());
    expect(Object.fromEntries(Object.entries(wb.rows).map(([k, v]) => [k, v.length]))).toEqual({ companies: 1, contacts: 1, tasks: 1, sources: 1 });
  });

  it("tolera rutas internas absolutas (archivo re-guardado por otra herramienta)", async () => {
    const wb = await parseCrmWorkbook(await withAbsolutePaths(await crmLike()));
    expect(wb.rows.companies[0].values["Empresa / establecimiento"]).toBe("Empresa Uno");
  });

  it("falta una pestaña → error claro", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("EMPRESAS").addRow(["ID anterior", "ID", "Empresa / establecimiento"]);
    await expect(parseCrmWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow(WorkbookError);
  });
});
