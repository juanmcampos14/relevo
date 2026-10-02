import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { surfaceHello } from "@/server/surface";
import { SurfaceTitle } from "@/components/surface/cards";
import { ShareMission, type InviteView, type MemberView } from "@/components/surface/share-mission";

export const metadata: Metadata = { title: { absolute: "RELEVO · Compartir misión" } };
export const dynamic = "force-dynamic";

// Compartir la misión: quiénes están, si pueden trabajar o solo mirar, e invitar por mail.
export default async function Compartir({ params }: PageProps<"/hoy/[slug]/mision/compartir">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  const mission = hello.mission;
  const [{ data: rows }, { data: inv }] = mission
    ? await Promise.all([
        supabase.from("campaign_members").select("user_id, role").eq("campaign_id", mission.id).order("joined_at"),
        supabase.from("mission_invitations").select("id, email, role").eq("campaign_id", mission.id).eq("status", "pending").order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const { data: profiles } = rows?.length ? await supabase.from("profiles").select("user_id, display_name, email").in("user_id", rows.map((r) => r.user_id)) : { data: [] };
  const team = (ctx.workspace.settings as { team?: Record<string, { short?: string; full?: string }> } | null)?.team ?? {};
  const members: MemberView[] = (rows ?? []).map((r) => {
    const p = (profiles ?? []).find((x) => x.user_id === r.user_id);
    return { userId: r.user_id, name: team[r.user_id]?.full ?? p?.display_name ?? p?.email ?? "Alguien del equipo", email: p?.email ?? null, role: r.role as MemberView["role"], me: r.user_id === ctx.user.id };
  });
  const invites: InviteView[] = (inv ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role as InviteView["role"] }));
  return (
    <div className="min-h-dvh bg-[#FAF8F3] text-[#1C1B19] antialiased">
      <header className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
        <Link href={`/hoy/${slug}`} className="text-[15px] font-semibold tracking-[0.18em]">RELEVO</Link>
        <Link href={`/hoy/${slug}/mision`} className="text-[14px] text-[#6F6A60] hover:text-[#1C1B19]">Volver a la misión</Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24">
        <SurfaceTitle title={mission ? `Compartir ${mission.short}` : "Compartir"} intro="Quienes estén acá trabajan sobre la misma misión y la misma memoria. Lo de tus otras misiones no lo ven." />
        <div className="mt-8"><ShareMission slug={slug} members={members} invites={invites} isOwner={hello.membership.role === "owner"} /></div>
      </main>
    </div>
  );
}
