import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { SRC_ID, fold, resolveOwners, type Issue } from "@/domain/crm-import/map";
import type { FieldChange, FieldConflict } from "@/domain/crm-import/diff";
import { revalidateAfter } from "@/domain/evidence";
import { loadStageContext, type EntityIds, type EntityType, type StageContext } from "./stage";

type Db = SupabaseClient<Database>;
type JsonObj = NonNullable<Json>;

/** Decisión humana sobre una fila: qué propuestas se aplican y, en conflictos, qué valor gana. */
export type Resolution = { issues?: Record<string, "aplicar" | "ignorar">; fields?: Record<string, "sheet" | "relevo"> };

type Row = {
  id: string;
  entity_type: EntityType;
  external_id: string;
  sheet: string;
  row_number: number;
  action: string;
  target_entity_id: string | null;
  mapped: { values: Record<string, unknown>; ids: EntityIds };
  issues: Issue[];
  conflicts: { updates?: FieldChange[]; conflicts?: FieldConflict[] };
  resolution: Resolution;
};

const ORDER: EntityType[] = ["source", "company", "contact", "task"];
const COMPANY_COLS = ["trade_name", "sector", "activity", "locality", "public_phone", "website", "notes", "drive_folder_url", "verification_status"];
const CONTACT_COLS = ["full_name", "contact_kind", "role_title", "email", "phone", "profile_url", "preferred_channel", "relationship_status", "contact_permission", "notes", "outreach_draft"];

/** Qué falta decidir en una fila antes de poder aprobarla. */
export function pendingChoices(row: Pick<Row, "issues" | "conflicts" | "resolution">): string[] {
  const missing: string[] = [];
  row.issues.forEach((i, idx) => {
    if (i.severity === "revisar" && i.proposal && !row.resolution.issues?.[idx]) missing.push(i.message);
  });
  for (const c of row.conflicts.conflicts ?? []) if (!row.resolution.fields?.[c.field]) missing.push(`Conflicto en ${c.field}`);
  return missing;
}

function finalValues(row: Row): Record<string, unknown> {
  const v = { ...row.mapped.values };
  row.issues.forEach((i, idx) => {
    if (i.proposal && row.resolution.issues?.[idx] === "aplicar") Object.assign(v, i.proposal.patch);
  });
  return v;
}

function fieldsToWrite(row: Row): string[] {
  if (row.action === "crear") return [];
  const fromSheet = (row.conflicts.conflicts ?? []).filter((c) => row.resolution.fields?.[c.field] === "sheet").map((c) => c.field);
  return [...(row.conflicts.updates ?? []).map((u) => u.field), ...fromSheet];
}

const pick = (v: Record<string, unknown>, cols: string[], only?: string[]) =>
  Object.fromEntries(cols.filter((c) => !only || only.includes(c)).map((c) => [c, v[c] ?? null]));

