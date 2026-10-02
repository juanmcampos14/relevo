import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { liveFocus } from "@/server/mission/focus";
import { Conversation, type Interrupt } from "@/components/surface/conversation";
import { knowsLine, missionCounts, missionState, surfaceHello } from "@/server/surface";

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
  const [live, counts, state] = await Promise.all([
    hello.mission ? liveFocus(supabase, hello.mission.id).catch(() => null) : null,
    missionCounts(supabase),
    hello.mission ? missionState(supabase, hello.mission.id) : null,
  ]);
  // Qué es RELEVO y en qué estamos: quien lo abre sin contexto lo entiende en una línea.
  const purpose = state?.purpose ? `${state.purpose.charAt(0).toLowerCase()}${state.purpose.slice(1).replace(/\.$/, "")}` : null;
  const about = hello.mission
    ? { text: `Estoy investigando con ustedes ${purpose ? `la misión ${hello.mission.short}: ${purpose}.` : `la misión ${hello.mission.short}.`} ${knowsLine(counts)}`.trim(), href: `/hoy/${slug}/mision` }
    : null;
  const focus = (live?.now ?? []).map((x) => ({ id: x.id, title: x.title, why: x.why }));
  const intro = live
    ? focus.length ? "Esto es lo que movería ahora." : "Por ahora no hay nada que mover. Contame qué ves, o mostrame algo."
    : "Contame qué necesitás, o mostrame lo que estás viendo.";

  // Interrumpir solo cuando importa: algo nuevo y de relevancia alta en la misión, de las últimas 36 horas.
  const { data: alert } = await supabase.from("brief_signals").select("id, headline").eq("relevance", "alta").eq("change", "nuevo").gte("created_at", hoursAgo(36)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const interrupt: Interrupt = alert ? { id: alert.id, title: `${hello.name ? `${hello.name}, apareció` : "Apareció"} algo en ${hello.mission?.short ?? "la misión"} que miraría.`, detail: alert.headline } : null;

  return (
    <Conversation
      slug={slug} workspaceId={ctx.workspace.id} missionId={hello.mission?.id ?? null} canEdit={ctx.canEdit} tab="ahora"
      greeting={hello.greeting} about={about} intro={intro} focus={focus} focusVersion={focus.map((x) => x.id).join(",")}
      missionLabel={hello.mission?.label ?? null} interrupt={interrupt}
      initialAsk={typeof sp.q === "string" ? sp.q.slice(0, 500) : null}
    />
  );
}
