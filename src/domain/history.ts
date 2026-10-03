// Ventana del historial que se reenvía en cada turno. Si la ventana se corre un turno por vez, su comienzo
// cambia siempre y el historial entero se vuelve a escribir en la caché. Con un comienzo que avanza de a
// saltos, dos de cada tres turnos extienden el mismo prefijo y lo leen de la caché.
export const HISTORY_MIN_ROWS = 6;
export const HISTORY_STEP = 6;

/** Primera fila (0-based) a enviar de una conversación con `total` filas: entre MIN y MIN+STEP-1 filas. */
export function historyStart(total: number): number {
  return Math.floor(Math.max(0, total - HISTORY_MIN_ROWS) / HISTORY_STEP) * HISTORY_STEP;
}
