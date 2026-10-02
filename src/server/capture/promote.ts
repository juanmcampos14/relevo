import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { freshnessFor, revalidateAfter } from "@/domain/evidence";
import type { evidenceType } from "@/domain/catalogs";
import { approvalOrder, captureExceptions, clearMatch, type ReviewProposal } from "@/domain/capture-review";
import { mainQuantity } from "@/domain/quantities";

type Db = SupabaseClient<Database>;
type EvidenceType = (typeof evidenceType.values)[number];

type Proposal = {
  id: string;
  kind: "company" | "asset" | "person" | "evidence" | "finding" | "next_action";
  status: string;
  payload: Record<string, unknown>;
  quote: string | null;
  result_id: string | null;
  result_type?: string | null;
};

export type Decision = { action: "aceptar" | "rechazar"; edits?: Record<string, unknown> };
/** affectedFindings: findings cuya evidencia cambió (su estado se vuelve a evaluar). */
export type PromoteResult = { ok: true; message: string; resultId?: string; affectedFindings?: string[] } | { ok: false; message: string };

const decided = (p?: Proposal) => !!p && (p.status === "aceptada" || p.status === "editada");
/** Quedó como entidad sin identificar (no como empresa o persona del CRM). */
const unresolved = (p?: Proposal) => decided(p) && p!.result_type === "unresolved";

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
    db.from("captures").select("id, captured_at, captured_by, campaign_id, body, source_id, latitude, longitude, location_accuracy_m").eq("id", captureId).single(),
    db.from("proposals").select("id, kind, status, payload, quote, result_id, result_type").eq("capture_id", captureId),
  ]);
  if (!capture) return { ok: false, message: "Captura no encontrada." };
  const all = (siblings ?? []) as unknown as Proposal[];
  const edits = opts.decision.edits ?? {};
  const edited = Object.keys(edits).length > 0;
  const p = { ...(prop.payload as Record<string, unknown>), ...edits };
  const ws = opts.workspaceId;

  const company = all.find((x) => x.kind === "company");
  const asset = all.find((x) => x.kind === "asset");
  // Sujeto de un dato (propuestas anteriores usaban about_company).
  const aboutOf = (x: Record<string, unknown>) => (x.about as string | undefined) ?? (x.about_company ? "company" : "none");
  const personByKey = (key: unknown) => all.find((x) => x.kind === "person" && x.payload.key === key);
  const evidenceByKey = (key: unknown) => all.find((x) => x.kind === "evidence" && x.payload.key === key);
  const need = (dep: Proposal | undefined, what: string): string | null =>
    dep && dep.status === "propuesta" ? `Primero decidí ${what} (más arriba).` : null;

  let resultType: "company" | "asset" | "contact" | "evidence" | "finding" | "task" | "unresolved";
  let resultId: string = prop.id;
  let message: string;
  let affectedFindings: string[] = [];

  try {
    switch (prop.kind) {
      case "company": {
        resultType = "company";
        if (p.identified === false && !(typeof p.link_to === "string" && p.link_to)) {
          // Sabemos que existe una organización, no cuál: se guarda y se relaciona, sin ensuciar Empresas.
          resultType = "unresolved";
          const { error } = await db.from("unresolved_entities").upsert(
            { id: prop.id, workspace_id: ws, kind: "organization", label: String(p.name ?? "Organización sin identificar").trim(), description: (p.activity as string | null) ?? null, capture_id: capture.id },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) throw error;
          message = "Guardada como organización sin identificar: cuando se sepa cuál es, se resuelve y conserva su historia.";
          break;
        }
        if (typeof p.link_to === "string" && p.link_to) {
          resultId = p.link_to;
          message = "Vinculada con la empresa existente: no se creó otra.";
        } else {
          const { error } = await db.from("companies").upsert(
            { id: prop.id, workspace_id: ws, origin_campaign_id: capture.campaign_id, trade_name: String(p.name ?? "").trim() || "Empresa sin nombre", locality: (p.locality as string | null) ?? null, activity: (p.activity as string | null) ?? null, notes: `Creada desde una captura de campo (${capture.captured_at.slice(0, 10)}).` },
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
        if (typeof p.resolves === "string" && p.resolves) {
          affectedFindings = (await resolveEntity(db, { workspaceId: ws, userId: opts.userId, entityId: p.resolves, companyId: resultId })).affectedFindings;
          message += " Era la organización sin identificar de antes: su evidencia pasó a esta empresa.";
        }
        break;
      }
      case "asset": {
        resultType = "asset";
        if (typeof p.link_to === "string" && p.link_to) {
          resultId = p.link_to;
          message = "Vinculado con el activo existente: no se creó otro.";
        } else {
          const address = typeof p.address_text === "string" && p.address_text.trim() ? p.address_text.trim() : null;
          const hasGps = capture.latitude != null && capture.longitude != null;
          const surface = Number(p.surface_m2);
          const { error } = await db.from("assets").upsert(
            {
              id: prop.id,
              workspace_id: ws,
              origin_campaign_id: capture.campaign_id,
              title: String(p.title ?? "Activo").trim() || "Activo",
              kind: String(p.kind || "otro"),
              operation: String(p.operation || "desconocida"),
              address_text: address,
              address_status: address ? "no_verificada" : "sin_direccion",
              locality: (p.locality as string | null) ?? null,
              // La superficie es lo que DICE la fuente; queda como dato del activo y como evidencia declarada.
              surface_m2: Number.isFinite(surface) && surface > 0 ? surface : null,
              // La ubicación de quien captura es la del activo solo si está parado ahí (no si lo menciona de lejos).
              ...(hasGps && p.here === true ? { latitude: capture.latitude, longitude: capture.longitude, location_status: "gps_captured", location_accuracy_m: capture.location_accuracy_m, location_source: "gps" } : {}),
              notes: `Creado desde una captura de campo (${capture.captured_at.slice(0, 10)}).`,
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) throw error;
          message = hasGps ? "Activo creado con la ubicación GPS de la captura (sin verificar)." : "Activo creado.";
        }
        if (capture.campaign_id) {
          const { data: existing } = await db.from("campaign_targets").select("id").eq("campaign_id", capture.campaign_id).eq("asset_id", resultId).maybeSingle();
          if (!existing) {
            const { error } = await db.from("campaign_targets").insert({ workspace_id: ws, campaign_id: capture.campaign_id, asset_id: resultId, status: "investigacion", owner_id: opts.userId });
            if (error) throw error;
          }
        }
        break;
      }
      case "person": {
        resultType = "contact";
        const blocked = need(company, "la empresa");
        if (blocked) return { ok: false, message: blocked };
        const companyId = decided(company) && !unresolved(company) ? company!.result_id : null;
        const linked = typeof p.link_to === "string" && p.link_to ? p.link_to : null;
        // Sin nombre y sin una empresa conocida ("un chofer de una petrolera", "el encargado de esa contratista"):
        // actor sin identificar. Un área de una empresa conocida ("Compras") sigue siendo canal institucional.
        if (!linked && !p.name && (!p.institutional || !companyId)) {
          resultType = "unresolved";
          const { error } = await db.from("unresolved_entities").upsert(
            {
              id: prop.id,
              workspace_id: ws,
              kind: "actor",
              label: String(p.role || "Persona sin identificar").trim(),
              parent_id: unresolved(company) ? company!.result_id : null,
              capture_id: capture.id,
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) throw error;
          message = "Guardada como persona sin identificar: lo que dijo queda como evidencia y se puede resolver después.";
          break;
        }
        if (linked) {
          resultId = linked;
          message = "Vinculada con la persona existente: no se creó otra.";
        } else {
          const institutional = p.institutional === true || !p.name;
          const { error } = await db.from("contacts").upsert(
            {
              id: prop.id,
              workspace_id: ws,
              origin_campaign_id: capture.campaign_id,
              full_name: String(p.name || p.role || "Contacto sin nombre").trim(),
              contact_kind: institutional ? "canal_institucional" : "persona",
              profile_url: typeof p.url === "string" && /^https?:\/\//.test(p.url) ? p.url : null,
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
        // "Es dueño de esas tierras": queda la relación estructurada persona → activo (propietario, sin verificar).
        if (p.owns_asset === true && decided(asset) && asset!.result_id && resultId) {
          const { error } = await db.from("asset_parties").upsert(
            { workspace_id: ws, asset_id: asset!.result_id, contact_id: resultId, role: "propietario", notes: `Según una captura de campo (${capture.captured_at.slice(0, 10)}).` },
            { onConflict: "asset_id,company_id,contact_id,role", ignoreDuplicates: true },
          );
          if (error) throw error;
        }
        if (typeof p.resolves === "string" && p.resolves) {
          affectedFindings = (await resolveEntity(db, { workspaceId: ws, userId: opts.userId, entityId: p.resolves, contactId: resultId })).affectedFindings;
          message += " Era la persona sin identificar de antes: lo que dijo pasó a esta persona.";
        }
        break;
      }
      case "evidence": {
        resultType = "evidence";
        const speaker = personByKey(p.stated_by);
        const about = aboutOf(p);
        const blocked = (about === "company" ? need(company, "la empresa") : about === "asset" ? need(asset, "el activo") : null) ?? need(speaker, "quién lo dijo");
        if (blocked) return { ok: false, message: blocked };
        // Observé algo ≠ una fuente afirma algo ≠ verifiqué el dato.
        const origin = p.origin === "observacion_directa" ? "observado" : p.origin === "declaracion" ? "declarado_por_persona" : String(p.origin);
        const direct = origin === "observado";
        const type = (String(p.evidence_type) || "dato") as EvidenceType;
        // La cifra principal con su unidad (para calcular sin IA: USD/m², variación contra referencias).
        const q = mainQuantity(String(p.statement)) ?? (prop.quote ? mainQuantity(prop.quote) : null);
        const { error } = await db.from("evidence").upsert(
          {
            id: prop.id,
            workspace_id: ws,
            statement: String(p.statement),
            quote: prop.quote,
            evidence_type: type,
            origin_kind: origin === "declarado_por_persona" ? "conversation" : "field",
            // Solo lo observado en persona queda verificado en campo; lo que afirma una persona o un cartel, no.
            verification_status: (p.verification_status as string | undefined) ?? (direct ? "field_verified" : "unverified"),
            declared_by: origin === "declarado_por_documento" ? String(p.declared_by || "documento o cartel") : null,
            observed_at: capture.captured_at,
            revalidate_after: revalidateAfter(capture.captured_at, type, freshnessFor(opts.settings)),
            capture_id: capture.id,
            // Si salió de un audio: el archivo y el momento exacto (para escucharlo).
            capture_media_id: (p.audio as { capture_media_id?: string } | undefined)?.capture_media_id ?? null,
            media_start_ms: (p.audio as { start_ms?: number } | undefined)?.start_ms ?? null,
            media_end_ms: (p.audio as { end_ms?: number } | undefined)?.end_ms ?? null,
            campaign_id: capture.campaign_id,
            company_id: about === "company" && decided(company) && !unresolved(company) ? company!.result_id : null,
            about_unresolved_id: about === "company" && unresolved(company) ? company!.result_id : null,
            asset_id: about === "asset" && decided(asset) ? asset!.result_id : null,
            stated_by_contact_id: decided(speaker) && !unresolved(speaker) ? speaker!.result_id : null,
            stated_by_unresolved_id: unresolved(speaker) ? speaker!.result_id : null,
            value_number: q?.value ?? null,
            value_unit: q?.unit ?? null,
            value_currency: q?.currency ?? null,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) throw error;
        // Un precio aprobado sobre un activo sin precio completa el dato del activo (la historia queda en la evidencia).
        if (about === "asset" && decided(asset) && q?.unit === "moneda" && (type === "precio" || /precio|piden|pide|vale|cuesta|alquiler/i.test(String(p.statement)))) {
          const priceSource = await captureSource(db, ws, capture);
          await db.from("assets").update({ price_amount: q.value, price_currency: q.currency ?? "ARS", price_observed_on: capture.captured_at.slice(0, 10), price_source_id: priceSource }).eq("id", asset!.result_id!).is("price_amount", null);
        }
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
        const link = (keys: unknown, stance: "supports" | "contradicts", findingId: string) =>
          ((keys as string[] | undefined) ?? []).map(evidenceByKey).filter(decided).map((e) => ({ workspace_id: ws, finding_id: findingId, evidence_id: e!.result_id!, stance }));
        if (typeof p.link_to === "string" && p.link_to) {
          // Misma hipótesis que un finding existente: se suma la evidencia ahí, sin duplicar.
          const links = [...link(p.supports, "supports", p.link_to), ...link(p.contradicts, "contradicts", p.link_to)];
          if (links.length) {
            const { error: e2 } = await db.from("finding_evidence").upsert(links, { onConflict: "finding_id,evidence_id", ignoreDuplicates: true });
            if (e2) throw e2;
          }
          resultId = p.link_to;
          affectedFindings = [p.link_to];
          message = `Se sumaron ${links.length} evidencia${links.length === 1 ? "" : "s"} a la hipótesis existente (no se creó otra).`;
          // Acota, amplía o segmenta: la hipótesis se reformula y el cambio queda registrado.
          const refined = typeof p.refined_statement === "string" ? p.refined_statement.trim() : "";
          if (refined && ["acota", "amplia", "segmenta"].includes(String(p.relation))) {
            const { data: current } = await db.from("findings").select("statement").eq("id", p.link_to).single();
            if (current && current.statement !== refined) {
              const { error: e3 } = await db.rpc("refine_finding", {
                p_finding_id: p.link_to, p_statement: refined, p_relation: String(p.relation), p_reason: (p.rationale as string | null) ?? "", p_capture_id: capture.id, p_proposal_id: prop.id,
              });
              if (e3) throw e3;
              message += ` La hipótesis se reformuló (${p.relation === "amplia" ? "amplía" : p.relation}).`;
            }
          }
          break;
        }
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
            company_id: p.about_company && decided(company) && !unresolved(company) ? company!.result_id : null,
            // Aceptar una hipótesis exploratoria no la vuelve un finding consolidado: eso es otra promoción humana.
            maturity: p.is_idea ? "idea" : "hipotesis",
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
        const links = [...link(p.supports, "supports", prop.id), ...link(p.contradicts, "contradicts", prop.id)];
        if (links.length) {
          const { error: e2 } = await db.from("finding_evidence").upsert(links, { onConflict: "finding_id,evidence_id", ignoreDuplicates: true });
          if (e2) throw e2;
        }
        affectedFindings = [prop.id];
        message = `${p.is_idea ? "Idea" : "Hipótesis"} guardada con ${links.length} evidencia${links.length === 1 ? "" : "s"} vinculada${links.length === 1 ? "" : "s"}.`;
        break;
      }
      case "next_action": {
        resultType = "task";
        const who = personByKey(p.contact);
        const blocked = (p.about_company ? need(company, "la empresa") : null) ?? need(who, "la persona");
        if (blocked) return { ok: false, message: blocked };
        let targetId: string | null = null;
        if (decided(company) && !unresolved(company) && capture.campaign_id) {
          const { data } = await db.from("campaign_targets").select("id").eq("campaign_id", capture.campaign_id).eq("company_id", company!.result_id!).maybeSingle();
          targetId = data?.id ?? null;
        }
        const { error } = await db.from("tasks").upsert(
          {
            id: prop.id,
            workspace_id: ws,
            title: String(p.title),
            description: [p.why, unresolved(who) ? `Con: ${String(who!.payload.role ?? "persona")} (sin identificar)` : null, "Surgió de una captura de campo."].filter(Boolean).join("\n"),
            due_on: (p.due as string | null) || null,
            assignee_id: opts.userId,
            target_id: targetId,
            campaign_id: capture.campaign_id,
            contact_id: decided(who) && !unresolved(who) ? who!.result_id : null,
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
      campaign_id: finding?.campaign_id ?? null,
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

/**
 * "Aceptar todo" de un grupo: el sujeto (empresa o activo), las personas que declararon esos datos
 * y los datos pendientes sobre ese sujeto. Lo ya decidido (aceptado, editado o rechazado) no se toca.
 */
export async function acceptGroup(
  db: Db,
  opts: { workspaceId: string; settings: unknown; userId: string; captureId: string; subject: "company" | "asset"; subjectEdits?: Record<string, unknown> },
): Promise<{ accepted: number; skipped: string[]; affectedFindings: string[] }> {
  const { data } = await db.from("proposals").select("id, kind, status, payload").eq("capture_id", opts.captureId).order("position");
  const all = (data ?? []) as { id: string; kind: string; status: string; payload: Record<string, unknown> }[];
  const about = (p: Record<string, unknown>) => (p.about as string | undefined) ?? (p.about_company ? "company" : "none");
  const facts = all.filter((x) => x.kind === "evidence" && x.status === "propuesta" && about(x.payload) === opts.subject);
  const speakers = new Set(facts.map((f) => f.payload.stated_by).filter(Boolean));
  const order = [
    ...all.filter((x) => x.kind === opts.subject && x.status === "propuesta"),
    ...all.filter((x) => x.kind === "person" && x.status === "propuesta" && speakers.has(x.payload.key)),
    ...facts,
  ];
  const out = { accepted: 0, skipped: [] as string[], affectedFindings: [] as string[] };
  for (const x of order) {
    const res = await decideProposal(db, { ...opts, proposalId: x.id, decision: { action: "aceptar", edits: x.kind === opts.subject ? opts.subjectEdits : undefined } });
    if (res.ok) {
      out.accepted++;
      out.affectedFindings.push(...(res.affectedFindings ?? []));
    } else out.skipped.push(res.message);
  }
  return out;
}

/**
 * Resolver una entidad sin identificar contra la empresa o persona real: su evidencia pasa a esa
 * entidad (conservando a quién apuntaba antes) y se crean las relaciones que ahora se conocen.
 */
export async function resolveEntity(
  db: Db,
  opts: { workspaceId: string; userId: string; entityId: string; companyId?: string; contactId?: string },
): Promise<{ ok: boolean; message: string; affectedFindings: string[] }> {
  const { data: u } = await db.from("unresolved_entities").select("id, kind, parent_id, resolved_company_id, resolved_contact_id").eq("id", opts.entityId).maybeSingle();
  if (!u) return { ok: false, message: "No se encontró esa entidad sin identificar.", affectedFindings: [] };
  const ws = opts.workspaceId;
  if (u.kind === "organization") {
    if (!opts.companyId) return { ok: false, message: "Elegí la empresa.", affectedFindings: [] };
    await db.from("unresolved_entities").update({ resolved_company_id: opts.companyId, resolved_at: new Date().toISOString(), resolved_by: opts.userId }).eq("id", u.id);
    await db.from("evidence").update({ company_id: opts.companyId }).eq("about_unresolved_id", u.id).is("company_id", null);
    // Quienes hablaron de ella quedan vinculados a la empresa (personas ya identificadas o que se identifiquen después).
    const [{ data: speakers }, { data: actors }] = await Promise.all([
      db.from("evidence").select("stated_by_contact_id").eq("about_unresolved_id", u.id).not("stated_by_contact_id", "is", null),
      db.from("unresolved_entities").select("resolved_contact_id").eq("parent_id", u.id).not("resolved_contact_id", "is", null),
    ]);
    const contacts = [...new Set([...(speakers ?? []).map((x) => x.stated_by_contact_id!), ...(actors ?? []).map((x) => x.resolved_contact_id!)])];
    if (contacts.length) {
      await db.from("contact_links").upsert(
        contacts.map((c) => ({ workspace_id: ws, contact_id: c, company_id: opts.companyId!, relation: "otro" })),
        { onConflict: "contact_id,company_id,establishment_id,asset_id", ignoreDuplicates: true },
      );
    }
  } else {
    if (!opts.contactId) return { ok: false, message: "Elegí la persona.", affectedFindings: [] };
    await db.from("unresolved_entities").update({ resolved_contact_id: opts.contactId, resolved_at: new Date().toISOString(), resolved_by: opts.userId }).eq("id", u.id);
    await db.from("evidence").update({ stated_by_contact_id: opts.contactId }).eq("stated_by_unresolved_id", u.id).is("stated_by_contact_id", null);
    if (u.parent_id) {
      const { data: parent } = await db.from("unresolved_entities").select("resolved_company_id").eq("id", u.parent_id).maybeSingle();
      if (parent?.resolved_company_id) {
        await db.from("contact_links").upsert(
          { workspace_id: ws, contact_id: opts.contactId, company_id: parent.resolved_company_id, relation: "otro" },
          { onConflict: "contact_id,company_id,establishment_id,asset_id", ignoreDuplicates: true },
        );
      }
    }
  }
  const { data: ev } = await db.from("evidence").select("id").or(`about_unresolved_id.eq.${u.id},stated_by_unresolved_id.eq.${u.id}`);
  const ids = (ev ?? []).map((e) => e.id);
  const { data: links } = ids.length ? await db.from("finding_evidence").select("finding_id").in("evidence_id", ids) : { data: [] };
  return { ok: true, message: "Resuelta: su evidencia e historia quedaron en la entidad real.", affectedFindings: [...new Set((links ?? []).map((l) => l.finding_id))] };
}

/**
 * "Aprobar propuesta": acepta lo normal de la captura en orden de dependencias y deja pendiente lo que
 * requiere una decisión (posible duplicado, reformular una hipótesis, identificar a alguien) y lo que
 * depende de eso. Cada aceptación es la misma que una por una: mismas escrituras, misma trazabilidad.
 */
export async function approveCapture(
  db: Db,
  opts: { workspaceId: string; settings: unknown; userId: string; captureId: string },
): Promise<{ accepted: number; pending: string[]; failed: string[]; affectedFindings: string[] }> {
  const { data } = await db.from("proposals").select("id, kind, status, payload, matches").eq("capture_id", opts.captureId).order("position");
  const all = (data ?? []) as unknown as ReviewProposal[];
  // Lo que claramente ya está en RELEVO se vincula solo (no se duplica ni se deja esperando).
  const links = new Map<string, string>();
  for (const p of all) {
    const id = clearMatch(p);
    if (id) { links.set(p.id, id); p.payload = { ...p.payload, link_to: id }; }
  }
  const exceptions = captureExceptions(all);
  const out = { accepted: 0, pending: [...exceptions.values()], failed: [] as string[], affectedFindings: [] as string[] };
  for (const p of approvalOrder(all)) {
    if (p.status !== "propuesta" || exceptions.has(p.id)) continue;
    const res = await decideProposal(db, { ...opts, proposalId: p.id, decision: { action: "aceptar", ...(links.has(p.id) ? { edits: { link_to: links.get(p.id) } } : {}) } });
    if (res.ok) {
      out.accepted++;
      out.affectedFindings.push(...(res.affectedFindings ?? []));
    } else if (res.message.startsWith("Primero decidí")) out.pending.push(res.message);
    else out.failed.push(res.message);
  }
  out.affectedFindings = [...new Set(out.affectedFindings)];
  return out;
}
