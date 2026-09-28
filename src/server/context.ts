import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

export const getSessionUser = cache(async (): Promise<SessionUser> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { id: claims.sub, email: String(claims.email ?? "") };
});

export type WorkspaceContext = {
  user: SessionUser;
  workspace: { id: string; name: string; slug: string };
  role: "owner" | "admin" | "member" | "viewer";
  canEdit: boolean;
  canApprove: boolean;
};

/**
 * Resuelve el workspace por slug CON la sesión del usuario (RLS): si no es miembro,
 * no lo ve y responde 404. Rol y capacidades se usan solo para la UI; la base
 * vuelve a verificar todo en cada escritura.
 */
export const getWorkspaceContext = cache(async (slug: string): Promise<WorkspaceContext> => {
  const user = await getSessionUser();
  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!workspace) notFound();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role, can_approve_decisions")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) notFound();
  const role = membership.role as WorkspaceContext["role"];
  return {
    user,
    workspace,
    role,
    canEdit: role !== "viewer",
    canApprove: membership.can_approve_decisions,
  };
});
