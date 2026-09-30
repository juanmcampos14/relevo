// Procedencia en dos dimensiones, igual en todo RELEVO. La IA nunca es la fuente: puede interpretar,
// calcular o proponer, pero siempre se conserva de dónde partió.
//
// Canal de origen: de dónde viene.
export type Channel = "campo" | "entrevista" | "encuesta" | "crm" | "web" | "documento" | "relevo" | "sistema" | "desconocido";
// Base de la afirmación: qué grado tiene.
export type Basis = "observado" | "declarado" | "documentado" | "calculado" | "inferido" | "propuesto_ia" | "no_determinado";

export const CHANNEL: Record<Channel, string> = {
  campo: "Campo",
  entrevista: "Entrevista",
  encuesta: "Encuesta (Voice)",
  crm: "CRM / importación",
  web: "Web / fuente externa",
  documento: "Documento",
  relevo: "RELEVO",
  sistema: "Sistema",
  desconocido: "Origen desconocido",
};
export const BASIS: Record<Basis, string> = {
  observado: "Observado",
  declarado: "Declarado",
  documentado: "Documentado",
  calculado: "Calculado",
  inferido: "Inferido",
  propuesto_ia: "Propuesto por IA",
  no_determinado: "No determinado",
};

export type Provenance = { channel: Channel; basis: Basis; detail?: string };

/** Canal y base de un dato de evidencia (derivado de cómo se registró; sin IA). */
export function evidenceProvenance(e: { origin_kind: string; verification_status?: string | null; declared_by?: string | null; speaker?: string | null }): Provenance {
  switch (e.origin_kind) {
    case "field":
      if (e.declared_by) return { channel: "campo", basis: "documentado", detail: `lo dice ${e.declared_by}` };
      if (e.verification_status === "field_verified") return { channel: "campo", basis: "observado" };
      return { channel: "campo", basis: "declarado", detail: e.speaker ?? "quien capturó, sin fuente indicada" };
    case "interview":
    case "conversation":
      return { channel: "entrevista", basis: "declarado", detail: e.speaker ?? undefined };
    case "survey":
      return { channel: "encuesta", basis: "declarado", detail: "persona encuestada, autoseleccionada" };
    case "crm_import":
      return { channel: "crm", basis: "no_determinado", detail: "registro del CRM" };
    case "manual":
      return { channel: "relevo", basis: "no_determinado", detail: "carga manual" };
    case "email":
      return { channel: "documento", basis: "documentado", detail: "email" };
    case "website":
    case "public_registry":
    case "press":
    case "aog":
      return { channel: "web", basis: "documentado", detail: e.origin_kind.replace(/_/g, " ") };
    case "ai_research":
      return { channel: "web", basis: "documentado", detail: "fuente externa hallada con ayuda de IA" };
    default:
      return { channel: "desconocido", basis: "no_determinado" };
  }
}

/** Base de un dato económico (lo estimado es una inferencia, no evidencia). */
export function economicBasis(b: string): Basis {
  return b === "observado" ? "observado" : b === "declarado" ? "declarado" : b === "calculado" ? "calculado" : "inferido";
}

/** Canales de evidencia por origin_kind, para filtrar. */
export const CHANNEL_ORIGINS: Partial<Record<Channel, string[]>> = {
  campo: ["field"],
  entrevista: ["interview", "conversation"],
  encuesta: ["survey"],
  crm: ["crm_import"],
  web: ["website", "public_registry", "press", "aog", "ai_research"],
  documento: ["email"],
  relevo: ["manual"],
};

/** Fuente directa o documental fuerte: observada en campo, o documentada y verificada. */
export function isStrongSource(e: { origin_kind: string; verification_status: string; declared_by?: string | null }): boolean {
  const p = evidenceProvenance(e);
  return p.basis === "observado" || (p.basis === "documentado" && (e.verification_status === "publicly_verified" || e.verification_status === "field_verified"));
}
