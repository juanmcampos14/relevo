// OPORTUNIDADES del CRM → oportunidad en RELEVO. El CRM es el registro maestro: todas sus columnas quedan
// tal cual en la ficha (card.crm) y RELEVO no interpreta etapa, carril, confianza ni decisión. Solo se
// toman como campos propios los que no necesitan interpretación (título, tesis, empresa, próximo hito).

export type CrmOpportunity = {
  externalId: string;
  title: string;
  thesis: string | null;
  companyRef: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  /** Decisión del CRM; vacía se muestra como "Pendiente" (no es una decisión registrada). */
  decision: { value: string; recorded: boolean };
  crm: Record<string, string>;
};

const t = (v: string | null | undefined) => (v ?? "").trim() || null;

/** dd/mm/aaaa o aaaa-mm-dd → aaaa-mm-dd. */
function day(v: string | null): string | null {
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function mapOpportunity(values: Record<string, string | null>): CrmOpportunity | null {
  const id = t(values["ID"])?.toUpperCase();
  const title = t(values["Oportunidad"]);
  if (!id || !title) return null;
  const crm = Object.fromEntries(Object.entries(values).filter(([k, v]) => !k.includes("#") && t(v)).map(([k, v]) => [k, t(v)!]));
  const decision = t(values["Decisión"]);
  return {
    externalId: id,
    title,
    thesis: t(values["Subtipo / tesis del caso"]),
    companyRef: t(values["Empresa ID"])?.toUpperCase() ?? null,
    nextAction: t(values["Próximo hito"]) ?? t(values["Próxima validación"]),
    nextActionDue: day(t(values["Fecha objetivo"])),
    decision: decision ? { value: decision, recorded: true } : { value: "Pendiente", recorded: false },
    crm,
  };
}
