// Quién aportó una evidencia, sin inventar: una persona del equipo (si lo trajo de una planilla, se dice),
// RELEVO cuando sale de su investigación, o "sin autor registrado" cuando no se puede saber.

const RELEVO_RESEARCH = new Set(["website", "aog", "ai_research"]);

export function evidenceAuthor(name: string | null, originKind: string): string {
  if (name) return originKind === "crm_import" ? `${name} (planilla)` : name;
  if (RELEVO_RESEARCH.has(originKind)) return "RELEVO (investigación)";
  return "sin autor registrado";
}
