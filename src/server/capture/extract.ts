import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";

// Extracción de una captura de campo: la IA PROPONE (docs/04-modelo-canonico.md §2).
// Nada de esto se escribe en RELEVO sin que una persona lo acepte.

export const EXTRACT_MODEL = "claude-opus-5-5";
export const EXTRACT_PROMPT_VERSION = "captura-v1";
// USD por millón de tokens (claude-opus-5-5).
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

const EVIDENCE_TYPES = ["dato", "declaracion", "observacion", "precio", "capacidad", "contacto", "propiedad", "documento", "publicacion", "otro"] as const;
const FINDING_KINDS = ["necesidad", "riesgo", "senal_de_mercado", "observacion", "pregunta"] as const;

export const ExtractionSchema = z.object({
  summary: z.string().describe("Resumen de 1-2 oraciones de lo capturado, sin interpretar."),
  company: z
    .object({
      name: z.string(),
      existing_id: z.string().nullable().describe("id de la lista de empresas existentes SOLO si es claramente la misma; si no, null."),
      locality: z.string().nullable(),
      activity: z.string().nullable(),
      quote: z.string().nullable(),
    })
    .nullable()
    .describe("La empresa o establecimiento principal de la captura, si se menciona o se infiere de la foto. null si no hay."),
  people: z.array(
    z.object({
      key: z.string().describe("Clave local: p1, p2…"),
      name: z.string().nullable().describe("Nombre si se dijo; null si solo se sabe el rol."),
      role: z.string().nullable(),
      institutional: z.boolean().describe("true si es un área o cargo sin persona identificada (\"Compras\", \"el encargado\" sin nombre)."),
      existing_id: z.string().nullable().describe("id de la lista de contactos existentes SOLO si es claramente la misma persona."),
      quote: z.string().nullable(),
    }),
  ),
  evidence: z.array(
    z.object({
      key: z.string().describe("Clave local: e1, e2…"),
      statement: z.string().describe("Un dato atómico y verificable, en una oración. Sin interpretaciones."),
      quote: z.string().nullable().describe("Fragmento TEXTUAL de la nota que lo sostiene (copiado tal cual)."),
      evidence_type: z.enum(EVIDENCE_TYPES),
      origin: z.enum(["observacion_directa", "declaracion"]).describe("observacion_directa: lo vio quien capturó. declaracion: se lo dijo alguien."),
      stated_by: z.string().nullable().describe("Clave de la persona que lo dijo (p1…), si aplica."),
      about_company: z.boolean().describe("true si el dato es sobre la empresa principal."),
      related_findings: z.array(
        z.object({
          finding_id: z.string().describe("id de la lista de findings existentes."),
          stance: z.enum(["supports", "contradicts", "contextual"]),
        }),
      ).describe("Relación con findings EXISTENTES. Incluí 'contradicts' cuando el dato va en contra: la contraevidencia es tan importante como la evidencia a favor."),
    }),
  ),
  finding_candidates: z.array(
    z.object({
      statement: z.string().describe("Hipótesis o aprendizaje posible, formulado con cautela (\"Posible…\")."),
      kind: z.enum(FINDING_KINDS),
      rationale: z.string().describe("Por qué surge y qué faltaría para sostenerlo."),
      supports: z.array(z.string()).describe("Claves de evidencia (e1…) a favor."),
      contradicts: z.array(z.string()).describe("Claves de evidencia (e1…) en contra, si hay."),
    }),
  ).describe("Solo si la captura sugiere un patrón o problema que valga la pena investigar. Puede ser una lista vacía."),
  next_actions: z.array(
    z.object({
      title: z.string().describe("Acción concreta con verbo: \"Hablar con Laura (Compras) sobre frecuencia y gasto\"."),
      why: z.string(),
      contact: z.string().nullable().describe("Clave de la persona involucrada, si hay."),
      due: z.string().nullable().describe("Fecha AAAA-MM-DD solo si la nota la menciona; si no, null."),
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const SYSTEM = `Estructurás capturas de campo de un equipo que investiga oportunidades de negocio en Añelo / Vaca Muerta (Argentina). Una captura es material crudo: una nota escrita o dictada, fotos y la ubicación.

Tu trabajo es PROPONER, no decidir: todo lo que devolvés lo revisa una persona antes de guardarse.

Reglas:
- Separá siempre lo que se observó directamente de lo que alguien declaró, y ambos de las interpretaciones. Un dato de evidencia es un hecho atómico; una hipótesis va en finding_candidates, nunca en evidence.
- No inventes nombres, cifras, fechas ni empresas. Si algo es aproximado en la nota ("unas 35"), conservá la aproximación.
- Las citas (quote) son fragmentos copiados TEXTUALMENTE de la nota o de la transcripción. Si no hay fragmento textual (p. ej. algo visto en una foto), usá null.
- La nota puede incluir la transcripción automática de un audio: puede tener errores de reconocimiento. No "corrijas" nombres, marcas ni cifras dudosas; si algo parece mal transcripto, dejalo como está y no lo uses como dato firme.
- Para no duplicar: usá existing_id solo si la empresa o persona de la lista es claramente la misma. Ante la duda, null.
- Una persona sin nombre ("el encargado", "Compras") es institutional: true.
- Revisá los findings existentes: si un dato los apoya, los contradice o les da contexto, indicalo en related_findings. Buscá activamente la contraevidencia.
- Los finding_candidates son opcionales y cautelosos: solo si hay un problema o patrón que valga la pena investigar, citando las claves de evidencia que lo sostienen o lo contradicen.
- Las próximas acciones son concretas, accionables y derivadas de la captura.
- Escribí en español rioplatense, breve.`;

export type ExtractionContext = {
  capturedAt: string;
  capturedBy: string;
  missionName: string | null;
  location: string | null;
  body: string | null;
  photos: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }[];
  companies: { id: string; name: string; locality: string | null }[];
  contacts: { id: string; name: string; role: string | null; company: string | null }[];
  findings: { id: string; statement: string }[];
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
  ].join("\n");
  const capture = [
    `CAPTURA · ${ctx.capturedAt} · por ${ctx.capturedBy}${ctx.missionName ? ` · misión ${ctx.missionName}` : ""}${ctx.location ? ` · ubicación ${ctx.location}` : ""}`,
    `NOTA:\n${ctx.body?.trim() || "(sin texto; ver fotos)"}`,
  ].join("\n");

  try {
    const response = await client.beta.messages.parse({
      model: EXTRACT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
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
    usage.costUsd = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1_000_000;
    if (response.stop_reason === "refusal") return { ok: false, status: "refused", error: "El modelo no procesó esta captura.", durationMs: Date.now() - started };
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, status: "error", error: "La respuesta llegó incompleta.", durationMs: Date.now() - started };
    }
    return { ok: true, extraction: response.parsed_output, usage, durationMs: Date.now() - started };
  } catch (e) {
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
