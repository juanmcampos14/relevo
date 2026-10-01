import { describe, expect, it } from "vitest";
import { parseReply } from "./conversation";

describe("respuesta de RELEVO en la Surface", () => {
  it("separa el texto, los mensajes listos (uno por destinatario) y las acciones", () => {
    const r = parseReply("Los encararía distinto.\n\n[[mensaje]]\nHola Evangelina\n[[/mensaje]]\n\n[[mensaje]]Hola, administración[[/mensaje]]\n\n[[acción: Prepararlos]]\n[[acción: Buscar contacto]]");
    expect(r.body).toBe("Los encararía distinto.");
    expect(r.messages).toEqual(["Hola Evangelina", "Hola, administración"]);
    expect(r.actions).toEqual(["Prepararlos", "Buscar contacto"]);
  });
});
