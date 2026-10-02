import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { depthView, surfaceHello } from "@/server/surface";
import { Conversation } from "@/components/surface/conversation";
import { SurfaceTitle, askHref, card } from "@/components/surface/cards";
import Link from "next/link";

export const metadata: Metadata = { title: { absolute: "RELEVO · Oportunidad" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Profundidad: la misma oportunidad, en capas. Arriba la conclusión; abajo, cuando se pide, el porqué, lo que
// no sabemos, quiénes ayudan, lo que encontramos, las empresas y las señales. Mismo lenguaje que el resto.
function Layer({ title, count, open, children }: { title: string; count?: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-t border-[#ECE7DC] py-1 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-1 py-4 text-[17px] font-medium">
        <span>{title}{count !== undefined && <span className="ml-2 text-[15px] font-normal text-[#9C968A]">{count}</span>}</span>
        <span aria-hidden="true" className="text-[#B0A894] transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="px-1 pb-5">{children}</div>
    </details>
  );
}

export default async function Oportunidad({ params, searchParams }: PageProps<"/hoy/[slug]/o/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [hello, o] = await Promise.all([surfaceHello(supabase, ctx), depthView(supabase, id)]);
  if (!o) notFound();
  const base = `/hoy/${slug}/o/${id}`;
  const favor = o.evidence.filter((e) => e.stance === "a favor").length;
  const contra = o.evidence.filter((e) => e.stance === "en contra").length;


  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} mission={hello.mission} canEdit={hello.canEdit} tab="oportunidades" scope={`finding:${id}`} screen="Una oportunidad"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="Preguntame sobre esto…">
      <Link href={`/hoy/${slug}/oportunidades`} className="mt-6 inline-block px-1 text-[14px] text-[#8A8478] hover:text-[#1C1B19]">← Oportunidades</Link>
      <SurfaceTitle title={o.title} intro={o.state} />
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={askHref(base, `Avanzar: ${o.title}`)} scroll={false} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white">Avanzar</Link>
        {["¿Qué cambió?", "Mostrame el mapa", "¿Qué precios encontraste?"].map((q) => (
          <Link key={q} href={askHref(base, q)} scroll={false} className="rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px]">{q}</Link>
        ))}
      </div>

      <div className={`${card} mt-8 py-2`}>
        <Layer title="Por qué lo pensamos" open>
          {o.belief && <p className="text-[16px] leading-relaxed">{o.belief}</p>}
          {o.why && <p className="mt-2 text-[15px] leading-relaxed text-[#6F6A60]">{o.why}</p>}
          {!o.belief && !o.why && <p className="text-[15px] text-[#6F6A60]">{o.summary ?? "Todavía no lo analicé a fondo."}</p>}
        </Layer>
        {o.unknowns.length > 0 && (
          <Layer title="Lo que no sabemos" count={o.unknowns.length}>
            <ul className="space-y-2 text-[15px] leading-relaxed">{o.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
          </Layer>
        )}
        {o.helpers.length > 0 && (
          <Layer title="Quiénes nos pueden ayudar" count={o.helpers.length}>
            <ul className="space-y-4">
              {o.helpers.map((h) => (
                <li key={h.name}>
                  <p className="text-[16px] font-medium">{h.name}</p>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-[#6F6A60]">{h.why}</p>
                  <p className="mt-1 text-[15px] leading-relaxed">«{h.ask}»</p>
                  <Link href={askHref(base, `Avanzar: hablar con ${h.name} sobre esto`)} scroll={false} className="mt-2 inline-block rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium">Avanzar</Link>
                </li>
              ))}
            </ul>
          </Layer>
        )}
        <Layer title="Lo que encontramos" count={o.evidence.length}>
          {o.evidence.length ? (
            <>
              <p className="mb-3 text-[14px] text-[#9C968A]">{favor} a favor · {contra} en contra · {o.evidence.length - favor - contra} de contexto</p>
              <ul className="space-y-3 text-[15px] leading-relaxed">
                {o.evidence.map((e, i) => (
                  <li key={i}>
                    <span className={e.stance === "en contra" ? "text-[#A3402A]" : e.stance === "a favor" ? "text-[#3F6B3A]" : "text-[#9C968A]"}>{e.stance} · </span>
                    {e.text}
                    {e.source && <span className="text-[#9C968A]"> — {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline decoration-[#D9D2C3]">{e.source}</a> : e.source}{e.verified ? " · verificado" : ""}</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-[15px] text-[#6F6A60]">Todavía no hay nada que lo pruebe: es una idea nuestra.</p>}
        </Layer>
        {o.companies.length > 0 && (
          <Layer title="Empresas" count={o.companies.length}>
            <ul className="flex flex-wrap gap-2">{o.companies.map((c) => <li key={c.name} className="rounded-full bg-[#F4F1EA] px-3 py-1.5 text-[14px]">{c.name}<span className="text-[#9C968A]"> · {c.role}</span></li>)}</ul>
          </Layer>
        )}
        {o.signals.length > 0 && (
          <Layer title="Señales" count={o.signals.length}>
            <ul className="space-y-2 text-[15px] leading-relaxed">{o.signals.map((s) => <li key={s.headline}>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-[#D9D2C3]">{s.headline}</a> : s.headline}{s.on && <span className="text-[#9C968A]"> · {s.on}</span>}</li>)}</ul>
          </Layer>
        )}
      </div>
    </Conversation>
  );
}
