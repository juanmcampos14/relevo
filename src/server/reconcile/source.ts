import "server-only";

import { createHash } from "node:crypto";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { PARTY_ROLES } from "@/domain/candidate";
import { knownEvents } from "@/server/mission/material";
import { deepCall } from "@/server/mission/deep";
import { entityPool, judgeFacts, reconcileFact, type Ctx, type Fact, type Judgement, type Outcome } from "./engine";

// Una fuente → hechos → juicio → reconciliación → registro fila por fila (lote). Sirve para el Radar, para
// un documento (p. ej. lo que manda Fran) y para cualquier otra fuente que se pueda convertir en hechos.

type Db = SupabaseClient<Database>;
export type SourceRun = { batchId: string | null; outcomes: Outcome[]; costUsd: number };

export async function reconcileSource(
  db: Db,
  ctx: Ctx & { system: "radar" | "documento"; fileName: string; content: string },
  facts: Fact[],
  opts: { client?: Pick<Anthropic, "beta">; judged?: Map<string, Judgement> } = {},
): Promise<SourceRun> {
  const known = await knownEvents(db, ctx.missionId, 120);
  const pool = await entityPool(db);
  const { judged, costUsd } = opts.judged ? { judged: opts.judged, costUsd: 0 } : await judgeFacts(db, ctx, facts, known, opts.client);
  const outcomes: Outcome[] = [];
  for (const f of facts) {
    // Sin juicio (falló la IA) no se decide por la persona: queda para revisar, como contexto.
    const j = judged.get(f.key) ?? { same_as: null, material: false, triage: "next" as const, why: "Sin juicio automático: revisar.", finding_ids: [], candidate_ids: [], next_action: null, watch: null };
    const o = await reconcileFact(db, ctx, f, j, known, pool);
    if (!judged.has(f.key)) o.review.push("RELEVO no pudo juzgarlo: revisalo.");
    outcomes.push(o);
  }
  if (ctx.dryRun) return { batchId: null, outcomes, costUsd };
  const sha = createHash("sha256").update(ctx.content).digest("hex");
  const summary = { total: outcomes.length, ...Object.fromEntries((["crear", "actualizar", "sin_cambios", "conflicto", "rechazar"] as const).map((a) => [a, outcomes.filter((o) => o.action === a).length])), material: outcomes.filter((o) => o.material).length, revisar: outcomes.filter((o) => o.review.length).length, costUsd };
  const { data: b, error } = await db.from("import_batches").insert({ workspace_id: ctx.workspaceId, source_system: ctx.system, file_name: ctx.fileName.slice(0, 300), file_sha256: sha, status: "aplicado", summary: summary as unknown as NonNullable<Json>, closed_at: new Date().toISOString() }).select("id").single();
  if (error) throw error;
  await db.from("import_rows").insert(outcomes.map((o, i) => ({
    workspace_id: ctx.workspaceId, batch_id: b.id, entity_type: "fact" as const, external_id: o.key, sheet: ctx.system, row_number: i + 1,
    raw: facts[i] as unknown as NonNullable<Json>, mapped: o as unknown as NonNullable<Json>, action: o.action, target_entity_id: o.signalId,
    issues: o.review as unknown as NonNullable<Json>, conflicts: (o.contradiction ? [o.contradiction] : []) as unknown as NonNullable<Json>,
    decision: o.review.length ? ("pendiente" as const) : ("aprobada" as const), applied_at: new Date().toISOString(),
  })));
  return { batchId: b.id, outcomes, costUsd };
}

// ---------------------------------------------------------------------------------------------------
// Documento → hechos (lo que dice, de quién, con qué datos), para reconciliar.

const ExtractSchema = z.object({
  facts: z.array(z.object({
    statement: z.string().describe("El hecho, en una oración, tal como lo dice el documento (sin interpretarlo)."),
    basis: z.enum(["hecho", "declaracion", "inferencia"]).describe("hecho: verificable/documentado; declaracion: lo dice alguien; inferencia: lectura del autor."),
    entities: z.array(z.object({ kind: z.enum(["empresa", "persona", "activo"]), name: z.string(), role: z.enum(PARTY_ROLES).nullable() })),
    values: z.array(z.object({ variable: z.string().describe("capacidad_nominal, utilizacion, demanda_rechazada, capacidad_futura, recurso_limitante, precio_unidad, costo_variable_unidad, u otra en snake_case"), value: z.string(), unit: z.string().nullable(), about: z.string().nullable().describe("A qué empresa se refiere el dato, si no es obvio.") })),
  })),
});

export async function documentFacts(db: Db, o: { workspaceId: string; title: string; text: string; client?: Pick<Anthropic, "beta"> }): Promise<{ facts: Fact[]; costUsd: number }> {
  const r = await deepCall(db, {
    workspaceId: o.workspaceId, promptVersion: "documento-hechos-v1", effort: "low", schema: ExtractSchema, client: o.client,
    system: "Extraés de un documento de trabajo los hechos que importan para investigar oportunidades de negocio: qué pasa, de quién, con qué números (capacidad, utilización, demanda rechazada, capacidad futura, precio y costo por unidad). No inventes datos ni números. Español.",
    prompt: `DOCUMENTO: ${o.title}\n\n${o.text.slice(0, 60_000)}`,
  });
  if (!r.ok) throw new Error(r.message);
  return { facts: r.value.facts.map((f, i) => ({ key: `doc-${i + 1}`, statement: f.statement, basis: f.basis, entities: f.entities.map((e) => ({ kind: e.kind, name: e.name, role: e.role })), values: f.values })), costUsd: r.costUsd };
}

/** Le doy un documento a RELEVO: lo lee, lo entiende, lo reconcilia y dice qué cambió. */
export async function ingestDocument(db: Db, o: { workspaceId: string; missionId: string; title: string; text: string; client?: Pick<Anthropic, "beta">; dryRun?: boolean }): Promise<SourceRun> {
  const ex = await documentFacts(db, o);
  const run = await reconcileSource(db, { workspaceId: o.workspaceId, missionId: o.missionId, origin: "captura", sourceLabel: `Documento: ${o.title}`, system: "documento", fileName: o.title, content: o.text, dryRun: o.dryRun }, ex.facts, { client: o.client });
  return { ...run, costUsd: run.costUsd + ex.costUsd };
}
