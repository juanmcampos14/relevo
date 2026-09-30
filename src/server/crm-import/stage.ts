import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type JsonObj = NonNullable<Json>;
import {
  SRC_ID,
  fold,
  mapCompany,
  mapContact,
  mapSource,
  mapTask,
  resolveOwners,
  type Issue,
  type Mapped,
  type Member,
} from "@/domain/crm-import/map";
import { threeWay, type DiffResult } from "@/domain/crm-import/diff";
import { CONTACT_REASON, findCandidates, findContactCandidates } from "@/domain/crm-import/dedupe";
import type { ParsedWorkbook } from "./parse";

type Db = SupabaseClient<Database>;
export type EntityType = "company" | "contact" | "task" | "source";

/** Campos que se comparan en cada reimportación (los demás son metadatos). */
export const COMPARED: Record<EntityType, readonly string[]> = {
  company: ["trade_name", "activity", "locality", "address_text", "public_phone", "website", "sector", "priority", "stage", "owner_name", "verification_status", "next_action", "next_action_due", "notes", "drive_folder_url"],
  contact: ["full_name", "contact_kind", "role_title", "email", "phone", "profile_url", "preferred_channel", "relationship_status", "contact_permission", "notes", "outreach_draft"],
  task: ["title", "kind", "channel", "due_on", "status", "owner_name", "result"],
  source: ["title", "url", "publisher", "published_on", "captured_on", "quality", "supports", "limitations"],
};

/** Ids de las entidades RELEVO que representan una fila del CRM (guardados en external_refs.last_values._ids). */
export type EntityIds = {
  company?: string;
  target?: string;
  establishment?: string;
  contact?: string;
  task?: string;
  source?: string;
  evidence?: string;
  /** Fuente citada en texto libre por el CRM ("AOG Patagonia 2026 / sitio oficial"). */
  cited_source?: string;
  /** Evidencia con el detalle del estado de verificación del CRM. */
  status_evidence?: string;
};

export type StagedPayload = { values: Record<string, unknown>; ids: EntityIds };

type Ref = { external_id: string; entity_type: string; entity_id: string; last_values: Record<string, unknown> };

export type StageContext = {
  members: Member[];
  missionId: string | null;
  refs: Map<string, Ref>;
};

const refKey = (type: string, ext: string) => `${type}:${ext.toUpperCase()}`;

