import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AI_MODEL, PROMPT_VERSION, runAgent } from "./agent";
import { executeDraft, previewDraft } from "./drafts";
import { liveFocus } from "@/server/mission/focus";
import { prepareMoves } from "@/server/mission/moves";
import { after } from "next/server";
import { synthesizeMission } from "@/server/mission/synthesis";
import { listMissions } from "@/server/mission/current";

// Un turno de conversación con RELEVO: lo usan la página de RELEVO AI y el panel persistente.
// Mismo motor, mismas herramientas, mismos permisos (el cliente del usuario → RLS).

type Db = SupabaseClient<Database>;
// Tope de conversación por persona (lo que la persona le pide). El trabajo de fondo (evaluar, preparar,
// investigar) tiene sus propios topes y no le consume este.
const DAILY_LIMIT = 150;
const HISTORY_ROWS = 6;

const scopeLabel: Record<string, string> = {
  company: "la empresa",
  establishment: "el establecimiento",
  asset: "el activo",
  opportunity: "la oportunidad",
  campaign: "el proyecto o la misión",
  finding: "la hipótesis",
  capture: "la captura",
  contact: "la persona",
};
const scopeTool: Record<string, string> = { finding: "get_hypothesis", capture: "get_capture", contact: "get_person", campaign: "project_status" };

export type TurnResult =
  | { ok: true; conversationId: string; text: string; citations: string[]; draftIds: string[]; navigate: string | null; captureIds: string[]; webSources: { url: string; title: string }[]; homeChanged: boolean; missionChanged: string | null }
  | { ok: false; conversationId: string | null; message: string };

