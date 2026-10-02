import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { surfaceHello, whileAway } from "@/server/surface";
import { Conversation } from "@/components/surface/conversation";
import { LookCard, SectionLabel, SurfaceTitle, askHref } from "@/components/surface/cards";
import { Nearby } from "@/components/surface/nearby";

export const metadata: Metadata = { title: { absolute: "RELEVO · Explorar" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// RELEVO · Explorar: RELEVO ayuda a descubrir. Qué hay cerca, qué apareció mientras no estabas, qué cambió en
// la misión aunque la persona esté en otro lado.
export default async function Explorar({ params, searchParams }: PageProps<"/hoy/[slug]/explorar">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  const away = await whileAway(supabase, hello.mission?.short ?? null);
  const base = `/hoy/${slug}/explorar`;

  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} canEdit={ctx.canEdit} tab="explorar" screen="Explorar"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="¿Qué querés descubrir?">
      <SurfaceTitle title="¿Qué hay para mirar?" intro="Lo que hay cerca tuyo y lo que apareció mientras no estabas." />
      <SectionLabel>Cerca tuyo</SectionLabel>
      <Nearby slug={slug} base={base} />
      {away.length > 0 && (
        <>
          <SectionLabel>{hello.mission ? `En ${hello.mission.short}, mientras no estabas` : "Mientras no estabas"}</SectionLabel>
          <ul className="space-y-3">
            {away.map((it) => <LookCard key={it.id} kicker={it.kicker} title={it.title} line={it.line} href={askHref(base, it.ask)} />)}
          </ul>
        </>
      )}
    </Conversation>
  );
}
