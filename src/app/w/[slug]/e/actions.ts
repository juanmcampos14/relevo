"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { commitPendingSources, peekSource } from "@/server/sources";
import { claimSchema, contactSchema, formToObject, zodFieldErrors } from "@/domain/schemas";
import { entityFkFields, isEntityKind } from "@/server/entities";

export async function addClaim(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const source = peekSource(fd);
  if (source.error) return { errors: { new_source_url: source.error } };
  const obj = formToObject(fd);
  obj.source_id = source.value;
  const parsed = claimSchema.safeParse(obj);
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const committed = await commitPendingSources(supabase, ctx.workspace.id, fd, parsed.data, [{ key: "source_id", prefix: "" }]);
  if (committed.error) return { message: committed.error };
  const { entity_kind, entity_id, ...rest } = committed.row;
  const target = entity_kind === "contact" ? { contact_id: entity_id } : entityFkFields(entity_kind, entity_id);
  const { error } = await supabase.from("claims").insert({ ...rest, workspace_id: ctx.workspace.id, ...target });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Afirmación registrada." };
}

export async function updateClaimStatus(slug: string, claimId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const status = String(fd.get("verification_status") ?? "");
  const { error } = await supabase.from("claims").update({ verification_status: status }).eq("id", claimId);
  if (error) {
    return { message: error.code === "23514" ? "Ese estado requiere que la afirmación tenga fuente." : dbErrorMessage(error) };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Estado actualizado." };
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
