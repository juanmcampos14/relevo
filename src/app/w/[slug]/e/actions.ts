"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { commitPendingSources, peekSource } from "@/server/sources";
import { contactSchema, evidenceSchema, formToObject, zodFieldErrors } from "@/domain/schemas";
import { revalidateAfter } from "@/domain/evidence";
import { assetPartyRole } from "@/domain/catalogs";
import { entityFkFields, isEntityKind } from "@/server/entities";

export async function addEvidence(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const source = peekSource(fd);
  if (source.error) return { errors: { new_source_url: source.error } };
  const obj = formToObject(fd);
  obj.source_id = source.value;
  const parsed = evidenceSchema.safeParse(obj);
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const committed = await commitPendingSources(supabase, ctx.workspace.id, fd, parsed.data, [{ key: "source_id", prefix: "" }]);
  if (committed.error) return { message: committed.error };
  const { entity_kind, entity_id, ...rest } = committed.row;
  const target = entity_kind === "contact" ? { contact_id: entity_id } : entityFkFields(entity_kind, entity_id);
  const observedAt = new Date().toISOString();
  const { error } = await supabase.from("evidence").insert({
    ...rest,
    workspace_id: ctx.workspace.id,
    observed_at: observedAt,
    revalidate_after: revalidateAfter(observedAt, rest.evidence_type),
    ...target,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Evidencia registrada." };
}

export async function updateEvidenceStatus(slug: string, evidenceId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const status = String(fd.get("verification_status") ?? "");
  const { error } = await supabase.from("evidence").update({ verification_status: status }).eq("id", evidenceId);
  if (error) {
    return { message: error.code === "23514" ? "Ese estado requiere un origen comprobable (fuente, captura o visita)." : dbErrorMessage(error) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Verificación actualizada." };
}

/** Parte de un activo con rol explícito. Nunca se deduce el propietario de quien publica. */
export async function addAssetParty(slug: string, assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const role = String(fd.get("role") ?? "");
  const party = String(fd.get("party") ?? "");
  const [partyKind, partyId] = party.split(":");
  if (!assetPartyRole.values.includes(role as never)) return { errors: { role: "Elegí un rol" } };
  if (!partyId || !["company", "contact"].includes(partyKind)) return { errors: { party: "Elegí una empresa o persona" } };
  const { error } = await supabase.from("asset_parties").insert({
    workspace_id: ctx.workspace.id,
    asset_id: assetId,
    role,
    notes: String(fd.get("notes") ?? "").trim() || null,
    ...(partyKind === "company" ? { company_id: partyId } : { contact_id: partyId }),
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Parte agregada." };
}

export async function addContact(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const source = peekSource(fd);
  if (source.error) return { errors: { new_source_url: source.error } };
  const obj = formToObject(fd);
  obj.source_id = source.value;
  const parsed = contactSchema.safeParse(obj);
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const committed = await commitPendingSources(supabase, ctx.workspace.id, fd, parsed.data, [{ key: "source_id", prefix: "" }]);
  if (committed.error) return { message: committed.error };
  const { relation, link_kind, link_id, ...row } = committed.row;
  const { data, error } = await supabase
    .from("contacts")
    .insert({ ...row, workspace_id: ctx.workspace.id })
    .select("id")
    .single();
  if (error) return { message: dbErrorMessage(error) };
  if (link_kind && link_id && isEntityKind(link_kind)) {
    const { error: e2 } = await supabase
      .from("contact_links")
      .insert({ workspace_id: ctx.workspace.id, contact_id: data.id, relation, ...entityFkFields(link_kind, link_id) });
    if (e2) return { message: dbErrorMessage(e2) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Contacto registrado." };
}
