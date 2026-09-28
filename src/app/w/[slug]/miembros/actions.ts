"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { formToObject, inviteSchema, zodFieldErrors } from "@/domain/schemas";

export async function inviteMember(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  const parsed = inviteSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };

  // 1) La invitación se registra con la sesión del usuario: RLS decide si puede invitar
  //    (owner/admin) y si puede otorgar capacidad de aprobar (solo owner).
  const supabase = await createClient();
  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: ctx.workspace.id,
    email: parsed.data.email,
    role: parsed.data.role,
    can_approve_decisions: parsed.data.can_approve_decisions,
    invited_by: ctx.user.id,
  });
  if (error) {
    if (error.code === "23505") return { message: "Ya hay una invitación pendiente para ese email." };
    if (error.code === "42501") return { message: "No tenés permiso para esta invitación (solo el owner puede otorgar la capacidad de aprobar)." };
    return { message: dbErrorMessage(error) };
  }

  // 2) Recién después, el servidor pide a Auth que envíe el email de invitación.
  const admin = createAdminClient();
  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/cuenta`,
  });
  revalidatePath(`/w/${slug}/miembros`);
  if (mailError) {
    // Usuario ya existente: no hace falta email; la invitación se acepta al iniciar sesión.
    const exists = /already|registered|exists/i.test(mailError.message);
    return exists
      ? { ok: true, message: "Invitación registrada. Esa persona ya tiene cuenta: se suma al entrar." }
      : { ok: true, message: "Invitación registrada, pero el email no se pudo enviar. No figura como enviado." };
  }
  return { ok: true, message: "Invitación registrada y email enviado por Supabase Auth." };
}

export async function setApprovalCapability(slug: string, userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const value = fd.get("can_approve_decisions") === "on";
  const { data, error } = await supabase
    .from("memberships")
    .update({ can_approve_decisions: value })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId)
    .select("id");
  if (error) return { message: error.message.includes("viewer_cannot_approve") ? "Un usuario de solo lectura no puede aprobar." : dbErrorMessage(error) };
  if (!data?.length) return { message: "Solo el owner puede cambiar capacidades." };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Capacidad actualizada." };
}

export async function revokeInvitation(slug: string, invitationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("workspace_invitations").update({ status: "revoked" }).eq("id", invitationId);
  revalidatePath(`/w/${slug}/miembros`);
}
