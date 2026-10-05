import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { surfaceHello } from "@/server/surface";
import { Conversation } from "@/components/surface/conversation";
import { MissionPicker } from "@/components/surface/mission-picker";

export const metadata: Metadata = { title: { absolute: "RELEVO · Misiones" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// RELEVO es el motor; la misión es el contexto. Se elige al entrar o se cambia desde el nombre de la misión.
export default async function Misiones({ params, searchParams }: PageProps<"/hoy/[slug]/misiones">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  // Las que creó esta persona: solo esas se pueden eliminar.
  const { data: mine } = await supabase.from("campaign_members").select("campaign_id").eq("user_id", ctx.user.id).eq("role", "owner");
  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={null} canEdit={ctx.canEdit} tab="ahora" screen="Elegir misión"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="Decime en qué misión trabajar…">
      <MissionPicker slug={slug} missions={hello.missions} current={hello.chosen ? hello.mission?.id ?? null : null} owned={(mine ?? []).map((m) => m.campaign_id)} />
    </Conversation>
  );
}
