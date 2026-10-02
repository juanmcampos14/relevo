// Cómo se lee una respuesta de RELEVO en la Surface: el texto, los mensajes listos (uno por destinatario,
// con a quién van) y como mucho dos acciones. Las citas internas no se muestran: la Surface no explica el
// sistema; la profundidad aparece cuando se pide.

export type ReadyMessage = { to: string | null; text: string };
export type Reply = { body: string; actions: string[]; messages: ReadyMessage[] };

const ACTION = /\[\[acci[oó]n:\s*([^\]]+)\]\]/gi;
const MESSAGE = /\[\[mensaje(?:\s+para:\s*((?:contact|company):[0-9a-f-]{36}))?\]\]([\s\S]*?)\[\[\/mensaje\]\]/gi;
const CITE = /\s?\[\[[a-z]+:[0-9a-f-]{36}\]\]/g;

export function parseReply(text: string): Reply {
  const actions = [...text.matchAll(ACTION)].map((m) => m[1].trim()).slice(0, 2);
  const messages = [...text.matchAll(MESSAGE)].map((m) => ({ to: m[1] ?? null, text: m[2].trim().replace(CITE, "") })).filter((m) => m.text);
  const body = text.replace(ACTION, "").replace(MESSAGE, "").replace(CITE, "").replace(/\s?\[referencia no verificada\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { body, actions, messages };
}

/** Texto para decir en voz alta: sin marcas ni formato; si dejó mensajes listos, lo dice en una frase. */
export function speakable(text: string): string {
  const r = parseReply(text);
  const body = r.body.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  if (!r.messages.length) return body;
  return `${body} ${r.messages.length === 1 ? "Te dejé el mensaje listo en la pantalla." : "Te dejé los mensajes listos en la pantalla."}`;
}
