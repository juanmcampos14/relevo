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

function Row({ o, base, slug, close }: { o: OpportunityView; base: string; slug: string; close?: boolean }) {
  return (
    <li className={card}>
      <p className="text-[17px] leading-snug font-medium">{o.title}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">
        {close && o.missing ? `Le falta: ${o.missing.charAt(0).toLowerCase()}${o.missing.slice(1)}` : o.state}
        {o.next ? ` Próximo: ${o.next.charAt(0).toLowerCase()}${o.next.slice(1)}.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={askHref(base, `Avanzar: ${o.title}${o.next ? ` (${o.next})` : ""}`)} scroll={false} className={close ? "rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium" : "rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white"}>Avanzar</Link>
        {o.href && <Link href={`/hoy/${slug}/${o.href}`} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">¿Por qué?</Link>}
      </div>
    </li>
  );
}

// RELEVO · Oportunidades: lo que ya tiene señal suficiente para justificar que hagamos algo. Hipótesis no es
// oportunidad: si todavía no hay ninguna, RELEVO lo dice; que no haya también es información.
export default async function Oportunidades({ params, searchParams }: PageProps<"/hoy/[slug]/oportunidades">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  const { strong, closest } = await opportunitiesView(supabase, hello.mission?.id ?? null);
  const base = `/hoy/${slug}/oportunidades`;

  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} mission={hello.mission} canEdit={ctx.canEdit} tab="oportunidades" screen="Oportunidades"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="¿Qué querés mover?">
      {strong.length ? (
        <>
          <SurfaceTitle title="Lo que vale la pena mover" intro="Tiene evidencia suficiente para justificar que hagamos algo." />
          <ul className="mt-6 space-y-3">{strong.map((o) => <Row key={o.id} o={o} base={base} slug={slug} />)}</ul>
        </>
      ) : (
        <SurfaceTitle title="Todavía no veo una oportunidad suficientemente fuerte" intro="Tenemos hipótesis, pero ninguna con evidencia que justifique mover algo. Eso también es información: la misión de campo es para conseguirla." />
      )}
      {closest.length > 0 && (
        <>
          <SectionLabel>{strong.length ? "Lo que viene atrás" : "Lo más cerca"}</SectionLabel>
          <ul className="space-y-3">{closest.map((o) => <Row key={o.id} o={o} base={base} slug={slug} close />)}</ul>
        </>
      )}
      <p className="mt-8 px-1 text-[15px] text-[#6F6A60]">
        Lo que creemos y estamos validando está en la <Link href={`/hoy/${slug}/mision`} className="text-[#9A4B1F] underline decoration-[#E3C9B4] underline-offset-4">Misión</Link>.
      </p>
    </Conversation>
  );
}
