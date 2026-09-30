// Procedencia de cada dato, igual en todo RELEVO:
//   CAMPO       observado directamente o declarado por una persona en campo
//   RELEVO      dato estructurado existente (CRM importado, carga manual, email)
//   WEB         investigación o fuente externa (sitio, registro público, prensa, investigación IA)
//   CÁLCULO     resultado derivado matemáticamente de otros datos
//   HIPÓTESIS   interpretación o inferencia (de la IA o del equipo), todavía no evidencia
//   DESCONOCIDO todavía no sabemos de dónde sale
export type ProvenanceTag = "campo" | "relevo" | "web" | "calculo" | "hipotesis" | "desconocido";

export const PROVENANCE: Record<ProvenanceTag, { label: string; hint: string }> = {
  campo: { label: "Campo", hint: "Observado o declarado en campo" },
  relevo: { label: "RELEVO", hint: "Dato estructurado existente (CRM, carga manual)" },
  web: { label: "Web / fuente externa", hint: "Investigación o fuente externa" },
  calculo: { label: "Cálculo", hint: "Derivado de otros datos" },
  hipotesis: { label: "Hipótesis", hint: "Interpretación o inferencia, no evidencia" },
  desconocido: { label: "Desconocido", hint: "Sin fuente identificada" },
};

const FIELD = new Set(["field", "interview", "conversation"]);
const STRUCTURED = new Set(["crm_import", "manual", "email"]);
const EXTERNAL = new Set(["website", "public_registry", "press", "aog", "ai_research"]);

export type EvidenceProvenance = { tag: ProvenanceTag; detail: string };

/** De dónde sale un dato de evidencia, en palabras: "Campo · observado", "Campo · declarado por Laura"… */
export function evidenceProvenance(e: {
  origin_kind: string;
  verification_status?: string | null;
  declared_by?: string | null;
  speaker?: string | null;
}): EvidenceProvenance {
  if (FIELD.has(e.origin_kind)) {
    if (e.declared_by) return { tag: "campo", detail: `lo dice ${e.declared_by} (visto en campo, sin verificar)` };
    if (e.origin_kind === "field" && e.verification_status === "field_verified") return { tag: "campo", detail: "observado" };
    return { tag: "campo", detail: e.speaker ? `declarado por ${e.speaker}` : "declarado, sin fuente indicada" };
  }
  if (STRUCTURED.has(e.origin_kind)) return { tag: "relevo", detail: e.origin_kind === "crm_import" ? "CRM importado" : e.origin_kind === "email" ? "email" : "carga manual" };
  if (EXTERNAL.has(e.origin_kind)) return { tag: "web", detail: e.origin_kind === "ai_research" ? "investigación IA (fuente externa)" : e.origin_kind.replace(/_/g, " ") };
  return { tag: "desconocido", detail: "sin fuente" };
}
