// Solo local: corre contra el export real del CRM si se pasa CRM_XLSX=/ruta/al/archivo.xlsx.
// No hay datos reales en el repo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCrmWorkbook } from "./parse";
import { mapCompany, mapContact, mapSource, mapTask } from "@/domain/crm-import/map";

const file = process.env.CRM_XLSX;

describe.skipIf(!file)("CRM real (local)", () => {
  it("lee las cuatro pestañas y mapea sin romperse", async () => {
    const buf = readFileSync(file!);
    const wb = await parseCrmWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const counts = Object.fromEntries(Object.entries(wb.rows).map(([k, v]) => [k, v.length]));
    const companies = wb.rows.companies.map(mapCompany);
    const contacts = wb.rows.contacts.map(mapContact);
    const tasks = wb.rows.tasks.map(mapTask);
    const sources = wb.rows.sources.map(mapSource);
    const issues = [...companies, ...contacts, ...tasks, ...sources].flatMap((m) => m.issues.map((i) => `${m.externalId}:${i.code}`));
    if (process.env.CRM_REPORT) (await import("node:fs")).writeFileSync(process.env.CRM_REPORT, JSON.stringify({ counts, formulaIds: wb.formulaIds, pilot: companies.filter((c) => ["AN-0023", "AN-0054", "AN-0029"].includes(c.externalId)).map((c) => ({ id: c.externalId, ...c.values, public_phone: c.values.public_phone ? "…" : null, issues: c.issues.map((i) => i.code) })), issueCounts: issues.reduce<Record<string, number>>((a, i) => ((a[i.split(":")[1]] = (a[i.split(":")[1]] ?? 0) + 1), a), {}), an0041: companies.find((c) => c.externalId === "AN-0041")?.issues.map((i) => i.code) }, null, 1));
    expect(counts.companies).toBeGreaterThan(50);
  });
});
