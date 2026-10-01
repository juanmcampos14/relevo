import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/server/context";

// /hoy → la nueva superficie del workspace (si hay uno solo); si no, la lista de workspaces.
export default async function HoyRoot() {
  await getSessionUser();
  const supabase = await createClient();
  const { data: workspaces } = await supabase.from("workspaces").select("slug").eq("status", "active");
  redirect(workspaces?.length === 1 ? `/hoy/${workspaces[0].slug}` : "/");
}
