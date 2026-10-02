import { BASIS_TEXT, type MissionBriefContent } from "@/domain/brief/mission-brief";
import { Pill } from "@/components/app/bits";

// El Brief de la misión en pantalla: lo mismo que llega por email.
export function MissionBriefView({ content }: { content: MissionBriefContent }) {
  const { brief, metrics } = content;
  return (
    <div className="space-y-5">
      <p className="text-lg leading-relaxed">{brief.opening}</p>
      {brief.items.length > 0 && (
        <ol className="divide-y rounded-xl border bg-card shadow-xs">
          {brief.items.map((x, i) => (
            <li key={i} className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>{BASIS_TEXT[x.basis]}</Pill>
                {x.moves.map((m) => <Pill key={m}>{m}</Pill>)}
              </div>
              <p className="font-semibold">{x.title}</p>
              <p className="text-sm"><b>Por qué importa:</b> {x.why_us}</p>
              {x.opportunity && <p className="text-sm"><b>Oportunidad:</b> {x.opportunity}</p>}
              {x.action && <p className="text-sm"><b>Qué haría:</b> {x.action}</p>}
              {x.source_url ? (
                <a href={x.source_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-2 hover:underline">{x.source_name || "Fuente"}</a>
              ) : (
                <p className="text-sm text-muted-foreground">{x.source_name || "sin fuente enlazable"}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {brief.watching && <p className="text-sm text-muted-foreground">{brief.watching}</p>}
      <p className="text-xs text-muted-foreground">
        {content.mission_name} · {metrics.collected} notas leídas · {metrics.webSearches} búsquedas · {metrics.shown} mostradas · {metrics.discarded} descartadas · USD {metrics.costUsd.toFixed(2)} (mes: USD {metrics.monthCostUsd.toFixed(2)} de {metrics.monthlyCapUsd}){metrics.mode === "reducido" ? " · modo reducido" : ""}
      </p>
    </div>
  );
}
