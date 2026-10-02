import { describe, expect, it } from "vitest";
import { parseReply, speakable } from "./reply";

const C = "contact:0fb35dac-8f4c-437f-81c0-28de12804870";
const E = "company:9474a284-4ed2-4dd2-8734-2f9816822d85";

describe("respuesta de RELEVO en la Surface", () => {
  it("separa el texto, los mensajes listos (uno por destinatario, con a quién) y las acciones", () => {
    const r = parseReply(`Los encararía distinto [[${E}]].\n\n[[mensaje para: ${C}]]\nHola Evangelina\n[[/mensaje]]\n\n[[mensaje]]Hola, administración[[/mensaje]]\n\n[[acción: Prepararlos]]\n[[acción: Buscar contacto]]`);
    expect(r.body).toBe("Los encararía distinto.");
    expect(r.messages).toEqual([{ to: C, text: "Hola Evangelina" }, { to: null, text: "Hola, administración" }]);
    expect(r.actions).toEqual(["Prepararlos", "Buscar contacto"]);
  });

  it("en voz no lee los mensajes: avisa que quedaron en pantalla", () => {
    expect(speakable(`Le escribiría hoy. [[mensaje para: ${C}]]Hola[[/mensaje]]`)).toBe("Le escribiría hoy. Te dejé el mensaje listo en la pantalla.");
  });
});