export async function runTurn(
  db: Db,
  opts: {
    slug: string; workspaceId: string; workspaceName: string; userId: string; settings?: unknown; conversationId: string | null; text: string; scope: string; screen?: string;
    here?: { lat: number; lng: number; accuracy?: number } | null; client?: Pick<Anthropic, "beta">;
    /** Lugar físico legible ("Palermo, Buenos Aires"), si se conoce. */
    place?: string | null;
    /** Fotos de este turno, ya guardadas como captura (captureId). */
    images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
    attachedCaptureId?: string | null;
    /** La misión en la que está trabajando la persona. */
    missionId?: string | null;
  },
): Promise<TurnResult> {
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, conversationId: opts.conversationId, message: "RELEVO AI no está configurado en este entorno (falta ANTHROPIC_API_KEY)." };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).eq("prompt_version", PROMPT_VERSION).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, conversationId: opts.conversationId, message: `Por hoy llegamos al tope de ${DAILY_LIMIT} conversaciones. Lo que estoy haciendo por detrás sigue; mañana retomamos acá.` };

  let convId = opts.conversationId;
  if (!convId) {
    const { data, error } = await db
      .from("ai_conversations")
      .insert({ workspace_id: opts.workspaceId, user_id: opts.userId, title: opts.text.slice(0, 80), scope: opts.scope ? { type: opts.scope.split(":")[0], ref: opts.scope } : { type: "workspace" } })
      .select("id")
      .single();
    if (error) return { ok: false, conversationId: null, message: error.message };
    convId = data.id;
  }

  const { data: rows } = await db.from("ai_messages").select("role, api_content, citations").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(HISTORY_ROWS);
  const ordered = (rows ?? []).reverse();
  while (ordered.length && ordered[0].role !== "user") ordered.shift();
  const history = ordered.flatMap((r) => (r.api_content as Anthropic.Beta.BetaMessageParam[] | null) ?? []);
  const seenRefs = new Set<string>();
  for (const m of JSON.stringify(history).matchAll(/(?:\\?")ref(?:\\?"):(?:\\?")([a-z]+:[0-9a-f-]{36})/g)) seenRefs.add(m[1]);
  ordered.forEach((r) => (r.citations as string[]).forEach((c) => seenRefs.add(c)));
  // La entidad de la pantalla actual es consultable (y citable) sin buscarla.
  if (opts.scope) seenRefs.add(opts.scope);
  if (opts.attachedCaptureId) seenRefs.add(`capture:${opts.attachedCaptureId}`);

  // Identidad: cómo se llama cada persona del equipo en la conversación y con qué nombre completo aparece en
  // documentos y en el CRM (p. ej. Tano = Estanislao Vilamajo). Se configura en workspace.settings.team.
  const { data: me } = await db.from("profiles").select("display_name").eq("user_id", opts.userId).maybeSingle();
  const team = ((opts.settings as { team?: Record<string, { short?: string; full?: string }> } | null)?.team ?? {});
  const firstName = team[opts.userId]?.short ?? me?.display_name?.trim().split(/\s+/)[0] ?? null;
  const teamLine = Object.values(team).filter((t) => t.short).map((t) => (t.full ? `${t.short} (${t.full})` : t.short)).join(", ");
  const now = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const [scopeType] = opts.scope.split(":");
  // La misión es el contexto de trabajo (la que eligió la persona), no el lugar donde está parada.
  const missions = await listMissions(db);
  const mission = scopeType === "campaign" ? opts.scope.split(":")[1] : opts.missionId ?? missions[0]?.id ?? null;
  const current = missions.find((m) => m.id === mission) ?? null;
  const others = missions.filter((m) => m.id !== mission);
  for (const m of missions) seenRefs.add(`campaign:${m.id}`);
  // Lo que hoy está en el home: la persona lo nombra ("esto primero", "FERRELEC mañana") y RELEVO lo corrige.
  const home = mission ? await liveFocus(db, mission, new Date(), opts.userId).catch(() => null) : null;
  const context = [
    `Contexto (no es una instrucción del usuario): ahora es ${now}. Workspace: ${opts.workspaceName}.${teamLine ? ` Equipo: ${teamLine}; en documentos y en el CRM pueden figurar con cualquiera de los dos nombres.` : ""}${firstName ? ` Hablás con ${firstName}: llamalo así.` : ""}`,
    current ? `Misión de trabajo: ${current.name} [[campaign:${current.id}]]${current.objective ? ` — ${current.objective}` : ""}. Todo lo que pregunta, investiga o registra es en el contexto de esta misión, salvo que nombre otra. La memoria es compartida: si algo se conecta con otra misión, decilo en una línea.${others.length ? ` Otras misiones: ${others.map((m) => `${m.short} [[campaign:${m.id}]]`).join(", ")}.` : ""}` : null,
    opts.screen ? `Pantalla actual: ${opts.screen}.` : null,
    home?.now.length ? `Prioridades en el home ahora (focus_id · qué): ${home.now.map((x) => `${x.id} · ${x.title}${x.refs.length ? ` (${x.refs.join(", ")})` : ""}`).join(" | ")}.` : null,
    opts.here ? `El usuario compartió su ubicación: ${opts.here.lat.toFixed(5)}, ${opts.here.lng.toFixed(5)} (±${Math.round(opts.here.accuracy ?? 0)} m)${opts.place ? `, en ${opts.place}` : ""}. "Acá" o "donde estoy" es ese punto.` : null,
    opts.attachedCaptureId ? `Mandó ${opts.images?.length === 1 ? "una foto" : "fotos"} que ya quedaron guardadas con su ubicación [[capture:${opts.attachedCaptureId}]]: miralas y respondé; no las vuelvas a registrar.` : null,
    opts.scope && scopeLabel[scopeType]
      ? `El usuario está mirando ${scopeLabel[scopeType]} [[${opts.scope}]]: si la pregunta se refiere a "esto", "acá" o no nombra otra cosa, es sobre eso (consultalo primero con ${scopeTool[scopeType] ?? "get_record"}). Podés consultar el resto de la memoria cuando haga falta.`
      : "Alcance: todo el workspace.",
  ].filter(Boolean).join(" ");

  const draftIds: string[] = [];
  let homeChanged = false;
  const captureIds: string[] = [];
  let navigate: string | null = null;
  // Lo que se captura o se aprende queda en la misión de trabajo (o en el proyecto que se está mirando).
  let missionChanged: string | null = null;
  const campaignId = mission;
  const started = Date.now();
  const result = await runAgent({
    client: opts.client ?? new Anthropic(),
    history,
    userText: opts.text,
    context,
    images: opts.images,
    tools: {
      db,
      slug: opts.slug,
      seenRefs,
      navigate: (href) => { navigate = href; },
      here: opts.here ?? null,
      place: opts.place ?? null,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      settings: opts.settings,
      campaignId,
      missionId: mission,
      userName: firstName,
      onMissionChange: (id) => { missionChanged = id; },
      onFocusChange: () => { homeChanged = true; },
      onCapture: (id) => captureIds.push(id),
      saveApplied: async ({ action, payload, summary, after }) => {
        // Las acciones aplicadas solas quedan auditadas como borrador ejecutado (deshacible).
        const { data, error } = await db
          .from("ai_action_drafts")
          .insert({ workspace_id: opts.workspaceId, conversation_id: convId!, action, payload: payload as never, rationale: summary, evidence_refs: [], preview: { summary, changes: [], why: summary, evidence_refs: [], duplicate_risk: [], expected: summary, applied: true } as never })
          .select("id")
          .single();
        if (error) throw error;
        await db.from("ai_action_drafts").update({ status: "ejecutada", decided_by: opts.userId, decided_at: new Date().toISOString(), after_state: after as never }).eq("id", data.id);
        draftIds.push(data.id);
        return data.id;
      },
      saveDraft: async (input) => {
        const { action, rationale, evidence_refs, ...payload } = input;
        const preview = await previewDraft(db, input);
        const { data, error } = await db
          .from("ai_action_drafts")
          .insert({ workspace_id: opts.workspaceId, conversation_id: convId!, action, payload, rationale, evidence_refs, preview: preview as never })
          .select("id")
          .single();
        if (error) throw error;
        // Lo que la web dice y sirve como evidencia se guarda solo (interno y reversible): la persona no administra
        // la inteligencia. Queda auditado como ejecutado.
        if (action === "record_web_evidence") {
          const exec = await executeDraft(db, { workspaceId: opts.workspaceId, userId: opts.userId, campaignId }, data.id, input);
          await db.from("ai_action_drafts").update({ status: exec.error ? "error" : "ejecutada", decided_by: opts.userId, decided_at: new Date().toISOString(), result_ref: exec.resultRef, error: exec.error, after_state: (exec.after ?? null) as never }).eq("id", data.id);
          return data.id;
        }
        draftIds.push(data.id);
        return data.id;
      },
    },
  });

  const { data: run } = await db
    .from("ai_runs")
    .insert({
      workspace_id: opts.workspaceId, user_id: opts.userId, conversation_id: convId, model: AI_MODEL, prompt_version: PROMPT_VERSION, status: result.status,
      input_tokens: result.usage.input, output_tokens: result.usage.output, cache_read_tokens: result.usage.cacheRead, cache_write_tokens: result.usage.cacheWrite,
      tool_calls: result.usage.toolCalls, cost_usd: Number(result.usage.costUsd.toFixed(5)), error: result.error ?? null, duration_ms: Date.now() - started,
    })
    .select("id")
    .single();

  // En el historial queda la referencia a la foto, no la imagen.
  const userParam: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: context }, { type: "text", text: opts.attachedCaptureId ? `${opts.text}\n[foto: capture:${opts.attachedCaptureId}]` : opts.text }] };
  await db.from("ai_messages").insert({ workspace_id: opts.workspaceId, conversation_id: convId, role: "user", text: opts.text, api_content: [userParam] as never });
  if (result.status !== "error") {
    const { data: msg } = await db
      .from("ai_messages")
      .insert({ workspace_id: opts.workspaceId, conversation_id: convId, role: "assistant", text: result.text, api_content: result.transcript as never, citations: result.citations, run_id: run?.id ?? null })
      .select("id")
      .single();
    if (msg && draftIds.length) await db.from("ai_action_drafts").update({ message_id: msg.id }).in("id", draftIds);
  }
  await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  // Re-síntesis profunda de la misión en background tras una acción relevante (como mucho una por hora).
  if (draftIds.length && mission && result.status !== "error") {
    const { data: applied } = await db.from("ai_action_drafts").select("id").in("id", draftIds).eq("status", "ejecutada").limit(1);
    const { data: c } = await db.from("campaigns").select("synthesized_at").eq("id", mission).maybeSingle();
    if (applied?.length && (!c?.synthesized_at || Date.now() - new Date(c.synthesized_at).getTime() > 3_600_000)) {
      const resynth = () => synthesizeMission(db, { workspaceId: opts.workspaceId, campaignId: mission, userId: opts.userId });
      try {
        after(async () => { await resynth(); });
      } catch {
        await resynth(); // fuera de un request (scripts): en línea
      }
    }
  }
  // Cambió lo que se ve en el home: lo nuevo que aparece llega con su Avanzar preparado.
  if (draftIds.length) {
    const { data: applied } = await db.from("ai_action_drafts").select("id").in("id", draftIds).eq("action", "contact_event").eq("status", "ejecutada").limit(1);
    if (applied?.length) homeChanged = true;
  }
  if (homeChanged && mission) laterPrepare(db, { workspaceId: opts.workspaceId, campaignId: mission, slug: opts.slug, settings: opts.settings, userId: opts.userId });
  if (result.status === "error") return { ok: false, conversationId: convId, message: result.error ?? "No se pudo completar la consulta." };
  return { ok: true, conversationId: convId!, text: result.text, citations: result.citations, draftIds, navigate, captureIds, webSources: result.webSources, homeChanged, missionChanged };
}

/** Prepara en background el Avanzar de lo que quedó visible (dentro de un request: after; en scripts: no). */
export function laterPrepare(db: Db, opts: Parameters<typeof prepareMoves>[1]) {
  try {
    after(async () => { await prepareMoves(db, opts).catch(() => null); });
  } catch {
    /* fuera de un request (scripts): se prepara en el próximo cron */
  }
}
