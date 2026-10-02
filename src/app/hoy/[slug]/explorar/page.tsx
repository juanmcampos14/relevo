import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { learnedAlone, missionQuestions, surfaceHello, whileAway } from "@/server/surface";
import { LearnedList, QuestionCard } from "@/components/surface/learned";
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
  const [away, questions, learned] = await Promise.all([
    whileAway(supabase, hello.mission?.short ?? null, hello.mission?.id ?? null),
    missionQuestions(supabase, hello.mission?.id ?? null),
    learnedAlone(supabase, hello.mission?.id ?? null),
  ]);
  const base = `/hoy/${slug}/explorar`;

  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} mission={hello.mission} canEdit={hello.canEdit} tab="explorar" screen="Explorar"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} initialScope={typeof sp.scope === "string" ? sp.scope : null} placeholder="¿Qué querés descubrir?">
      <SurfaceTitle title="¿Qué hay para mirar?" intro="Lo que encontré sin que me lo pidieras y por qué importa, y lo que hay cerca tuyo." />
      {questions.length > 0 && <div className="mt-6 space-y-3">{questions.map((q) => <QuestionCard key={q.id} slug={slug} q={q} canEdit={hello.canEdit} />)}</div>}
      {away.length > 0 && (
        <>
          <SectionLabel>{hello.mission ? `Lo que encontré en ${hello.mission.short}` : "Lo que encontré"}</SectionLabel>
          <ul className="space-y-3">
            {away.map((it) => <LookCard key={it.id} kicker={it.kicker} title={it.title} line={it.line} links={it.links} then={it.then} source={it.source} href={askHref(base, it.ask)} />)}
          </ul>
        </>
      )}
      {learned.length > 0 && (
        <>
          <SectionLabel>Lo que sumé a la memoria</SectionLabel>
          <LearnedList slug={slug} items={learned} canEdit={hello.canEdit} />
        </>
      )}
      <SectionLabel>Cerca tuyo</SectionLabel>
      <Nearby slug={slug} base={base} />
    </Conversation>
  );
}
