"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";

/** Preferencia de inicio por usuario. Solo cambia qué se muestra primero; nunca permisos. */
export async function setHomeView(slug: string, view: "operativa" | "ejecutiva"): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  await supabase
    .from("user_preferences")
    .upsert({ user_id: ctx.user.id, workspace_id: ctx.workspace.id, home: { view }, updated_at: new Date().toISOString() });
  revalidatePath(`/w/${slug}`);
}
