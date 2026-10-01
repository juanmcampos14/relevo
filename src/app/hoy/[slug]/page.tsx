import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { missionBrief } from "@/server/ai/mission";
import { Conversation, type Interrupt, type TodayItem } from "@/components/surface/conversation";

export const metadata: Metadata = { title: { absolute: "RELEVO" } };
export const dynamic = "force-dynamic";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// Nueva superficie (beta): Conversar. RELEVO ya trabajó; la conversación es protagonista y los objetos
// aparecen solo cuando aportan. Usa el mismo Brain y el mismo motor que el resto de RELEVO.
export default async function Hoy({ params }: PageProps<"/hoy/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [brief, { data: me }] = await Promise.all([
    missionBrief(supabase, null).catch(() => null),
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
  ]);
  const team = (ctx.workspace.settings as { team?: Record<string, { short?: string }> } | null)?.team ?? {};
  const name = team[ctx.user.id]?.short ?? me?.display_name?.trim().split(/\s+/)[0] ?? null;
  const hour = Number(new Intl.DateTimeFormat("es-AR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()));
  const greeting = `${hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches"}${name ? `, ${name}` : ""}.`;

  type Item = { title: string; why: string; done?: boolean };
  const synthesis = brief?.prepared?.synthesis as { opening?: string; today?: Item[]; this_week?: Item[] } | null | undefined;
  const pending = [...(synthesis?.today ?? []), ...(synthesis?.this_week ?? [])].filter((x) => !x.done).slice(0, 3);
  const items: TodayItem[] = pending.map((x) => ({ title: x.title, why: x.why }));
  const d = brief?.mission.days_to_start ?? null;
  const missionName = brief?.mission.name.split("—")[0].trim() ?? null;
  const mission = missionName ? `${missionName}${d !== null ? (d > 1 ? ` · faltan ${d} días` : d === 1 ? " · mañana" : d === 0 ? " · hoy" : " · en curso") : ""}` : null;
  const intro = synthesis
    ? `Estuve trabajando mientras no estabas.${items.length ? " Esto es lo que movería hoy." : " Por ahora no hay nada urgente."}`
    : "Contame qué necesitás, o mostrame lo que estás viendo.";

  // Interrumpir solo cuando importa: algo nuevo y de relevancia alta en la misión, de las últimas 36 horas.
  const { data: alert } = await supabase.from("brief_signals").select("id, headline").eq("relevance", "alta").eq("change", "nuevo").gte("created_at", hoursAgo(36)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const interrupt: Interrupt = alert ? { id: alert.id, title: `${name ? `${name}, apareció` : "Apareció"} algo en ${missionName ?? "la misión"} que miraría.`, detail: alert.headline } : null;

  return <Conversation slug={slug} workspaceId={ctx.workspace.id} missionId={brief?.mission.ref.split(":")[1] ?? null} canEdit={ctx.canEdit} greeting={greeting} intro={intro} items={items} missionLabel={mission} interrupt={interrupt} />;
}
