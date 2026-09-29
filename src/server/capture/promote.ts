import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { freshnessFor, revalidateAfter } from "@/domain/evidence";
import type { evidenceType } from "@/domain/catalogs";

type Db = SupabaseClient<Database>;
type EvidenceType = (typeof evidenceType.values)[number];

type Proposal = {
  id: string;
  kind: "company" | "person" | "evidence" | "finding" | "next_action";
  status: string;
  payload: Record<string, unknown>;
  quote: string | null;
  result_id: string | null;
};

export type Decision = { action: "aceptar" | "rechazar"; edits?: Record<string, unknown> };
/** affectedFindings: findings cuya evidencia cambió (su estado se vuelve a evaluar). */
export type PromoteResult = { ok: true; message: string; resultId?: string; affectedFindings?: string[] } | { ok: false; message: string };

const decided = (p?: Proposal) => !!p && (p.status === "aceptada" || p.status === "editada");

/**
 * Aceptar, editar o rechazar una propuesta. Aceptar crea el objeto RELEVO con el MISMO id de la
 * propuesta: reintentar nunca duplica. Lo que depende de otra propuesta (la persona de una empresa,
 * la evidencia de lo que dijo alguien) exige que esa otra ya esté decidida.
 */
export async function decideProposal(db: Db, opts: { workspaceId: string; settings: unknown; userId: string; proposalId: string; decision: Decision }): Promise<PromoteResult> {
  // (captura) o (finding): las de captura crean objetos; las de finding, validaciones.
  const { data: prop } = await db.from("proposals").select("id, capture_id, finding_id, kind, status, payload, quote, result_id").eq("id", opts.proposalId).maybeSingle();
  if (!prop) return { ok: false, message: "Propuesta no encontrada." };
  if (prop.status !== "propuesta") return { ok: false, message: "Esa propuesta ya se decidió." };
  const now = new Date().toISOString();

  if (opts.decision.action === "rechazar") {
    const { error } = await db.from("proposals").update({ status: "rechazada", decided_by: opts.userId, decided_at: now }).eq("id", prop.id).eq("status", "propuesta");
    if (error) return { ok: false, message: error.message };
    if (prop.capture_id) await closeIfDone(db, prop.capture_id);
    return { ok: true, message: "Propuesta rechazada: no se guardó nada." };
  }
  if (!prop.capture_id) return acceptValidation(db, opts, prop as { id: string; finding_id: string; kind: string; payload: Record<string, unknown> }, now);
  const captureId = prop.capture_id;

  const [{ data: capture }, { data: siblings }] = await Promise.all([
    db.from("captures").select("id, captured_at, captured_by, campaign_id, body, source_id").eq("id", captureId).single(),
    db.from("proposals").select("id, kind, status, payload, quote, result_id").eq("capture_id", captureId),
  ]);
  if (!capture) return { ok: false, message: "Captura no encontrada." };
  const all = (siblings ?? []) as unknown as Proposal[];
  const edits = opts.decision.edits ?? {};
  const edited = Object.keys(edits).length > 0;
  const p = { ...(prop.payload as Record<string, unknown>), ...edits };
  const ws = opts.workspaceId;

  const company = all.find((x) => x.kind === "company");
  const personByKey = (key: unknown) => all.find((x) => x.kind === "person" && x.payload.key === key);
  const evidenceByKey = (key: unknown) => all.find((x) => x.kind === "evidence" && x.payload.key === key);
  const need = (dep: Proposal | undefined, what: string): string | null =>
    dep && dep.status === "propuesta" ? `Primero decidí ${what} (más arriba).` : null;

  let resultType: "company" | "contact" | "evidence" | "finding" | "task";
  let resultId: string = prop.id;
  let message: string;
  let affectedFindings: string[] = [];

  try {
    switch (prop.kind) {
      case "company": {
        resultType = "company";
        if (typeof p.link_to === "string" && p.link_to) {
          resultId = p.link_to;
          message = "Vinculada con la empresa existente: no se creó otra.";
        } else {
          const { error } = await db.from("companies").upsert(
            { id: prop.id, workspace_id: ws, trade_name: String(p.name ?? "").trim() || "Empresa sin nombre", locality: (p.locality as string | null) ?? null, activity: (p.activity as string | null) ?? null, notes: `Creada desde una captura de campo (${capture.captured_at.slice(0, 10)}).` },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) throw error;
          message = "Empresa creada.";
        }
        // Queda en la misión como objetivo en Investigación (si no estaba).
        if (capture.campaign_id) {
          const { data: existing } = await db.from("campaign_targets").select("id").eq("campaign_id", capture.campaign_id).eq("company_id", resultId).maybeSingle();
          if (!existing) {
            const { error } = await db.from("campaign_targets").insert({ workspace_id: ws, campaign_id: capture.campaign_id, company_id: resultId, status: "investigacion", owner_id: opts.userId });
            if (error) throw error;
          }
        }
        break;
      }
      case "person": {
        resultType = "contact";
        const blocked = need(company, "la empresa");
        if (blocked) return { ok: false, message: blocked };
        const companyId = decided(company) ? company!.result_id : null;
        if (typeof p.link_to === "string" && p.link_to) {
          resultId = p.link_to;
          message = "Vinculada con la persona existente: no se creó otra.";
        } else {
          const institutional = p.institutional === true || !p.name;
          const { error } = await db.from("contacts").upsert(
            {
              id: prop.id,
              workspace_id: ws,
              full_name: String(p.name || p.role || "Contacto sin nombre").trim(),
              contact_kind: institutional ? "canal_institucional" : "persona",
              role_title: (p.role as string | null) ?? null,
              notes: `De una captura de campo (${capture.captured_at.slice(0, 10)}).`,
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) throw error;
          message = institutional ? "Canal institucional creado." : "Persona creada.";
        }
        if (companyId) {
          const { error } = await db.from("contact_links").upsert(
            { workspace_id: ws, contact_id: resultId, company_id: companyId, relation: "otro" },
            { onConflict: "contact_id,company_id,establishment_id,asset_id", ignoreDuplicates: true },
          );
          if (error) throw error;
        }
        break;
      }
      case "evidence": {
        resultType = "evidence";
        const speaker = personByKey(p.stated_by);
        const blocked = (p.about_company ? need(company, "la empresa") : null) ?? need(speaker, "quién lo dijo");
        if (blocked) return { ok: false, message: blocked };
        const direct = p.origin === "observacion_directa";
        const type = (String(p.evidence_type) || "dato") as EvidenceType;
        const { error } = await db.from("evidence").upsert(
          {
            id: prop.id,
            workspace_id: ws,
            statement: String(p.statement),
            quote: prop.quote,
            evidence_type: type,
            origin_kind: direct ? "field" : "conversation",
            // Lo visto en persona es verificación de campo; lo que alguien declaró queda sin verificar.
            verification_status: (p.verification_status as string | undefined) ?? (direct ? "field_verified" : "unverified"),
            observed_at: capture.captured_at,
            revalidate_after: revalidateAfter(capture.captured_at, type, freshnessFor(opts.settings)),
            capture_id: capture.id,
            // Si salió de un audio: el archivo y el momento exacto (para escucharlo).
            capture_media_id: (p.audio as { capture_media_id?: string } | undefined)?.capture_media_id ?? null,
            media_start_ms: (p.audio as { start_ms?: number } | undefined)?.start_ms ?? null,
            media_end_ms: (p.audio as { end_ms?: number } | undefined)?.end_ms ?? null,
            campaign_id: capture.campaign_id,
            company_id: p.about_company && decided(company) ? company!.result_id : null,
            stated_by_contact_id: decided(speaker) ? speaker!.result_id : null,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw error;
        const related = (p.related_findings as { finding_id: string; stance: "supports" | "contradicts" | "contextual" }[] | undefined) ?? [];
        if (related.length) {
          const { error: e2 } = await db.from("finding_evidence").upsert(
            related.map((r) => ({ workspace_id: ws, finding_id: r.finding_id, evidence_id: prop.id, stance: r.stance })),
            { onConflict: "finding_id,evidence_id", ignoreDuplicates: true },
          );
          if (e2) throw e2;
        }
        affectedFindings = related.map((r) => r.finding_id);
        message = related.some((r) => r.stance === "contradicts") ? "Evidencia guardada (contradice un finding existente)." : "Evidencia guardada.";
        break;
      }
      case "finding": {
        resultType = "finding";
        if (p.about_company) {
          const blocked = need(company, "la empresa");
          if (blocked) return { ok: false, message: blocked };
        }
        const sourceId = await captureSource(db, ws, capture);
        const { error } = await db.from("findings").upsert(
          {
            id: prop.id,
            workspace_id: ws,
            source_id: sourceId,
            campaign_id: capture.campaign_id,
            company_id: p.about_company && decided(company) ? company!.result_id : null,
            kind: String(p.kind || "observacion"),
            statement: String(p.statement),
            analysis: (p.rationale as string | null) ?? null,
            origin: "ia",
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw error;
        // Aceptarlo acá ES la promoción humana: queda aprobado por quien lo aceptó.
        await db.from("findings").update({ review_status: "aprobado", review_note: "Promovido desde una captura" }).eq("id", prop.id).eq("review_status", "pendiente_revision");
        const link = (keys: unknown, stance: "supports" | "contradicts") =>
          ((keys as string[] | undefined) ?? []).map(evidenceByKey).filter(decided).map((e) => ({ workspace_id: ws, finding_id: prop.id, evidence_id: e!.result_id!, stance }));
        const links = [...link(p.supports, "supports"), ...link(p.contradicts, "contradicts")];
        if (links.length) {
          const { error: e2 } = await db.from("finding_evidence").upsert(links, { onConflict: "finding_id,evidence_id", ignoreDuplicates: true });
          if (e2) throw e2;
        }
        affectedFindings = [prop.id];
        message = `Finding promovido con ${links.length} evidencia${links.length === 1 ? "" : "s"} vinculada${links.length === 1 ? "" : "s"}.`;
        break;
      }
      case "next_action": {
        resultType = "task";
        const who = personByKey(p.contact);
        const blocked = (p.about_company ? need(company, "la empresa") : null) ?? need(who, "la persona");
        if (blocked) return { ok: false, message: blocked };
        let targetId: string | null = null;
        if (decided(company) && capture.campaign_id) {
          const { data } = await db.from("campaign_targets").select("id").eq("campaign_id", capture.campaign_id).eq("company_id", company!.result_id!).maybeSingle();
          targetId = data?.id ?? null;
        }
        const { error } = await db.from("tasks").upsert(
          {
            id: prop.id,
            workspace_id: ws,
            title: String(p.title),
            description: [p.why, "Surgió de una captura de campo."].filter(Boolean).join("\n"),
            due_on: (p.due as string | null) || null,
            assignee_id: opts.userId,
            target_id: targetId,
            contact_id: decided(who) ? who!.result_id : null,
            kind: "Seguimiento",
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw error;
        message = "Próxima acción creada.";
        break;
      }
    }
  } catch (e) {
    return { ok: false, message: `No se pudo guardar: ${(e as { message?: string }).message ?? String(e)}` };
  }

  const { error } = await db
    .from("proposals")
    .update({
      status: edited ? "editada" : "aceptada",
      final_payload: edited ? (p as NonNullable<Json>) : null,
      result_type: resultType!,
      result_id: resultId,
      decided_by: opts.userId,
      decided_at: now,
    })
    .eq("id", prop.id)
    .eq("status", "propuesta");
  if (error) return { ok: false, message: error.message };
  await closeIfDone(db, captureId);
  return { ok: true, message: message!, resultId, affectedFindings };
}

/**
 * Validación propuesta a partir del estado de un finding: aceptarla crea una tarea vinculada al
 * finding (y a su empresa en la misión), con el mismo id de la propuesta.
 */
async function acceptValidation(
  db: Db,
  opts: { workspaceId: string; userId: string; decision: Decision },
  prop: { id: string; finding_id: string; kind: string; payload: Record<string, unknown> },
  now: string,
): Promise<PromoteResult> {
  if (prop.kind !== "next_action") return { ok: false, message: "Tipo de propuesta no soportado." };
  const p = { ...prop.payload, ...(opts.decision.edits ?? {}) };
  const edited = Object.keys(opts.decision.edits ?? {}).length > 0;
  const { data: finding } = await db.from("findings").select("statement, company_id, campaign_id").eq("id", prop.finding_id).single();
  let targetId: string | null = null;
  if (finding?.company_id && finding.campaign_id) {
    const { data } = await db.from("campaign_targets").select("id").eq("campaign_id", finding.campaign_id).eq("company_id", finding.company_id).maybeSingle();
    targetId = data?.id ?? null;
  }
  const { error } = await db.from("tasks").upsert(
    {
      id: prop.id,
      workspace_id: opts.workspaceId,
      title: String(p.title),
      description: [p.why, p.who ? `Con: ${p.who}` : null, finding ? `Valida: ${finding.statement}` : null].filter(Boolean).join("\n"),
      due_on: (p.due as string | null) || null,
      assignee_id: opts.userId,
      finding_id: prop.finding_id,
      target_id: targetId,
      kind: "Validación",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, message: `No se pudo guardar: ${error.message}` };
  const { error: e2 } = await db
    .from("proposals")
    .update({ status: edited ? "editada" : "aceptada", final_payload: edited ? (p as NonNullable<Json>) : null, result_type: "task", result_id: prop.id, decided_by: opts.userId, decided_at: now })
    .eq("id", prop.id)
    .eq("status", "propuesta");
  if (e2) return { ok: false, message: e2.message };
  return { ok: true, message: "Validación agendada como próxima acción.", resultId: prop.id };
}

/** Los findings exigen fuente: la captura se registra una vez como fuente "observación directa". */
async function captureSource(db: Db, ws: string, capture: { id: string; captured_at: string; body: string | null; source_id: string | null }): Promise<string> {
  if (capture.source_id) return capture.source_id;
  const { data, error } = await db
    .from("sources")
    .insert({
      workspace_id: ws,
      kind: "observacion",
      title: `Captura de campo · ${capture.captured_at.slice(0, 10)}`,
      reference: `captura:${capture.id}`,
      notes: capture.body?.slice(0, 500) ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("captures").update({ source_id: data.id }).eq("id", capture.id).is("source_id", null);
  return data.id;
}

async function closeIfDone(db: Db, captureId: string) {
  const { count } = await db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", captureId).eq("status", "propuesta");
  if (!count) await db.from("captures").update({ status: "revisado" }).eq("id", captureId).eq("status", "propuestas_listas");
}
