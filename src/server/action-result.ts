import type { FieldErrors } from "@/domain/schemas";

export type ActionState = { ok?: boolean; message?: string; errors?: FieldErrors };

export const initialActionState: ActionState = {};

type PgError = { code?: string; message?: string; details?: string | null } | null | undefined;

/** Traduce errores de Postgres/PostgREST a mensajes honestos en español. */
export function dbErrorMessage(error: PgError): string {
  switch (error?.code) {
    case "42501":
      return "No tenés permiso para esta acción en este workspace.";
    case "23505":
      return "Ya existe un registro igual (duplicado).";
    case "23514":
      return "El registro no cumple una regla de datos (fuente, verificación o formato).";
    case "23503":
      return "Hace referencia a un registro que no existe o no pertenece a este workspace.";
    case "23502":
      return "Falta un dato obligatorio.";
    default:
      return "No se pudo guardar. Probá de nuevo; si persiste, avisá a Juan.";
  }
}
