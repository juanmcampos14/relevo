import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { costOf } from "@/server/ai/pricing";

// Extracción de una captura de campo: la IA PROPONE (docs/04-modelo-canonico.md §2).
// Nada de esto se escribe en RELEVO sin que una persona lo acepte.

export const EXTRACT_MODEL = "claude-opus-5-5";
export const EXTRACT_PROMPT_VERSION = "captura-v9";

const EVIDENCE_TYPES = ["dato", "declaracion", "observacion", "precio", "capacidad", "contacto", "propiedad", "documento", "publicacion", "otro"] as const;
const FINDING_KINDS = ["necesidad", "riesgo", "senal_de_mercado", "observacion", "pregunta"] as const;

export const ExtractionSchema = z.object({
  summary: z.string().describe("Resumen de 1-2 oraciones de lo capturado, sin interpretar."),
  company: z
    .object({
      name: z.string().describe("Nombre propio; si no se sabe, una descripción: \"Contratista con ~35 personas en la zona\"."),
      identified: z.boolean().describe("true solo si se conoce el nombre propio de la organización. Sin nombre queda como organización sin identificar, no como empresa."),
      existing_id: z.string().nullable().describe("id de la lista de empresas existentes SOLO si es claramente la misma."),
      resolves: z.string().nullable().describe("id de la lista de entidades sin identificar si esta captura revela que es esa organización."),
      locality: z.string().nullable(),
      activity: z.string().nullable(),
    })
    .nullable()
    .describe("La empresa u organización principal de la captura, si se menciona o se ve (cartel con nombre). null si no hay."),
  asset: z
    .object({
      title: z.string().describe("Nombre corto que identifica el activo (qué es y dónde): \"Local comercial en Los Algarrobos\". Nunca la narrativa del vendedor (renta, capacidad proyectada, \"oportunidad única\"): eso va como lo que declara el vendedor."),
      kind: z.enum(["inmueble", "terreno", "local", "fondo_de_comercio", "otro"]),
      operation: z.enum(["venta", "alquiler", "asociacion", "desconocida"]),
      address_text: z.string().nullable(),
      locality: z.string().nullable(),
      surface_m2: z.number().nullable().describe("Solo si figura; es lo que DICE la fuente, no algo medido."),
      here: z.boolean().describe("true SOLO si quien capturó está en el lugar del activo (lo está viendo, está parado ahí). false si lo menciona desde otro lado: entonces su ubicación NO es la del activo."),
    })
    .nullable()
    .describe("Un activo físico observado o mencionado (local, terreno, galpón, hotel, fondo de comercio), sobre todo si está en venta o alquiler. null si no hay."),
  people: z.array(
    z.object({
      key: z.string().describe("Clave local: p1, p2…"),
      name: z.string().nullable().describe("Nombre si se dijo; vacío si solo se sabe el rol."),
      role: z.string().nullable(),
      institutional: z.boolean().describe("true si es un área o cargo sin persona identificada (\"Compras\", \"el encargado\" sin nombre)."),
      existing_id: z.string().nullable().describe("id de la lista de contactos existentes SOLO si es claramente la misma persona."),
      resolves: z.string().nullable().describe("id de la lista de entidades sin identificar si esta captura revela que es ese actor."),
      owns_asset: z.boolean().describe("true si la nota dice que esta persona es dueña/propietaria del activo de la captura."),
      url: z.string().nullable().describe("Link a su perfil (LinkedIn, sitio) si la nota lo trae; null si no."),
    }),
  ).describe("Personas de afuera del equipo. Nunca incluyas a alguien del EQUIPO (quien captura y sus compañeros): no son contactos."),
  evidence: z.array(
    z.object({
      key: z.string().describe("Clave local: e1, e2…"),
      statement: z.string().describe("Un dato atómico y verificable SOBRE EL MUNDO (algo que pasa, existe, cuesta o dijo alguien de afuera), en una oración. Sin interpretaciones. Lo que el equipo quiere o define no es un dato: va en context."),
      quote: z.string().nullable().describe("Fragmento TEXTUAL de la nota que lo sostiene (copiado tal cual)."),
      evidence_type: z.enum(EVIDENCE_TYPES),
      origin: z
        .enum(["observado", "declarado_por_persona", "declarado_por_documento"])
        .describe("observado: quien capturó lo vio con sus propios ojos (\"hay un cartel de alquiler\"). declarado_por_persona: se lo dijo alguien. declarado_por_documento: lo afirma un cartel, aviso, folleto o documento (\"el cartel dice 35 m²\")."),
      stated_by: z.string().nullable().describe("Clave de la persona que lo dijo (p1…), si origin es declarado_por_persona."),
      declared_by: z.string().nullable().describe("Si origin es declarado_por_documento: qué lo afirma (\"aviso de alquiler en la vidriera\")."),
      about: z.enum(["company", "asset", "none"]).describe("Sobre qué es el dato: la organización principal (identificada o no), el activo, o ninguno de los dos."),
    }),
  ),
  context: z.array(z.string()).describe("Lo que el EQUIPO busca, decide o define para su misión (parámetros, restricciones, concepto, presupuesto, preferencias: \"busco locales de 40 a 60 m²\", \"tope de alquiler $2 M\", \"no necesito salida de humos\"). Es contexto declarado, NO evidencia del mundo: nunca lo pongas en evidence. Una oración por punto; vacío si no hay."),
  finding_candidates: z.array(
    z.object({
      statement: z.string().describe("Hipótesis o aprendizaje posible, formulado con cautela (\"Posible…\")."),
      existing_finding_id: z.string().nullable().describe("Si la evidencia es sobre una hipótesis EXISTENTE (aunque esté redactada distinto), su id: se suma a esa en lugar de crear otra."),
      relation: z
        .enum(["nueva", "apoya", "contradice", "acota", "amplia", "segmenta"])
        .describe("nueva: no hay una existente. Con existing_finding_id: apoya, contradice, acota (la restringe), amplia (la extiende) o segmenta (vale para unos y no para otros)."),
      refined_statement: z.string().nullable().describe("Si acota, amplia o segmenta: la hipótesis existente reformulada con lo nuevo (\"La necesidad de comida parece depender del esquema de alimentación de cada empresa\")."),
      is_idea: z.boolean().describe("true si es una idea o intuición de quien capturó (\"se podría poner una parrilla\") sin evidencia de demanda."),
      kind: z.enum(FINDING_KINDS),
      rationale: z.string().describe("Por qué surge y qué faltaría para sostenerlo."),
      supports: z.array(z.string()).describe("Claves de evidencia (e1…) a favor."),
      contradicts: z.array(z.string()).describe("Claves de evidencia (e1…) en contra, si hay."),
    }),
  ).describe("Solo si la captura sugiere un patrón o problema que valga la pena investigar. Puede ser una lista vacía."),
  unknowns: z.array(z.string()).describe("Qué todavía no sabemos que importa para decidir (nombre de la empresa, frecuencia, quién decide…). Máximo 5, cortas."),
  next_actions: z.array(
    z.object({
      title: z.string().describe("Acción concreta con verbo: \"Hablar con Laura (Compras) sobre frecuencia y gasto\"."),
      why: z.string(),
      contact: z.string().nullable().describe("Clave de la persona involucrada, si hay."),
      due: z.string().nullable().describe("Fecha AAAA-MM-DD solo si la nota la menciona."),
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// Límite de la API: la gramática compilada de structured outputs tiene un tope, y cada texto
// "o null" la agranda mucho (captura-v3 lo superó: 400 "compiled grammar is too large").
// Hacia Claude, los textos opcionales viajan como texto ("" = no aplica); al volver se
// normalizan a null, así el resto de RELEVO sigue viendo ExtractionSchema. El margen que
// queda es chico: antes de sumar campos, correr el contrato real (extract.contract.local.test.ts).
function wire(t: z.ZodType): z.ZodType {
  if (t instanceof z.ZodNullable && t.unwrap() instanceof z.ZodString) {
    return z.string().describe(`${t.description ?? (t.unwrap() as z.ZodType).description ?? ""} Texto vacío si no aplica.`.trim());
  }
  if (t instanceof z.ZodNullable && t.unwrap() instanceof z.ZodObject) return z.nullable(wire(t.unwrap() as z.ZodType)).describe(t.description ?? "");
  if (t instanceof z.ZodObject) {
    const o = z.object(Object.fromEntries(Object.entries(t.shape).map(([k, v]) => [k, wire(v as z.ZodType)])));
    return t.description ? o.describe(t.description) : o;
  }
  if (t instanceof z.ZodArray) {
    const a = z.array(wire(t.element as z.ZodType));
    return t.description ? a.describe(t.description) : a;
  }
  return t;
}
export const WireSchema = wire(ExtractionSchema) as z.ZodObject;

/** Vuelve del formato de la API al de RELEVO: "" → null donde ExtractionSchema admite null. */
export function fromWire(value: unknown, t: z.ZodType = ExtractionSchema): unknown {
  if (t instanceof z.ZodNullable) {
    if (value === null || value === undefined) return null;
    if (t.unwrap() instanceof z.ZodString) return typeof value === "string" && value.trim() === "" ? null : value;
    return fromWire(value, t.unwrap() as z.ZodType);
  }
  if (t instanceof z.ZodObject && value && typeof value === "object") {
    return Object.fromEntries(Object.entries(t.shape).map(([k, v]) => [k, fromWire((value as Record<string, unknown>)[k], v as z.ZodType)]));
  }
  if (t instanceof z.ZodArray && Array.isArray(value)) return value.map((x) => fromWire(x, t.element as z.ZodType));
  return value;
}

export const SYSTEM = `Estructurás capturas de campo de un equipo que investiga oportunidades de negocio en Argentina (la zona y el objetivo los define la misión). Una captura es material crudo: una nota escrita o dictada, fotos y la ubicación.

Tu trabajo es PROPONER, no decidir: todo lo que devolvés lo revisa una persona antes de guardarse.

Reglas:
- Distinguí siempre tres cosas: lo OBSERVADO por quien capturó ("se observó un cartel de alquiler"), lo DECLARADO por una persona, y lo DECLARADO por un documento, cartel o aviso ("el aviso dice 35 m²"). Ver un cartel verifica que el cartel existe, no lo que el cartel dice: los datos que figuran en el cartel son declarados_por_documento. "Observado" es solo lo que se ve directamente (el local existe, está cerrado, tiene terraza, hay un cartel). Medidas, superficies, precios, cantidades y frecuencias casi nunca se ven: si la nota no dice que se midieron o de dónde salen, son declarado_por_persona con stated_by vacío (lo afirma quien capturó, sin fuente) y el enunciado lo dice ("Según quien capturó, tiene 60 m²; fuente no indicada"). Ante la duda, nunca "observado". Un dato de evidencia es un hecho atómico; una hipótesis va en finding_candidates, nunca en evidence.
- No inventes nombres, cifras, fechas ni empresas. Si algo es aproximado en la nota ("unas 35"), conservá la aproximación.
- Las citas (quote) son fragmentos copiados TEXTUALMENTE de la nota o de la transcripción. Si no hay fragmento textual (p. ej. algo visto en una foto), dejalo vacío.
- La nota puede incluir la transcripción automática de un audio: puede tener errores de reconocimiento. No "corrijas" nombres, marcas ni cifras dudosas; si algo parece mal transcripto, dejalo como está y no lo uses como dato firme.
- Para no duplicar: usá existing_id solo si la empresa o persona de la lista es claramente la misma. Ante la duda, dejalo vacío.
- Una persona sin nombre ("el encargado", "Compras") es institutional: true.
- Revisá los findings existentes: si la captura los apoya o los contradice, proponé un finding_candidate con su existing_finding_id, la relación y las claves de evidencia a favor y en contra. Buscá activamente la contraevidencia.
- Organizaciones y personas sin nombre ("una contratista", "un chofer de una petrolera") son fuentes válidas, pero no se inventan identidades: company.identified = false con una descripción como nombre; persona sin nombre con su rol. Si la captura revela quién es una de las ENTIDADES SIN IDENTIFICAR de la lista ("el encargado de la otra vez se llama Juan Pérez"), indicá su id en resolves.
- Antes de proponer una hipótesis nueva, preguntate si lo nuevo apoya, contradice, acota, amplía o segmenta una existente. Dos observaciones opuestas suelen refinar una hipótesis ("depende del esquema de alimentación de cada empresa"), no crear dos contrapuestas.
- Una idea de quien capturó no es evidencia de demanda: is_idea = true.
- Los finding_candidates son opcionales y cautelosos: solo si hay un problema o patrón que valga la pena investigar, citando las claves de evidencia que lo sostienen o lo contradicen. Antes de proponer uno nuevo, revisá los findings existentes: si es la misma hipótesis con otras palabras, indicá existing_finding_id (duplicar un finding rompe el conteo de casos).
- Las próximas acciones son concretas, accionables y derivadas de la captura.
- Si un campo de texto no aplica, dejalo vacío ("").
- Escribí en español rioplatense, breve.`;

export type ExtractionContext = {
  capturedAt: string;
  capturedBy: string;
  missionName: string | null;
  /** El equipo (no son contactos): "Tano (Estanislao Vilamajo), Juan (Juan Campos)". */
  team?: string | null;
  location: string | null;
  body: string | null;
  photos: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }[];
  companies: { id: string; name: string; locality: string | null }[];
  contacts: { id: string; name: string; role: string | null; company: string | null }[];
  findings: { id: string; statement: string }[];
  unresolved: { id: string; kind: "organization" | "actor"; label: string }[];
  /** Tema de la conversación en la que se contó esto (contexto; no es parte de la nota ni se cita). */
  focus?: string | null;
};

export type ExtractionResult =
  | { ok: true; extraction: Extraction; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number }; durationMs: number }
  | { ok: false; status: "error" | "refused"; error: string; durationMs: number };

export async function extractCapture(client: Anthropic, ctx: ExtractionContext): Promise<ExtractionResult> {
  const started = Date.now();
  // Lo estable primero (lo reutiliza la caché): listas del workspace. Lo variable al final: la captura.
  const reference = [
    "EMPRESAS EXISTENTES (id · nombre · localidad):",
    ...ctx.companies.map((c) => `${c.id} · ${c.name}${c.locality ? ` · ${c.locality}` : ""}`),
    "",
    "CONTACTOS EXISTENTES (id · nombre · cargo · empresa):",
    ...ctx.contacts.map((c) => `${c.id} · ${c.name}${c.role ? ` · ${c.role}` : ""}${c.company ? ` · ${c.company}` : ""}`),
    "",
    "FINDINGS EXISTENTES (id · enunciado):",
    ...ctx.findings.map((f) => `${f.id} · ${f.statement}`),
    "",
    "ENTIDADES SIN IDENTIFICAR (id · tipo · cómo se las reconoce):",
    ...ctx.unresolved.map((u) => `${u.id} · ${u.kind === "organization" ? "organización" : "persona"} · ${u.label}`),
  ].join("\n");
  const capture = [
    `CAPTURA · ${ctx.capturedAt} · por ${ctx.capturedBy}${ctx.missionName ? ` · misión ${ctx.missionName}` : ""}${ctx.location ? ` · ubicación de quien captura ${ctx.location}` : ""}`,
    ctx.team ? `EQUIPO (no son personas a extraer ni contactos; lo que digan es del equipo: origin observado, stated_by null): ${ctx.team}` : null,
    ctx.focus ? `TEMA DE LA CONVERSACIÓN (contexto, no es parte de la nota; probablemente la nota se relaciona con esto): ${ctx.focus}` : null,
    `NOTA:\n${ctx.body?.trim() || "(sin texto; ver fotos)"}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await client.beta.messages.parse({
      model: EXTRACT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(WireSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: reference, cache_control: { type: "ephemeral" } },
            ...ctx.photos.map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 } })),
            { type: "text", text: capture },
          ],
        },
      ],
    });
    const u = response.usage;
    const usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      costUsd: 0,
    };
    usage.costUsd = costOf(EXTRACT_MODEL, usage);
    if (response.stop_reason === "refusal") return { ok: false, status: "refused", error: "El modelo no procesó esta captura.", durationMs: Date.now() - started };
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, status: "error", error: "La respuesta llegó incompleta.", durationMs: Date.now() - started };
    }
    const parsed = ExtractionSchema.safeParse(fromWire(response.parsed_output));
    if (!parsed.success) return { ok: false, status: "error", error: "La respuesta no tiene el formato esperado.", durationMs: Date.now() - started };
    return { ok: true, extraction: parsed.data, usage, durationMs: Date.now() - started };
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error("extractCapture", e.status, e.message);
    const message =
      e instanceof Anthropic.RateLimitError
        ? "Límite de uso del proveedor de IA: reintentá en unos minutos."
        : e instanceof Anthropic.APIConnectionError
          ? "Sin conexión con el proveedor de IA."
          : e instanceof Anthropic.APIError
            ? `Error del proveedor de IA (${e.status}).`
            : "No se pudo procesar la captura.";
    return { ok: false, status: "error", error: message, durationMs: Date.now() - started };
  }
}