export async function loadStageContext(db: Db, workspaceId: string): Promise<StageContext> {
  const [{ data: memberships }, { data: mission }, { data: refs }] = await Promise.all([
    db.from("memberships").select("user_id").eq("workspace_id", workspaceId).eq("status", "active"),
    db.from("campaigns").select("id").eq("kind", "mision").eq("status", "activa").order("created_at").limit(1).maybeSingle(),
    db.from("external_refs").select("external_id, entity_type, entity_id, last_values").eq("source_system", "google_sheets"),
  ]);
  const ids = (memberships ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await db.from("profiles").select("user_id, display_name, email").in("user_id", ids) : { data: [] };
  return {
    members: profiles ?? [],
    missionId: mission?.id ?? null,
    refs: new Map((refs ?? []).map((r) => [refKey(r.entity_type, r.external_id), { ...r, last_values: (r.last_values ?? {}) as Record<string, unknown> }])),
  };
}

// --- estado actual en RELEVO, con la misma forma que los valores del Sheet ------------

async function currentCompany(db: Db, ref: Ref, ctx: StageContext): Promise<Record<string, unknown> | null> {
  const ids = (ref.last_values._ids ?? {}) as EntityIds;
  const [{ data: c }, target, est] = await Promise.all([
    db.from("companies").select("trade_name, sector, activity, locality, public_phone, website, notes, drive_folder_url, verification_status").eq("id", ref.entity_id).maybeSingle(),
    ids.target ? db.from("campaign_targets").select("status, priority, next_action, next_action_due, owner_id, target_verticals(verticals(name))").eq("id", ids.target).maybeSingle() : Promise.resolve({ data: null }),
    ids.establishment ? db.from("establishments").select("address_text").eq("id", ids.establishment).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!c) return null;
  const t = target.data;
  const base = ref.last_values;
  const sectors = (t?.target_verticals ?? []).map((v) => v.verticals?.name).filter((n): n is string => !!n);
  const lastOwner = resolveOwners(base.owner_name as string | null, ctx.members).ids[0] ?? null;
  return {
    ...c,
    address_text: est.data?.address_text ?? null,
    // Sector declarado en la empresa; las importadas antes lo tenían solo como vertical.
    sector: c.sector ?? (sectors.some((s) => fold(s) === fold(String(base.sector ?? ""))) ? base.sector : sectors[0] ?? null),
    priority: t?.priority ?? null,
    stage: t?.status ?? null,
    next_action: t?.next_action ?? null,
    next_action_due: t?.next_action_due ?? null,
    // Mismo usuario que el último importado → mismo nombre del CRM; si cambió, el nombre del perfil.
    owner_name: t?.owner_id && t.owner_id === lastOwner ? base.owner_name : t?.owner_id ? ctx.members.find((m) => m.user_id === t.owner_id)?.display_name ?? t.owner_id : null,
  };
}

async function currentContact(db: Db, ref: Ref): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("contacts")
    .select("full_name, contact_kind, role_title, email, phone, profile_url, preferred_channel, relationship_status, contact_permission, notes, outreach_draft")
    .eq("id", ref.entity_id)
    .maybeSingle();
  return data;
}

async function currentTask(db: Db, ref: Ref, ctx: StageContext): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("tasks").select("title, kind, channel, due_on, status, assignee_id, description").eq("id", ref.entity_id).maybeSingle();
  if (!data) return null;
  const lastOwner = resolveOwners(ref.last_values.owner_name as string | null, ctx.members).ids[0] ?? null;
  return {
    title: data.title,
    kind: data.kind,
    channel: data.channel,
    due_on: data.due_on,
    status: data.status,
    owner_name: data.assignee_id && data.assignee_id === lastOwner ? ref.last_values.owner_name : data.assignee_id,
    // La nota de responsables compartidos la agrega el importador: no cuenta como edición en RELEVO.
    result: (data.description ?? "").split("\n").filter((l) => !l.startsWith("Responsables en el CRM: ")).join("\n") || null,
  };
}

async function currentSource(db: Db, ref: Ref): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("sources").select("title, url, reference, published_at, captured_at, quality, notes").eq("id", ref.entity_id).maybeSingle();
  if (!data) return null;
  const base = ref.last_values;
  return {
    title: data.title,
    url: data.url,
    publisher: base.publisher,
    published_on: data.published_at,
    // Sin "Fecha consulta" en el Sheet, la base completa la fecha de carga: no es una edición.
    captured_on: base.captured_on == null ? null : data.captured_at ? String(data.captured_at).slice(0, 10) : null,
    quality: data.quality,
    supports: base.supports,
    limitations: data.notes,
  };
}

// --- staging --------------------------------------------------------------------

export type StageOptions = { fileName: string; sha256: string; onlyCompanies?: string[] };

type Staged = {
  entity_type: EntityType;
  mapped: Mapped<Record<string, unknown>>;
  action: "crear" | "actualizar" | "sin_cambios" | "conflicto" | "rechazar";
  diff: DiffResult;
  target: string | null;
  ids: EntityIds;
};

/**
 * Lee el libro, arma una propuesta por fila y la deja en import_rows para revisar.
 * No escribe nada en las tablas de RELEVO: eso pasa recién al aplicar filas aprobadas.
 */
export async function stageImport(db: Db, workspaceId: string, parsed: ParsedWorkbook, opts: StageOptions) {
  const { rows: planned, summary } = await planImport(db, workspaceId, parsed, opts);
  const only = opts.onlyCompanies?.length ? opts.onlyCompanies.map((s) => s.toUpperCase()) : null;
  const { data: batch, error } = await db
    .from("import_batches")
    .insert({
      workspace_id: workspaceId,
      source_system: "google_sheets",
      file_name: opts.fileName,
      file_sha256: opts.sha256,
      summary: { ...summary, filtro: only, ids_formula: parsed.formulaIds } as JsonObj,
    })
    .select("id")
    .single();
  if (error) throw error;
  const rows = planned.map((r) => ({ ...r, workspace_id: workspaceId, batch_id: batch.id }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error: e } = await db.from("import_rows").insert(rows.slice(i, i + 200));
    if (e) throw e;
  }
  return batch.id;
}

