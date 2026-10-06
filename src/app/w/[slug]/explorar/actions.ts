"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { commitPendingSources, peekSource } from "@/server/sources";
import {
  assetSchema,
  campaignSchema,
  companySchema,
  establishmentSchema,
  formToObject,
  sourceSchema,
  targetFieldsSchema,
  toPlaceRow,
  verticalSchema,
  zodFieldErrors,
} from "@/domain/schemas";
import { entityFkFields, entityTable, isEntityKind, type EntityKind } from "@/server/entities";
import { lockAfterHumanEdit } from "@/server/locks";

async function setup(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { ctx, supabase: null } as const;
  return { ctx, supabase: await createClient() } as const;
}
const noPermission: ActionState = { message: "Tu rol es de solo lectura en este workspace." };

export async function createCampaign(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const parsed = campaignSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { vertical_ids, ...row } = parsed.data;
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ ...row, workspace_id: ctx.workspace.id, owner_id: ctx.user.id })
    .select("id")
    .single();
  if (error) return { message: dbErrorMessage(error) };
  if (vertical_ids.length) {
    const { error: e2 } = await supabase
      .from("campaign_verticals")
      .insert(vertical_ids.map((vertical_id) => ({ workspace_id: ctx.workspace.id, campaign_id: data.id, vertical_id })));
    if (e2) return { message: dbErrorMessage(e2) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/explorar/c/${data.id}`);
}

export async function updateCampaignVerticals(slug: string, campaignId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const wanted = new Set(fd.getAll("vertical_ids").map(String).filter(Boolean));
  const { data: current } = await supabase.from("campaign_verticals").select("vertical_id").eq("campaign_id", campaignId);
  const have = new Set((current ?? []).map((r) => r.vertical_id));
  const toAdd = [...wanted].filter((v) => !have.has(v));
  const toRemove = [...have].filter((v) => !wanted.has(v));
  if (toAdd.length) {
    const { error } = await supabase
      .from("campaign_verticals")
      .insert(toAdd.map((vertical_id) => ({ workspace_id: ctx.workspace.id, campaign_id: campaignId, vertical_id })));
    if (error) return { message: dbErrorMessage(error) };
  }
  if (toRemove.length) {
    const { error } = await supabase.from("campaign_verticals").delete().eq("campaign_id", campaignId).in("vertical_id", toRemove);
    if (error) return { message: dbErrorMessage(error) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Verticales actualizadas." };
}

export async function createVertical(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const parsed = verticalSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase.from("verticals").insert({ ...parsed.data, workspace_id: ctx.workspace.id });
  if (error) return { message: error.code === "23505" ? "Ya existe una vertical con ese nombre." : dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Vertical creada." };
}

export async function createSource(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const parsed = sourceSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase.from("sources").insert({ ...parsed.data, workspace_id: ctx.workspace.id });
  if (error) return { message: error.code === "23505" ? "Esa URL ya está registrada como fuente." : dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Fuente registrada." };
}

// ---------------------------------------------------------------------------------
// Entidades (empresa / establecimiento / activo)
// ---------------------------------------------------------------------------------

const SOURCE_FIELDS = [
  { key: "source_id", prefix: "" },
  { key: "location_source_id", prefix: "" },
  { key: "price_source_id", prefix: "price_" },
];

type EntityWrite =
  | { ok: true; kind: EntityKind; row: Record<string, unknown> }
  | { ok: false; state: ActionState };

/** Valida los campos de una entidad según su tipo y arma la fila para la base. */
/** Valida sin escribir nada; las fuentes nuevas quedan como PENDING_SOURCE. */
function buildEntityRow(kind: EntityKind, fd: FormData): EntityWrite {
  const source = peekSource(fd);
  if (source.error) return { ok: false, state: { errors: { new_source_url: source.error } } };
  const priceSource = peekSource(fd, "price_");
  if (priceSource.error) return { ok: false, state: { errors: { price_new_source_url: priceSource.error } } };
  const obj = formToObject(fd);
  obj.source_id = source.value;
  obj.price_source_id = priceSource.value;
  // Si la dirección se marca verificada sin elegir fuente de ubicación, se usa la fuente principal.
  if (obj.address_verified === "on" && !obj.location_source_id) obj.location_source_id = source.value;

  if (kind === "company") {
    const p = companySchema.safeParse(obj);
    if (!p.success) return { ok: false, state: { errors: zodFieldErrors(p.error) } };
    return { ok: true, kind, row: p.data };
  }
  if (kind === "establishment") {
    const p = establishmentSchema.safeParse(obj);
    if (!p.success) return { ok: false, state: { errors: zodFieldErrors(p.error) } };
    const { address_text, locality, province, address_verified, location_source_id, latitude, longitude, ...rest } = p.data;
    return {
      ok: true,
      kind,
      row: { ...rest, ...toPlaceRow({ address_text, locality, province, address_verified, location_source_id, latitude, longitude }) },
    };
  }
  const p = assetSchema.safeParse(obj);
  if (!p.success) return { ok: false, state: { errors: zodFieldErrors(p.error) } };
  const { address_text, locality, province, address_verified, location_source_id, latitude, longitude, ...rest } = p.data;
  return {
    ok: true,
    kind,
    row: { ...rest, ...toPlaceRow({ address_text, locality, province, address_verified, location_source_id, latitude, longitude }) },
  };
}

/** Alta de un objetivo en la campaña: entidad nueva o existente + estado + verticales. */
export async function createTarget(slug: string, campaignId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const ws = ctx.workspace.id;

  const targetFields = targetFieldsSchema.safeParse(formToObject(fd));
  if (!targetFields.success) return { errors: zodFieldErrors(targetFields.error) };

  let kind: EntityKind;
  let entityId: string;
  const existing = String(fd.get("existing") ?? "");
  if (existing) {
    const [k, id] = existing.split(":");
    if (!isEntityKind(k) || !id) return { errors: { existing: "Selección inválida" } };
    kind = k;
    entityId = id;
  } else {
    const k = String(fd.get("kind") ?? "");
    if (!isEntityKind(k)) return { errors: { kind: "Elegí el tipo" } };
    const built = buildEntityRow(k, fd);
    if (!built.ok) return built.state;
    const committed = await commitPendingSources(supabase, ws, fd, built.row, SOURCE_FIELDS);
    if (committed.error) return { message: committed.error };
    const { data, error } = await supabase
      .from(entityTable[k])
      .insert({ ...committed.row, workspace_id: ws } as never)
      .select("id")
      .single<{ id: string }>();
    if (error) return { message: dbErrorMessage(error) };
    kind = k;
    entityId = data.id;
  }

  const { vertical_ids, ...fields } = targetFields.data;
  const { data: target, error } = await supabase
    .from("campaign_targets")
    .insert({ ...fields, workspace_id: ws, campaign_id: campaignId, ...entityFkFields(kind, entityId), owner_id: ctx.user.id })
    .select("id")
    .single();
  if (error) {
    return { message: error.code === "23505" ? "Ese registro ya es objetivo de esta campaña." : dbErrorMessage(error) };
  }
  if (vertical_ids.length) {
    const { error: e2 } = await supabase
      .from("target_verticals")
      .insert(vertical_ids.map((vertical_id) => ({ workspace_id: ws, target_id: target.id, vertical_id })));
    if (e2) return { message: dbErrorMessage(e2) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Objetivo agregado." };
}

/** Edición de una entidad existente (misma validación que el alta). */
export async function updateEntity(slug: string, kind: EntityKind, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const built = buildEntityRow(kind, fd);
  if (!built.ok) return built.state;
  const committed = await commitPendingSources(supabase, ctx.workspace.id, fd, built.row, SOURCE_FIELDS);
  if (committed.error) return { message: committed.error };
  const { data: before } = await supabase.from(entityTable[kind]).select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from(entityTable[kind]).update(committed.row as never).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  // Lo que una persona corrigió queda bloqueado: una ingesta posterior (Sheet, Radar) no lo pisa.
  if (before) await lockAfterHumanEdit(supabase, entityTable[kind], id, before as Record<string, unknown>, committed.row as Record<string, unknown>);
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Cambios guardados." };
}

export async function updateTarget(slug: string, targetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await setup(slug);
  if (!supabase) return noPermission;
  const parsed = targetFieldsSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { vertical_ids, ...fields } = parsed.data;
  const { error } = await supabase
    .from("campaign_targets")
    .update({ ...fields, discard_reason: fields.status === "descartado" ? fields.discard_reason : null })
    .eq("id", targetId);
  if (error) return { message: dbErrorMessage(error) };
  const { data: current } = await supabase.from("target_verticals").select("vertical_id").eq("target_id", targetId);
  const have = new Set((current ?? []).map((r) => r.vertical_id));
  const wanted = new Set(vertical_ids);
  const toAdd = [...wanted].filter((v) => !have.has(v));
  const toRemove = [...have].filter((v) => !wanted.has(v));
  if (toAdd.length) {
    await supabase.from("target_verticals").insert(toAdd.map((vertical_id) => ({ workspace_id: ctx.workspace.id, target_id: targetId, vertical_id })));
  }
  if (toRemove.length) {
    await supabase.from("target_verticals").delete().eq("target_id", targetId).in("vertical_id", toRemove);
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Objetivo actualizado." };
}
