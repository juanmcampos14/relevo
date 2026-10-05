// Cada cuánto RELEVO vuelve a priorizar la misión durante el día. La vigilancia corre 2 veces por día y avisa
// enseguida lo material; reescribir Ahora, el estado y el Avanzar alcanza con ~2 veces por día (además de la
// síntesis de la mañana). Antes corría después de cada vigilancia con cualquier cambio: ~7 veces por día.
// 4 horas (no 6): la vigilancia de las 10:30 (hora argentina) llega 4,5 horas después de la síntesis de la
// mañana; con 6, un cambio material del mediodía esperaba hasta la noche. Sin cambio material no corre igual.
export const PULSE_EVERY_H = 4;

/** true si pasaron al menos PULSE_EVERY_H horas desde la última síntesis (o nunca hubo). */
export function pulseDue(synthesizedAt: string | null, now: Date = new Date()): boolean {
  if (!synthesizedAt) return true;
  return now.getTime() - new Date(synthesizedAt).getTime() >= PULSE_EVERY_H * 3_600_000;
}