export type PlannedRow = {
  entity_type: EntityType;
  external_id: string;
  sheet: string;
  row_number: number;
  raw: JsonObj;
  mapped: JsonObj;
  action: Staged["action"];
  target_entity_id: string | null;
  issues: JsonObj;
  conflicts: JsonObj;
  decision: "pendiente" | "aprobada" | "rechazada";
};

/**
 * Calcula la propuesta por fila SIN escribir nada (ni el lote): sirve para simular una reimportación
 * contra producción antes de subirla (conciliación).
 */
export async function planImport(db: Db, workspaceId: string, parsed: ParsedWorkbook, opts: Pick<StageOptions, "onlyCompanies"> = {}): Promise<{ rows: PlannedRow[]; summary: Record<string, number> }> {
  const ctx = await loadStageContext(db, workspaceId);
  const only = opts.onlyCompanies?.length ? new Set(opts.onlyCompanies.map((s) => s.toUpperCase())) : null;

  let companies = parsed.rows.companies.map(mapCompany);
  let contacts = parsed.rows.contacts.map(mapContact);
  let tasks = parsed.rows.tasks.map(mapTask);
  let sources = parsed.rows.sources.map(mapSource);
  if (only) {
    companies = companies.filter((c) => only.has(c.externalId.toUpperCase()));
    contacts = contacts.filter((c) => c.values.company_ref && only.has(c.values.company_ref.toUpperCase()));
    tasks = tasks.filter((t) => t.values.company_ref && only.has(t.values.company_ref.toUpperCase()));
    const cited = new Set([...companies.map((c) => c.values.source_ref), ...contacts.map((c) => c.values.source_ref)].filter(Boolean).map((s) => String(s).toUpperCase()));
    sources = sources.filter((s) => (s.values.entity_ref && only.has(s.values.entity_ref.toUpperCase())) || cited.has(s.externalId.toUpperCase()));
  }

  const inBatch = (type: EntityType, ext: string | null) =>
    !!ext && (ctx.refs.has(refKey(type, ext)) || { company: companies, contact: contacts, task: tasks, source: sources }[type].some((m) => m.externalId.toUpperCase() === ext.toUpperCase()));
  const ownerIssue = (name: string | null): Issue[] => {
    const { ids, unknown } = resolveOwners(name, ctx.members);
    return unknown.length
      ? [{
          code: "responsable_desconocido",
          severity: "info",
          field: "Responsable",
          message: `No hay un miembro del workspace que coincida con "${unknown.join(", ")}": ${ids.length ? "se asigna a quien sí es miembro" : "queda sin asignar"} (se puede cambiar después).`,
        }]
      : [];
  };

  // Posibles duplicados: empresas de RELEVO que no vienen de este CRM.
  const importedIds = new Set([...ctx.refs.values()].filter((r) => r.entity_type === "company").map((r) => r.entity_id));
  const { data: existing } = await db.from("companies").select("id, trade_name, legal_name, locality, website, public_phone, tax_id");
  const pool = (existing ?? []).filter((c) => !importedIds.has(c.id)).map((c) => ({ id: c.id, name: c.trade_name ?? c.legal_name ?? "", locality: c.locality, website: c.website, phone: c.public_phone, tax_id: c.tax_id }));

  // Personas que ya están en RELEVO sin venir de este CRM (p. ej. creadas desde una captura).
  const importedContacts = new Set([...ctx.refs.values()].filter((r) => r.entity_type === "contact").map((r) => r.entity_id));
  const { data: existingContacts } = await db.from("contacts").select("id, full_name, email, phone, contact_links(companies(trade_name, legal_name))").eq("contact_kind", "persona");
  const contactPool = (existingContacts ?? []).filter((c) => !importedContacts.has(c.id)).map((c) => ({
    id: c.id, name: c.full_name, email: c.email, phone: c.phone,
    companies: c.contact_links.map((l) => l.companies?.trade_name ?? l.companies?.legal_name).filter((x): x is string => !!x),
  }));
  const companyNameByRef = new Map(companies.map((c) => [c.externalId.toUpperCase(), c.values.trade_name]));

  // La misma empresa dos veces en el archivo (dos IDs): la fila anterior es la canónica; la posterior se
  // propone unificar (su ID pasa a apuntar a la misma empresa y suma lo que la canónica no tiene).
  const sameAs = new Map<string, string>();
  {
    const fresh = companies.filter((c) => !ctx.refs.has(refKey("company", c.externalId)));
    const pool = fresh.map((c) => ({ id: c.externalId, name: c.values.trade_name, locality: c.values.locality, website: c.values.website, phone: c.values.public_phone }));
    for (const [i, c] of fresh.entries()) {
      const earlier = new Set(fresh.slice(0, i).map((x) => x.externalId));
      const hit = findCandidates({ id: c.externalId, name: c.values.trade_name, locality: c.values.locality, website: c.values.website, phone: c.values.public_phone }, pool.filter((p) => earlier.has(p.id)))
        .find((x) => x.reason !== "nombre_parecido");
      if (hit) sameAs.set(c.externalId, hit.id);
    }
  }

  const staged: Staged[] = [];
  const stage = async (entity_type: EntityType, m: Mapped<Record<string, unknown>>, extra: Issue[], current: (ref: Ref) => Promise<Record<string, unknown> | null>) => {
    m.issues.push(...extra);
    const ref = ctx.refs.get(refKey(entity_type, m.externalId)) ?? null;
    const cur = ref ? await current(ref) : null;
    const diff = threeWay(m.values, ref?.last_values ?? null, cur, COMPARED[entity_type]);
    const blocked = m.issues.some((i) => i.severity === "bloquea") || !m.externalId;
    const action: Staged["action"] = blocked
      ? "rechazar"
      : diff.kind === "nuevo"
        ? "crear"
        : diff.kind === "sin_cambios"
          ? "sin_cambios"
          : diff.conflicts.length
            ? "conflicto"
            : "actualizar";
    // Ids planificados antes de escribir: reintentar la aplicación nunca duplica.
    const ids: EntityIds = ref
      ? ((ref.last_values._ids ?? {}) as EntityIds)
      : entity_type === "company"
        ? { company: crypto.randomUUID(), target: crypto.randomUUID(), ...(m.values.address_text ? { establishment: crypto.randomUUID() } : {}) }
        : entity_type === "source"
          ? { source: crypto.randomUUID(), ...(m.values.entity_ref ? { evidence: crypto.randomUUID() } : {}) }
          : { [entity_type]: crypto.randomUUID() };
    staged.push({ entity_type, mapped: m, action, diff, target: ref?.entity_id ?? null, ids });
  };

  for (const s of sources) await stage("source", s as Mapped<Record<string, unknown>>, [], (r) => currentSource(db, r));
  for (const c of companies) {
    const extra: Issue[] = [...ownerIssue(c.values.owner_name)];
    if (c.values.source_ref && SRC_ID.test(c.values.source_ref) && !inBatch("source", c.values.source_ref)) {
      extra.push({ code: "fuente_inexistente", severity: "info", field: "Fuente ID", message: `"${c.values.source_ref}" no está en FUENTES. Se usa el CRM como fuente hasta que exista.` });
    }
    const canonical = sameAs.get(c.externalId);
    if (canonical) {
      extra.push({
        code: "duplicado_en_archivo",
        severity: "revisar",
        message: `Parece la misma empresa que ${canonical} ("${companyNameByRef.get(canonical.toUpperCase())}") en este archivo.`,
        proposal: { label: `Unificar con ${canonical}: este ID apunta a la misma empresa y suma su fuente, verificación y relaciones`, patch: { _same_as: canonical } },
      });
    } else if ([...sameAs.values()].includes(c.externalId)) {
      const others = [...sameAs].filter(([, v]) => v === c.externalId).map(([k]) => k);
      extra.push({ code: "duplicado_en_archivo", severity: "info", message: `Registro canónico: ${others.join(", ")} se propone(n) unificar con esta empresa.` });
    }
    if (!ctx.refs.has(refKey("company", c.externalId))) {
      for (const cand of findCandidates({ id: "", name: c.values.trade_name, locality: c.values.locality, website: c.values.website, phone: c.values.public_phone }, pool)) {
        extra.push({
          code: "posible_duplicado",
          severity: "revisar",
          message: `Parece la misma empresa que "${cand.name}" en RELEVO (${cand.reason.replace(/_/g, " ")}).`,
          proposal: { label: `Vincular con "${cand.name}" en vez de crear una nueva`, patch: { _link_to: cand.id } },
        });
      }
    }
    await stage("company", c as Mapped<Record<string, unknown>>, extra, (r) => currentCompany(db, r, ctx));
  }
  for (const c of contacts) {
    const extra: Issue[] = [];
    // Sin empresa no bloquea (asesores, independientes): entra y queda en Calidad como "persona sin empresa".
    if (!c.values.company_ref) {
      extra.push({ code: "sin_empresa", severity: "info", field: "Empresa ID", message: "Sin empresa en el Sheet: entra como persona y queda en Calidad para vincularla." });
    } else if (!inBatch("company", c.values.company_ref)) {
      extra.push({ code: "referencia_rota", severity: "bloquea", field: "Empresa ID", message: `La empresa "${c.values.company_ref}" no está en el archivo ni en RELEVO.` });
    }
    if (!ctx.refs.has(refKey("contact", c.externalId)) && c.values.contact_kind !== "canal_institucional") {
      const inCompany = c.values.company_ref ? companyNameByRef.get(c.values.company_ref.toUpperCase()) : undefined;
      for (const cand of findContactCandidates({ id: "", name: c.values.full_name, email: c.values.email, phone: c.values.phone, companies: inCompany ? [inCompany] : [] }, contactPool)) {
        extra.push({
          code: "posible_duplicado",
          severity: "revisar",
          message: `Puede ser la misma persona que "${cand.name}" en RELEVO (${CONTACT_REASON[cand.reason]}).`,
          proposal: { label: `Vincular con "${cand.name}" en vez de crear otra`, patch: { _link_to: cand.id } },
        });
      }
    }
    await stage("contact", c as Mapped<Record<string, unknown>>, extra, (r) => currentContact(db, r));
  }
  for (const t of tasks) {
    const extra: Issue[] = [...ownerIssue(t.values.owner_name)];
    if (t.values.company_ref && !inBatch("company", t.values.company_ref)) {
      extra.push({ code: "referencia_rota", severity: "bloquea", field: "Empresa ID", message: `La empresa "${t.values.company_ref}" no está en el archivo ni en RELEVO.` });
    }
    if (t.values.contact_ref && !inBatch("contact", t.values.contact_ref)) {
      extra.push({ code: "referencia_rota", severity: "info", field: "Contacto ID", message: `El contacto "${t.values.contact_ref}" no se encontró: la actividad queda sin persona.` });
    }
    await stage("task", t as Mapped<Record<string, unknown>>, extra, (r) => currentTask(db, r, ctx));
  }

  const rawOf = new Map(Object.values(parsed.rows).flat().map((r) => [`${r.sheet}#${r.row}`, r.values]));
  const summary = staged.reduce<Record<string, number>>((acc, s) => ((acc[s.action] = (acc[s.action] ?? 0) + 1), acc), {});
  const rows: PlannedRow[] = staged.map((s) => ({
    entity_type: s.entity_type,
    external_id: s.mapped.externalId || `sin-id-${s.mapped.sheet}-${s.mapped.row}`,
    sheet: s.mapped.sheet,
    row_number: s.mapped.row,
    raw: { label: s.mapped.label, values: rawOf.get(`${s.mapped.sheet}#${s.mapped.row}`) ?? {} } as JsonObj,
    mapped: { values: s.mapped.values, ids: s.ids } as unknown as JsonObj,
    action: s.action,
    target_entity_id: s.target,
    issues: s.mapped.issues as unknown as JsonObj,
    conflicts: (s.diff.kind === "cambios" ? { updates: s.diff.updates, conflicts: s.diff.conflicts } : { relevoEdited: s.diff.kind === "sin_cambios" && s.diff.relevoEdited }) as unknown as JsonObj,
    // Sin cambios o rechazada por un problema bloqueante: no requieren decisión.
    decision: s.action === "sin_cambios" ? ("aprobada" as const) : s.action === "rechazar" ? ("rechazada" as const) : ("pendiente" as const),
  }));
  return { rows, summary };
}
