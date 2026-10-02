import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { liveFocus } from "@/server/mission/focus";
import { Conversation, type Interrupt } from "@/components/surface/conversation";
import { knowsLine, markSeen, missionCounts, missionState, surfaceHello, welcomeNotice } from "@/server/surface";
import { after } from "next/server";

export const metadata: Metadata = { title: { absolute: "RELEVO" } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// RELEVO · Ahora. RELEVO ya trabajó: el foco de hoy (vivo: cada acción lo cambia, la persona lo corrige)
// y la conversación como protagonista.
export default async function Hoy({ params, searchParams }: PageProps<"/hoy/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const hello = await surfaceHello(supabase, ctx);
  // Al abrir RELEVO se elige en qué misión trabajar (si hay más de una y todavía no se eligió).
  if (hello.missions.length > 1 && !hello.chosen) redirect(`/hoy/${slug}/misiones`);
  const [live, counts, state] = await Promise.all([
    hello.mission ? liveFocus(supabase, hello.mission.id, new Date(), ctx.user.id).catch(() => null) : null,
    missionCounts(supabase, hello.mission?.id ?? null),
    hello.mission ? missionState(supabase, hello.mission.id) : null,
  ]);
  // Qué es RELEVO y en qué estamos: quien lo abre sin contexto lo entiende en una línea.
  const purpose = state?.purpose ? `${state.purpose.charAt(0).toLowerCase()}${state.purpose.slice(1).replace(/\.$/, "")}` : null;
  const about = hello.mission
    ? { text: `Estoy investigando con ustedes ${purpose ? `la misión ${hello.mission.short}: ${purpose}.` : `la misión ${hello.mission.short}.`} ${knowsLine(counts)}`.trim(), href: `/hoy/${slug}/mision` }
    : null;
  const focus = (live?.now ?? []).map((x) => ({ id: x.id, title: x.title, why: x.why }));
  const intro = live
    ? focus.length
      ? hello.membership.crew > 1 ? "Con lo que sabemos ahora, esto es lo que movería con vos." : "Esto es lo que movería ahora."
      : "Por ahora no hay nada que mover. Contame qué ves, o mostrame algo."
    : "Contame qué necesitás, o mostrame lo que estás viendo.";

  // Interrumpir solo cuando importa: lo que la vigilancia marcó como material (o algo nuevo de relevancia alta)
  // en esta misión, de las últimas 36 horas.
  const { data: alerts } = hello.mission
    ? await supabase.from("brief_signals").select("id, headline, why_it_matters, alerted_at, source_url, publisher").contains("campaign_ids", [hello.mission.id]).eq("relevance", "alta").in("change", ["nuevo", "contradicho"]).gte("created_at", hoursAgo(36)).order("created_at", { ascending: false }).limit(5)
    : { data: [] };
  const alert = (alerts ?? []).find((a) => a.alerted_at) ?? (alerts ?? [])[0];
  const interrupt: Interrupt = alert ? { id: alert.id, title: `${hello.name ? `${hello.name}, apareció` : "Apareció"} algo en ${hello.mission?.short ?? "la misión"} que miraría.`, detail: alert.why_it_matters ? `${alert.headline} ${alert.why_it_matters}` : alert.headline, source: { name: alert.publisher, url: alert.source_url } } : null;

  // Quien entra a una misión que ya empezó: RELEVO lo pone en situación. Si volvés después de un rato: qué
  // aportaron los demás. Después queda marcada la visita.
  const notice = hello.mission ? await welcomeNotice(supabase, ctx, hello) : null;
  // Si volvés después de un rato a una misión compartida, RELEVO te cuenta qué cambió (se arma en segundos, sin demorar Ahora).
  const last = hello.membership.lastSeenAt;
  const catchUpSince = !notice && hello.membership.crew > 1 && last && last < hoursAgo(3) ? last : null;
  if (hello.mission && hello.membership.role) { const id = hello.mission.id; after(() => markSeen(supabase, id, ctx.user.id)); }

  return (
    <Conversation
      notice={notice}
      catchUpSince={catchUpSince}
      slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} mission={hello.mission} canEdit={hello.canEdit} tab="ahora"
      greeting={hello.greeting} about={about} intro={intro} focus={focus} focusVersion={focus.map((x) => x.id).join(",")}
      missionLabel={hello.mission?.label ?? null} interrupt={interrupt}
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null}
    />
  );
}
