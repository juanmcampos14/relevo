import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { opportunitiesView, surfaceHello, type OpportunityView } from "@/server/surface";
import { Conversation } from "@/components/surface/conversation";
import { SectionLabel, SurfaceTitle, askHref, card } from "@/components/surface/cards";

export const metadata: Metadata = { title: { absolute: "RELEVO · Oportunidades" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOP = 5;

// RELEVO · Oportunidades: qué merece que hagamos algo y cuál es el próximo movimiento. El porqué, al entrar.
function Row({ o, big, base, slug, place }: { o: OpportunityView; big: boolean; base: string; slug: string; place: string | null }) {
  return (
    <li className={big ? card : "rounded-2xl px-2 py-3 sm:px-4"}>
      <p className={big ? "text-[17px] leading-snug font-medium" : "text-[16px] leading-snug"}>{o.title}{place && big ? <span className="text-[#9C968A]"> — {place}</span> : null}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{o.state}{o.next && big ? ` Próximo: ${o.next.charAt(0).toLowerCase()}${o.next.slice(1)}.` : ""}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={askHref(base, `Avanzar: ${o.title}${o.next ? ` (${o.next})` : ""}`)} scroll={false} className={big ? "rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white" : "rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium"}>Avanzar</Link>
        <Link href={`/hoy/${slug}/o/${o.id}`} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">¿Por qué?</Link>
      </div>
    </li>
  );
}

export default async function Oportunidades({ params, searchParams }: PageProps<"/hoy/[slug]/oportunidades">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [hello, all] = await Promise.all([surfaceHello(supabase, ctx), opportunitiesView(supabase)]);
  const base = `/hoy/${slug}/oportunidades`;
  const top = all.slice(0, TOP);
  const rest = all.slice(TOP);
  const place = hello.mission?.short ?? null;


  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} canEdit={ctx.canEdit} tab="oportunidades" screen="Oportunidades"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="¿Qué querés mover?">
      <SurfaceTitle title="Lo que vale la pena perseguir" intro={top.length ? "Ordenado por lo que más sabemos y lo que más se puede mover hoy." : "Todavía no hay nada que valga la pena perseguir. Contame qué viste."} />
      {top.length > 0 && <ul className="mt-6 space-y-3">{top.map((o) => <Row key={o.id} o={o} big base={base} slug={slug} place={place} />)}</ul>}
      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none px-1 py-3 text-[15px] text-[#6F6A60] hover:text-[#1C1B19]">Y {rest.length} más que estamos mirando</summary>
          <SectionLabel>Todavía sin señal fuerte</SectionLabel>
          <ul className="space-y-1">{rest.map((o) => <Row key={o.id} o={o} big={false} base={base} slug={slug} place={place} />)}</ul>
        </details>
      )}
    </Conversation>
  );
}