async function crmSourceId(db: Db, workspaceId: string): Promise<string> {
  const title = "CRM Daicou (Google Sheets)";
  const { data } = await db.from("sources").select("id").eq("kind", "crm").eq("title", title).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await db
    .from("sources")
    .insert({ workspace_id: workspaceId, kind: "crm", title, notes: "Registros importados del CRM de Sheets. Cada uno conserva su ID, pestaña y fila." })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/** Nota que agrega el importador cuando el CRM tiene varios responsables (no es un dato del Sheet). */
export const SHARED_OWNERS_PREFIX = "Responsables en el CRM: ";

/** Fecha del CRM (AAAA-MM-DD) como mediodía de Argentina: evita que se muestre el día anterior. */
const arNoon = (date: string) => `${date}T12:00:00-03:00`;

/** Fuente que el CRM cita en texto libre: se registra una vez (tipo "crm") y se reutiliza. */
async function citedSourceId(db: Db, workspaceId: string, text: string, externalId: string): Promise<string> {
  const { data } = await db.from("sources").select("id").eq("kind", "crm").eq("title", text).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await db
    .from("sources")
    .insert({ workspace_id: workspaceId, kind: "crm", title: text, reference: `Citada por el CRM en ${externalId}`, notes: "Fuente mencionada en el CRM de Sheets; RELEVO todavía no la revisó." })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/**
 * La vertical sale de la taxonomía acordada, no del texto libre del Sheet: si el sector coincide con una
 * vertical existente se vincula; si no, queda como sector de la empresa (sin crear verticales nuevas).
 */
async function verticalId(db: Db, name: string, cache: Map<string, string | null>): Promise<string | null> {
  const key = fold(name);
  if (cache.has(key)) return cache.get(key)!;
  const { data: all } = await db.from("verticals").select("id, name").eq("status", "activa");
  const hit = (all ?? []).find((v) => fold(v.name) === key)?.id ?? null;
  cache.set(key, hit);
  return hit;
}

async function upsertIgnore<T extends keyof Database["public"]["Tables"]>(db: Db, table: T, row: Database["public"]["Tables"][T]["Insert"]) {
  // Id planificado en el staging: si la fila ya existe (reintento), no se duplica ni se pisa.
  const { error } = await db.from(table).upsert(row as never, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

export type ApplyResult = { applied: number; unchanged: number; errors: { external_id: string; message: string }[] };

export async function applyBatch(db: Db, workspaceId: string, batchId: string): Promise<ApplyResult> {
  const { data: raw } = await db
    .from("import_rows")
    .select("id, entity_type, external_id, sheet, row_number, action, target_entity_id, mapped, issues, conflicts, resolution")
    .eq("batch_id", batchId)
    .eq("decision", "aprobada")
    .is("applied_at", null);
  // Tipo por tipo; dentro de empresas, las que se unifican con otra van después de su canónica.
  const unifies = (r: Row) => (r.entity_type === "company" && typeof finalValues(r)._same_as === "string" ? 1 : 0);
  const rows = ((raw ?? []) as unknown as Row[]).sort((a, b) => ORDER.indexOf(a.entity_type) - ORDER.indexOf(b.entity_type) || unifies(a) - unifies(b));
  const ctx = await loadStageContext(db, workspaceId);
  const crmSource = await crmSourceId(db, workspaceId);
  const verticals = new Map<string, string | null>();
  const result: ApplyResult = { applied: 0, unchanged: 0, errors: [] };
  const evidenceLater: { row: Row; ids: EntityIds; v: Record<string, unknown> }[] = [];

  const refOf = (type: EntityType, ext: unknown) => (typeof ext === "string" ? ctx.refs.get(`${type}:${ext.toUpperCase()}`) : undefined);
  const saveRef = async (row: Row, entityId: string, ids: EntityIds) => {
    const last_values = { ...row.mapped.values, _ids: ids } as JsonObj;
    const { error } = await db.from("external_refs").upsert(
      {
        workspace_id: workspaceId,
        source_system: "google_sheets",
        external_id: row.external_id,
        entity_type: row.entity_type,
        entity_id: entityId,
        sheet: row.sheet,
        row_number: row.row_number,
        last_values,
        last_batch_id: batchId,
        last_imported_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,source_system,external_id,entity_type" },
    );
    if (error) throw error;
    ctx.refs.set(`${row.entity_type}:${row.external_id.toUpperCase()}`, { external_id: row.external_id, entity_type: row.entity_type, entity_id: entityId, last_values: last_values as Record<string, unknown> });
  };

  // Lo que la fila del CRM dice además de sus campos: la fuente citada en texto libre y el detalle del
  // estado de verificación. Idempotente: se completa también en reimportaciones sin cambios.
  const ensureCompanyDerived = async (row: Row, v: Record<string, unknown>, ids: EntityIds, companyId: string) => {
    const ref = typeof v.source_ref === "string" ? v.source_ref.trim() : "";
    if (ref && !SRC_ID.test(ref) && !ids.cited_source) {
      ids.cited_source = await citedSourceId(db, workspaceId, ref, row.external_id);
      await db.from("companies").update({ source_id: ids.cited_source }).eq("id", companyId).eq("source_id", crmSource);
    }
    if (typeof v.evidence_note === "string" && v.evidence_note && !ids.status_evidence) {
      ids.status_evidence = crypto.randomUUID();
      const source = ids.cited_source ?? (SRC_ID.test(ref) ? refOf("source", ref)?.entity_id : undefined) ?? crmSource;
      const observed = (v.last_verified_on as string | null) ?? new Date().toISOString().slice(0, 10);
      await upsertIgnore(db, "evidence", {
        id: ids.status_evidence,
        workspace_id: workspaceId,
        statement: v.evidence_note,
        evidence_type: "dato",
        origin_kind: /aog/i.test(`${v.evidence_note} ${ref}`) ? "aog" : "crm_import",
        verification_status: (v.verification_status as string) ?? "unverified",
        observed_at: arNoon(observed),
        revalidate_after: revalidateAfter(arNoon(observed), "dato"),
        source_id: source,
        company_id: companyId,
      });
    }
  };

  for (const row of rows) {
    try {
      const v = finalValues(row);
      const ids: EntityIds = { ...row.mapped.ids };
      const only = fieldsToWrite(row);
      const creating = row.action === "crear";
      const entityId = row.target_entity_id;

      if (row.action === "sin_cambios") {
        if (row.entity_type === "company" && ids.company) await ensureCompanyDerived(row, v, ids, entityId!);
        await saveRef(row, entityId!, ids);
      } else if (row.entity_type === "source") {
        const sourceRow = {
          title: v.title as string,
          url: (v.url as string | null) ?? null,
          kind: v.url ? "url" : "crm",
          publisher: (v.publisher as string | null) ?? null,
          published_at: (v.published_on as string | null) ?? null,
          captured_at: (v.captured_on as string | null) ?? undefined,
          quality: (v.quality as "alta" | "media" | "baja" | null) ?? null,
          notes: (v.limitations as string | null) ?? null,
          reference: `CRM ${row.external_id}`,
        };
        let id = entityId ?? ids.source!;
        if (creating) {
          // La misma URL puede estar cargada a mano: se reutiliza en vez de duplicarla.
          const { data: same } = sourceRow.url ? await db.from("sources").select("id").eq("url", sourceRow.url).maybeSingle() : { data: null };
          if (same) id = same.id;
          else await upsertIgnore(db, "sources", { id, workspace_id: workspaceId, ...sourceRow });
          ids.source = id;
          if (v.entity_ref) evidenceLater.push({ row, ids, v });
        } else if (only.length) {
          const patch = pick({ ...sourceRow, published_on: undefined } as Record<string, unknown>, ["title", "url", "publisher", "published_at", "captured_at", "quality", "notes"]);
          const map: Record<string, string> = { published_on: "published_at", captured_on: "captured_at", limitations: "notes" };
          const cols = only.map((f) => map[f] ?? f).filter((f) => f in patch);
          if (cols.length) {
            const update = Object.fromEntries(cols.map((c) => [c, patch[c]])) as Database["public"]["Tables"]["sources"]["Update"];
            const { error } = await db.from("sources").update(update).eq("id", id);
            if (error) throw error;
          }
        }
        await saveRef(row, id, ids);
      } else if (row.entity_type === "company") {
        const src = typeof v.source_ref === "string" && SRC_ID.test(v.source_ref) ? refOf("source", v.source_ref)?.entity_id ?? crmSource : crmSource;
        const owner = resolveOwners(v.owner_name as string | null, ctx.members).ids[0] ?? null;
        if (creating && typeof v._link_to === "string") {
          // Duplicado confirmado: se vincula el ID del CRM a la empresa existente, sin tocar sus datos.
          await saveRef(row, v._link_to, { company: v._link_to });
        } else if (creating && typeof v._same_as === "string") {
          // Misma empresa que otra fila del archivo: este ID apunta a la canónica. Solo completa lo que la
          // canónica no tiene (fuente y verificación mejores, dirección, web) y la prioridad más alta; no pisa datos.
          const canon = refOf("company", v._same_as);
          if (!canon) throw new Error(`Primero hay que aprobar ${v._same_as} (registro canónico).`);
          const canonIds = (canon.last_values._ids ?? {}) as EntityIds;
          const { data: cur } = await db.from("companies").select("website, locality, public_phone, verification_status, source_id").eq("id", canon.entity_id).single();
          const rank: Record<string, number> = { unverified: 0, partially_verified: 1, publicly_verified: 2, field_verified: 3 };
          const better = (rank[v.verification_status as string] ?? 0) > (rank[cur?.verification_status ?? "unverified"] ?? 0);
          const fill = {
            ...(!cur?.website && v.website ? { website: v.website as string } : {}),
            ...(!cur?.locality && v.locality ? { locality: v.locality as string } : {}),
            ...(!cur?.public_phone && v.public_phone ? { public_phone: v.public_phone as string } : {}),
            ...(better ? { verification_status: v.verification_status as string, source_id: src } : {}),
          };
          if (Object.keys(fill).length) {
            const { error } = await db.from("companies").update(fill).eq("id", canon.entity_id);
            if (error) throw error;
          }
          if (canonIds.target && typeof v.priority === "number") {
            await db.from("campaign_targets").update({ priority: v.priority }).eq("id", canonIds.target).gt("priority", v.priority);
          }
          const note = `También figura en el CRM como ${row.external_id} (unificada con ${v._same_as}).`;
          const { data: withNotes } = await db.from("companies").select("notes").eq("id", canon.entity_id).single();
          if (!withNotes?.notes?.includes(note)) await db.from("companies").update({ notes: [withNotes?.notes, note].filter(Boolean).join("\n") }).eq("id", canon.entity_id);
          await saveRef(row, canon.entity_id, { ...canonIds });
          if (v.evidence_note || (typeof v.source_ref === "string" && !SRC_ID.test(v.source_ref))) await ensureCompanyDerived(row, v, { company: canon.entity_id }, canon.entity_id);
        } else {
          const companyId = entityId ?? ids.company!;
          if (creating) {
            await upsertIgnore(db, "companies", { id: companyId, workspace_id: workspaceId, ...pick(v, COMPANY_COLS), trade_name: v.trade_name as string, source_id: src, verification_status: v.verification_status as string });
          } else {
            const patch = pick(v, COMPANY_COLS, only);
            if (Object.keys(patch).length) {
              const { error } = await db.from("companies").update({ ...patch, ...(patch.verification_status && patch.verification_status !== "unverified" ? { source_id: src } : {}) }).eq("id", companyId);
              if (error) throw error;
            }
          }
          const targetFields = ["priority", "stage", "next_action", "next_action_due", "owner_name"];
          if (ctx.missionId && (creating || only.some((f) => targetFields.includes(f)))) {
            const t = {
              ...(creating || only.includes("priority") ? { priority: v.priority as number } : {}),
              ...(creating || only.includes("stage") ? { status: v.stage as string } : {}),
              ...(creating || only.includes("next_action") ? { next_action: (v.next_action as string | null) ?? null } : {}),
              ...(creating || only.includes("next_action_due") ? { next_action_due: (v.next_action_due as string | null) ?? null } : {}),
              ...(creating || only.includes("owner_name") ? { owner_id: owner } : {}),
            };
            if (ids.target && !creating) {
              const { error } = await db.from("campaign_targets").update(t).eq("id", ids.target);
              if (error) throw error;
            } else {
              ids.target = ids.target ?? crypto.randomUUID();
              await upsertIgnore(db, "campaign_targets", { id: ids.target, workspace_id: workspaceId, campaign_id: ctx.missionId, company_id: companyId, ...t });
            }
          }
          if (ids.target && v.sector && (creating || only.includes("sector"))) {
            const vid = await verticalId(db, v.sector as string, verticals);
            if (vid) {
              const { error } = await db.from("target_verticals").upsert({ workspace_id: workspaceId, target_id: ids.target, vertical_id: vid }, { onConflict: "target_id,vertical_id", ignoreDuplicates: true });
              if (error) throw error;
            }
          }
          if (v.address_text && (creating || only.includes("address_text"))) {
            if (ids.establishment && !creating) {
              const { error } = await db.from("establishments").update({ address_text: v.address_text as string, address_status: "no_verificada" }).eq("id", ids.establishment);
              if (error) throw error;
            } else {
              ids.establishment = ids.establishment ?? crypto.randomUUID();
              await upsertIgnore(db, "establishments", {
                id: ids.establishment,
                workspace_id: workspaceId,
                company_id: companyId,
                name: v.trade_name as string,
                address_text: v.address_text as string,
                locality: (v.locality as string | null) ?? null,
                address_status: "no_verificada",
              });
            }
          }
          ids.company = companyId;
          await ensureCompanyDerived(row, v, ids, companyId);
          await saveRef(row, companyId, ids);
        }
      } else if (row.entity_type === "contact") {
        const company = refOf("company", v.company_ref);
        const src = typeof v.source_ref === "string" && SRC_ID.test(v.source_ref) ? refOf("source", v.source_ref)?.entity_id ?? crmSource : crmSource;
        const linkTo = creating && typeof v._link_to === "string" ? v._link_to : null;
        const contactId = linkTo ?? entityId ?? ids.contact!;
        if (linkTo) {
          // Duplicado confirmado: el ID del CRM queda apuntando a la persona existente (sin pisar sus datos)
          // y se suma la relación con la empresa del CRM.
          if (company) {
            const { error } = await db.from("contact_links").upsert(
              { workspace_id: workspaceId, contact_id: contactId, company_id: company.entity_id, relation: "otro" },
              { onConflict: "contact_id,company_id,establishment_id,asset_id", ignoreDuplicates: true },
            );
            if (error) throw error;
          }
        } else if (creating) {
          await upsertIgnore(db, "contacts", { id: contactId, workspace_id: workspaceId, ...pick(v, CONTACT_COLS), full_name: v.full_name as string, source_id: src });
          if (company) {
            const { error } = await db.from("contact_links").upsert(
              { workspace_id: workspaceId, contact_id: contactId, company_id: company.entity_id, relation: "otro" },
              { onConflict: "contact_id,company_id,establishment_id,asset_id", ignoreDuplicates: true },
            );
            if (error) throw error;
          }
        } else if (only.length) {
          const { error } = await db.from("contacts").update({ ...pick(v, CONTACT_COLS, only), source_id: src }).eq("id", contactId);
          if (error) throw error;
        }
        ids.contact = contactId;
        await saveRef(row, contactId, ids);
      } else if (row.entity_type === "task") {
        const owners = resolveOwners(v.owner_name as string | null, ctx.members);
        const company = refOf("company", v.company_ref);
        const contact = refOf("contact", v.contact_ref);
        const description = [v.result, owners.ids.length + owners.unknown.length > 1 ? `${SHARED_OWNERS_PREFIX}${v.owner_name}` : null].filter(Boolean).join("\n") || null;
        const taskId = entityId ?? ids.task!;
        const cols = {
          title: v.title as string,
          kind: (v.kind as string | null) ?? null,
          channel: (v.channel as string | null) ?? null,
          due_on: (v.due_on as string | null) ?? null,
          status: v.status as "todo",
          assignee_id: owners.ids[0] ?? null,
          description,
        };
        if (creating) {
          const target = (company?.last_values._ids as EntityIds | undefined)?.target ?? null;
          await upsertIgnore(db, "tasks", { id: taskId, workspace_id: workspaceId, ...cols, target_id: target, contact_id: contact?.entity_id ?? null });
        } else if (only.length) {
          const map: Record<string, string> = { owner_name: "assignee_id", result: "description" };
          const patch = Object.fromEntries(only.map((f) => [map[f] ?? f, cols[(map[f] ?? f) as keyof typeof cols]])) as Database["public"]["Tables"]["tasks"]["Update"];
          const { error } = await db.from("tasks").update(patch).eq("id", taskId);
          if (error) throw error;
        }
        ids.task = taskId;
        await saveRef(row, taskId, ids);
      }

      const { error } = await db.from("import_rows").update({ applied_at: new Date().toISOString() }).eq("id", row.id);
      if (error) throw error;
      if (row.action === "sin_cambios") result.unchanged++;
      else result.applied++;
    } catch (e) {
      result.errors.push({ external_id: row.external_id, message: (e as { message?: string }).message ?? String(e) });
    }
  }

  // Evidencia de cada fuente sobre su empresa ("Hecho que sustenta"), una vez que las empresas existen.
  for (const { row, ids, v } of evidenceLater) {
    try {
      const company = refOf("company", v.entity_ref);
      if (!company || !ids.evidence) continue;
      const status = (company.last_values.verification_status as string | undefined) ?? "unverified";
      const observed = (v.captured_on as string | null) ?? new Date().toISOString().slice(0, 10);
      await upsertIgnore(db, "evidence", {
        id: ids.evidence,
        workspace_id: workspaceId,
        statement: (v.supports as string | null) ?? (v.title as string),
        evidence_type: "publicacion",
        origin_kind: /gobierno|registro|oficial/i.test(String(v.publisher ?? "")) ? "public_registry" : "website",
        verification_status: status,
        observed_at: arNoon(observed),
        revalidate_after: revalidateAfter(arNoon(observed), "publicacion"),
        next_verification_step: (v.limitations as string | null) ?? null,
        source_id: ids.source!,
        company_id: company.entity_id,
      });
    } catch (e) {
      result.errors.push({ external_id: row.external_id, message: `Evidencia: ${(e as { message?: string }).message ?? String(e)}` });
    }
  }

  const { count } = await db.from("import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).or("decision.eq.pendiente,and(decision.eq.aprobada,applied_at.is.null)");
  if (!count) await db.from("import_batches").update({ status: "aplicado", closed_at: new Date().toISOString() }).eq("id", batchId);
  return result;
}

export type { StageContext };
