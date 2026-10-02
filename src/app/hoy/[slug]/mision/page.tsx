import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { missionCounts, missionState, surfaceHello } from "@/server/surface";
import { Conversation } from "@/components/surface/conversation";
import { SectionLabel, SurfaceTitle, askHref, card } from "@/components/surface/cards";

export const metadata: Metadata = { title: { absolute: "RELEVO · Misión" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const when = (iso: string) => new Intl.DateTimeFormat("es-AR", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

// RELEVO · Misión: qué estamos intentando conseguir y qué sabemos hasta ahora. El valor del CRM sin el CRM:
// frentes, lo que creemos y con qué firmeza, lo que no sabemos, lo descartado, quiénes importan y los
// próximos días. Todo se puede preguntar.
export default async function Mision({ params, searchParams }: PageProps<"/hoy/[slug]/mision">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  const [counts, state] = await Promise.all([missionCounts(supabase, hello.mission?.id ?? null), hello.mission ? missionState(supabase, hello.mission.id) : null]);
  const base = `/hoy/${slug}/mision`;
  const known: [number, string, string][] = [
    [counts.companies, "empresas", "¿Qué empresas conocemos y cuáles importan para la misión?"],
    [counts.people, "personas", "¿A qué personas conocemos y a quiénes nos conviene conocer antes de viajar?"],
    [counts.assets, "activos", "¿Qué activos estamos siguiendo y qué sabemos de cada uno?"],
    [counts.hypotheses, "hipótesis", "¿Qué hipótesis tenemos y cuáles necesitan sí o sí terreno?"],
    [counts.evidence, "datos y evidencias", "¿Qué evidencia tenemos y qué sostiene?"],
    [counts.signals, "señales del Brief", "¿Qué señales encontraste esta semana y qué cambian?"],
  ];

  return (
    <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} mission={hello.mission} canEdit={ctx.canEdit} tab="mision"
      scope={hello.mission ? `campaign:${hello.mission.id}` : undefined} screen="Misión"
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null} placeholder="¿Qué querés saber?">
      <SurfaceTitle title={hello.mission ? `Misión ${hello.mission.short}` : "Misión"} intro={state?.purpose ?? "Todavía no preparé el estado de la misión."} />
      {hello.mission && <p className="mt-2 px-0.5 text-[14px] text-[#9C968A]">{hello.mission.label.replace(`${hello.mission.short} · `, "")}{state ? ` · lo actualicé el ${when(state.computed_at)}` : ""}</p>}

      {state && (
        <div className={`${card} mt-8`}>
          <p className="text-[13px] font-medium tracking-[0.08em] text-[#9C968A] uppercase">Dónde estamos</p>
          <p className="mt-2 text-[17px] leading-relaxed font-medium">{state.stage}</p>
          <p className="mt-3 text-[16px] leading-relaxed text-[#4A463F]">{state.thesis}</p>
        </div>
      )}

      <SectionLabel>Lo que ya conozco</SectionLabel>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {known.filter(([n]) => n > 0).map(([n, label, q]) => (
          <li key={label}>
            <Link href={askHref(base, q)} scroll={false} className="block rounded-2xl bg-white px-4 py-3 shadow-[0_1px_2px_rgba(28,27,25,0.04)] hover:bg-[#FFFDF8]">
              <span className="block text-[24px] leading-tight font-semibold tabular-nums">{n}</span>
              <span className="text-[14px] text-[#6F6A60]">{label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {state && state.fronts.length > 0 && (
        <>
          <SectionLabel>Frentes que estamos siguiendo</SectionLabel>
          <ul className="space-y-3">
            {state.fronts.map((f) => (
              <li key={f.name} className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[17px] font-semibold">{f.name}</p>
                  {f.needs_field && <span className="rounded-full bg-[#F4ECE1] px-2.5 py-1 text-[12px] text-[#9A4B1F]">Se resuelve en terreno</span>}
                </div>
                <p className="mt-2 text-[16px] leading-relaxed">{f.believe}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-[#6F6A60]"><span className="text-[#1C1B19]">Lo que sabemos:</span> {f.know}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]"><span className="text-[#1C1B19]">Falta:</span> {f.missing}</p>
                {f.actors.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{f.actors.map((a) => <li key={a} className="rounded-full bg-[#F4F1EA] px-3 py-1 text-[13px]">{a}</li>)}</ul>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={askHref(base, `¿Qué sabemos de ${f.name.toLowerCase()}?`)} scroll={false} className="rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium">¿Qué sabemos?</Link>
                  {f.refs.find((r) => r.startsWith("finding:")) && <Link href={`/hoy/${slug}/o/${f.refs.find((r) => r.startsWith("finding:"))!.split(":")[1]}`} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Ver en profundidad</Link>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {state && state.unknowns.length > 0 && (
        <>
          <SectionLabel>Lo que todavía no sabemos</SectionLabel>
          <ul className={`${card} space-y-2 text-[16px] leading-relaxed`}>{state.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
        </>
      )}

      {state && (
        <>
          <SectionLabel>Lo que descartamos</SectionLabel>
          <div className={`${card} text-[16px] leading-relaxed`}>
            {state.discarded.length ? <ul className="space-y-2">{state.discarded.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-[#6F6A60]">Nada todavía: es temprano para descartar.</p>}
          </div>
        </>
      )}

      {state && state.changed.length > 0 && (
        <>
          <SectionLabel>Qué cambió esta semana</SectionLabel>
          <ul className={`${card} space-y-3 text-[16px] leading-relaxed`}>{state.changed.map((c) => <li key={c}>{c}</li>)}</ul>
        </>
      )}

      {state && state.next_days.length > 0 && (
        <>
          <SectionLabel>Próximos días</SectionLabel>
          <ol className={`${card} space-y-3`}>
            {state.next_days.map((d) => (
              <li key={d.when} className="grid grid-cols-[6.5rem_1fr] gap-3 text-[15px] leading-relaxed">
                <span className="font-medium tabular-nums">{d.when}</span>
                <span className="text-[#4A463F]">{d.what}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {state && state.questions.length > 0 && (
        <>
          <SectionLabel>Preguntame</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {state.questions.map((q) => <Link key={q} href={askHref(base, q)} scroll={false} className="rounded-full bg-white px-4 py-2 text-[14px] shadow-[0_1px_2px_rgba(28,27,25,0.06)] hover:bg-[#FFFDF8]">{q}</Link>)}
          </div>
        </>
      )}
    </Conversation>
  );
}
