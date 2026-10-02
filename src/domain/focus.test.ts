import { describe, expect, it } from "vitest";
import { EMPTY_FOCUS, correct, mergeSynthesis, moveIsFresh, resolveByRefs, visible, type Focus } from "./focus";

const now = new Date("2026-10-02T12:00:00Z");
let n = 0;
const id = () => `i${++n}`;
const FERRELEC = "company:11111111-1111-1111-1111-111111111111";
const HOTEL = "company:22222222-2222-2222-2222-222222222222";
const TRUCKS = "company:33333333-3333-3333-3333-333333333333";
const base = () => mergeSynthesis(EMPTY_FOCUS, {
  today: [
    { title: "Mandar el pedido de reunión a FERRELEC", why: "Abre la puerta en Añelo", refs: [FERRELEC] },
    { title: "Escribir al Hotel Da Vinci y a World Trucks", why: "Mañana se vence", refs: [HOTEL, TRUCKS] },
  ],
  week: [{ title: "Preparar AOG", why: "Faltan 17 días", refs: [] }],
}, now, id);

describe("foco de RELEVO", () => {
  it("muestra lo de hoy, sin forzar tres", () => {
    expect(visible(base(), now).map((x) => x.title)).toEqual(["Mandar el pedido de reunión a FERRELEC", "Escribir al Hotel Da Vinci y a World Trucks"]);
  });

  it("al mandar el mensaje la prioridad desaparece; resuelto lo de hoy aparece lo siguiente", () => {
    let f: Focus = resolveByRefs(base(), [FERRELEC], "Mensaje enviado", now).focus;
    expect(visible(f, now).map((x) => x.title)).toEqual(["Escribir al Hotel Da Vinci y a World Trucks"]);
    // Con dos empresas, se resuelve cuando las dos tuvieron su paso.
    f = resolveByRefs(f, [HOTEL], "Mensaje enviado", now).focus;
    expect(visible(f, now)).toHaveLength(1);
    f = resolveByRefs(f, [TRUCKS], "Mensaje enviado", now).focus;
    expect(visible(f, now).map((x) => x.title)).toEqual(["Preparar AOG"]);
  });

  it("la persona corrige en un segundo y queda registrado para el Brain", () => {
    const f0 = base();
    const [a, b] = f0.items;
    let f = correct(f0, { kind: "primero", id: b.id }, "tano", now);
    expect(visible(f, now)[0].id).toBe(b.id);
    f = correct(f, { kind: "posponer", id: a.id, until: "2026-10-03", note: "FERRELEC mañana" }, "tano", now);
    expect(visible(f, now).map((x) => x.id)).toEqual([b.id]);
    expect(visible(f, new Date("2026-10-03T12:00:00Z")).map((x) => x.id)).toEqual([b.id, a.id]);
    f = correct(f, { kind: "sacar", id: b.id, note: "ya no importa" }, "tano", now);
    expect(f.log[0]).toMatchObject({ by: "tano", what: "la sacó", note: "ya no importa" });
  });

  it("una nueva síntesis respeta lo que la persona decidió", () => {
    const f0 = base();
    const [a, b] = f0.items;
    let f = correct(f0, { kind: "sacar", id: a.id }, "tano", now);
    f = correct(f, { kind: "primero", id: b.id }, "tano", now);
    f = correct(f, { kind: "agregar", id: "mio", title: "Ver locales en Libertador", first: false }, "tano", now);
    const later = new Date("2026-10-03T09:00:00Z");
    f = mergeSynthesis(f, {
      today: [
        { title: "Mandar el pedido de reunión a FERRELEC (Genelec)", why: "", refs: [FERRELEC] },
        { title: "Llamar a Tecpetrol", why: "", refs: ["company:44444444-4444-4444-4444-444444444444"] },
      ],
      week: [],
    }, later, id);
    const titles = visible(f, later).map((x) => x.title);
    expect(titles[0]).toBe("Escribir al Hotel Da Vinci y a World Trucks");
    expect(titles).toContain("Ver locales en Libertador");
    expect(titles).toContain("Llamar a Tecpetrol");
    expect(titles.some((t) => t.includes("FERRELEC"))).toBe(false);
  });

  it("el Avanzar preparado vence si cambia la prioridad o pasa un día", () => {
    const it0 = { ...base().items[0], move: { text: "x", citations: [], at: now.toISOString() } };
    expect(moveIsFresh(it0, now)).toBe(true);
    expect(moveIsFresh(it0, new Date(now.getTime() + 21 * 3_600_000))).toBe(false);
    expect(moveIsFresh({ ...it0, updated_at: new Date(now.getTime() + 1000).toISOString() }, now)).toBe(false);
  });
});

describe("firma de los mensajes preparados", () => {
  it("firma con el nombre de quien lo manda; sin nombre, la marca no queda en el mensaje", async () => {
    const { signMessages } = await import("./focus");
    expect(signMessages("Hola, soy [[firma]], de Daicou.", "Estanislao Vilamajo")).toBe("Hola, soy Estanislao Vilamajo, de Daicou.");
    expect(signMessages("Hola. Soy [[firma]], estamos relevando.\n[[firma]]", null)).toBe("Hola. estamos relevando.\n");
  });
});

describe("Ahora personal dentro de la misión compartida", () => {
  it("cada uno ve lo suyo y lo de cualquiera, no lo que es de otro", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    let k = 0;
    const f = mergeSynthesis(EMPTY_FOCUS, {
      today: [
        { title: "Llamar a Juan Migliore", why: "", refs: [], for_user: "tano" },
        { title: "Confirmar las casas", why: "", refs: [], for_user: "fran" },
        { title: "Preparar AOG", why: "", refs: [] },
      ],
      week: [],
    }, now, () => `x${++k}`);
    expect(visible(f, now, 3, "tano").map((x) => x.title)).toEqual(["Llamar a Juan Migliore", "Preparar AOG"]);
    expect(visible(f, now, 3, "fran").map((x) => x.title)).toEqual(["Confirmar las casas", "Preparar AOG"]);
  });
});
