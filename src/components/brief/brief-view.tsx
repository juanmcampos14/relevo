import Link from "next/link";
import { BASIS_LABEL, CHANGE_LABEL, SECTION_LABEL, SIGNAL_TYPE_LABEL, type BriefContent, type BriefSignalView } from "@/domain/brief/contract";
import { metricsLine, modeLabel } from "@/domain/brief/render";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Pill, Section } from "@/components/app/bits";
import { actionToTask, decideCandidate, setStoryStatus } from "@/app/w/[slug]/brief/actions";

// El brief en pantalla: el mismo objeto que el email, con las decisiones a mano (candidatos, tareas, historias).

const CHANGE_TONE: Record<string, string> = {
  nuevo: "border-primary/40 text-primary",
  actualizado: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  confirmado: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  contradicho: "border-destructive/50 text-destructive",
  descartado: "line-through",
};

function SignalCard({ s, base }: { s: BriefSignalView; base: string }) {
  return (
    <li className="space-y-1.5 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill className={CHANGE_TONE[s.change]}>{CHANGE_LABEL[s.change]}</Pill>
        <Pill>{BASIS_LABEL[s.basis]}</Pill>
        <Pill>{SIGNAL_TYPE_LABEL[s.signal_type]}</Pill>
        {s.relevance === "alta" && <Pill className="border-amber-500/40 text-amber-700 dark:text-amber-300">relevancia alta</Pill>}
      </div>
      <p className="font-medium">{s.headline}</p>
      <p className="text-xs text-muted-foreground">{[s.happened_on, s.geography, s.vertical, s.subsector, [...s.companies, ...s.people].join(", ")].filter(Boolean).join(" · ")}</p>
      <p className="text-sm">{s.summary}</p>
      {s.why_it_matters && <p className="text-sm"><span className="font-medium">Por qué importa:</span> {s.why_it_matters}</p>}
      {s.reading && <p className="text-sm"><span className="font-medium">Lectura RELEVO</span> <span className="text-muted-foreground italic">(inferencia)</span>: {s.reading}</p>}
      {s.verify && <p className="text-sm"><span className="font-medium">Qué falta comprobar:</span> {s.verify}</p>}
      {s.talk_to && <p className="text-sm"><span className="font-medium">Con quién hablar:</span> {s.talk_to}</p>}
      {s.ask && <p className="text-sm"><span className="font-medium">Qué preguntar (AOG / campo):</span> {s.ask}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {s.source_url ? (
          <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.publisher || s.source_title || "fuente"}</a>
        ) : (
          <span className="text-muted-foreground">sin fuente enlazable</span>
        )}
        {s.story_title && <span className="text-muted-foreground">Historia: {s.story_title}</span>}
        {s.same_as && <span className="text-muted-foreground">Ya conocido{s.same_as.on ? ` desde el ${s.same_as.on}` : ""}: suma evidencia</span>}
        {s.company_ids.map((id, i) => (
          <Link key={id} href={`${base}/e/company/${id}`} className="text-primary hover:underline">empresa en RELEVO{s.company_ids.length > 1 ? ` ${i + 1}` : ""}</Link>
        ))}
        {s.finding_ids.map((id) => (
          <Link key={id} href={`${base}/hallazgos/${id}`} className="text-primary hover:underline">hipótesis relacionada</Link>
        ))}
      </div>
    </li>
  );
}

const Empty = ({ children = "Sin novedades." }: { children?: string }) => <p className="text-sm text-muted-foreground">{children}</p>;

export function BriefView({ slug, briefId, content, canEdit }: { slug: string; briefId: string; content: BriefContent; canEdit: boolean }) {
  const base = `/w/${slug}`;
  const c = content;
  return (
    <div className="space-y-8">
      {c.metrics && (
        <p className="text-xs text-muted-foreground">
          <span className={c.metrics.mode === "reducido" ? "font-semibold text-amber-700 dark:text-amber-300" : "font-semibold text-primary"}>{modeLabel(c.metrics.mode)}</span> · {metricsLine(c.metrics)}
        </p>
      )}
      {c.quiet_day_note && <p className="rounded-lg border bg-muted/40 p-3 text-sm">{c.quiet_day_note}</p>}

      <Section title="01 · Lo que importa hoy">
        {c.headline_points.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{c.headline_points.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
        ) : <Empty />}
      </Section>

      {(["general", "anelo", "empresas", "activos"] as const).map((sec, i) => {
        const ss = c.signals.filter((s) => s.section === sec);
        return (
          <Section key={sec} title={`${String(i + 2).padStart(2, "0")} · ${SECTION_LABEL[sec]}`}>
            {ss.length ? <ul className="divide-y rounded-xl border bg-card shadow-xs">{ss.map((s) => <SignalCard key={s.id} s={s} base={base} />)}</ul> : <Empty />}
          </Section>
        );
      })}

      <Section title="06 · Radar de verticales">
        {c.vertical_radar.length ? (
          <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
            {c.vertical_radar.map((r) => (
              <li key={r.vertical} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.vertical}</span>
                  <Pill>{r.signals} señal{r.signals === 1 ? "" : "es"}</Pill>
                  {r.contradictions > 0 && <Pill className="border-destructive/50 text-destructive">{r.contradictions} contradicción(es)</Pill>}
                  {r.hypotheses > 0 && <Pill>toca {r.hypotheses} hipótesis</Pill>}
                </div>
                {r.companies.length > 0 && <p className="text-xs text-muted-foreground">{r.companies.join(", ")}</p>}
                {r.questions.map((q, i) => <p key={i} className="text-xs">Pregunta abierta: {q}</p>)}
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Section>

      <Section title="07 · Conexiones que RELEVO ve">
        {c.connections.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{c.connections.map((x, i) => <li key={i}>{x.text} <span className="text-muted-foreground italic">(inferencia)</span></li>)}</ul>
        ) : <Empty>Hoy no hay conexiones defendibles.</Empty>}
      </Section>

      <Section title="08 · Qué cambió desde ayer">
        <ul className="space-y-1 text-sm">
          {Object.entries(c.changes).filter(([, v]) => v.length).map(([k, v]) => (
            <li key={k}><span className="font-medium">{CHANGE_LABEL[k as keyof typeof CHANGE_LABEL]}</span>: {v.map((x) => x.headline).join(" · ")}</li>
          ))}
        </ul>
      </Section>

      <Section title="09 · Qué haría RELEVO hoy">
        {c.actions.length ? (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {c.actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{a.title}</p><p className="text-muted-foreground">{a.why}</p></div>
                {canEdit && (
                  <ActionForm action={actionToTask.bind(null, slug, briefId, i)} className="space-y-0">
                    <SubmitButton variant="outline" className="h-8">Crear tarea</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Section>

      <Section title="10 · Candidatos para el CRM">
        <p className="text-xs text-muted-foreground">Detectado ≠ validado. Aprobar una empresa o persona la incorpora sin verificar, con la nota como fuente.</p>
        {c.candidates.length ? (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {c.candidates.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p><Pill>{x.kind}</Pill> <span className="font-medium">{x.name}</span></p>
                  <p className="text-muted-foreground">{x.detail}</p>
                  {x.source_url && <a href={x.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">fuente</a>}
                </div>
                {canEdit && (
                  <ActionForm action={decideCandidate.bind(null, slug, x.id)} className="flex gap-2 space-y-0">
                    <SubmitButton name="decision" value="aprobar" variant="outline" className="h-8">Aprobar</SubmitButton>
                    <SubmitButton name="decision" value="descartar" variant="outline" className="h-8">Descartar</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty>Sin candidatos nuevos.</Empty>}
      </Section>

      <Section title="11 · Preguntas para campo">
        {c.field_questions.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{c.field_questions.map((q, i) => <li key={i}>{q.question} <span className="text-muted-foreground">({q.vertical})</span></li>)}</ul>
        ) : <Empty />}
      </Section>

      <Section title="12 · Watchlist">
        {c.watchlist.length ? (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {c.watchlist.map((w, i) => (
              <li key={w.story_id ?? i} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{w.title}</p><p className="text-muted-foreground">{w.why}{w.since ? ` · desde ${w.since}` : ""}</p></div>
                {canEdit && w.story_id && (
                  <ActionForm action={setStoryStatus.bind(null, slug, w.story_id, "cerrada")} className="space-y-0">
                    <SubmitButton variant="outline" className="h-8">Dejar de seguir</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty>Nada en observación todavía.</Empty>}
      </Section>

      <Section title="Fuentes">
        <ul className="space-y-1 text-sm">
          {c.sources.map((s) => (
            <li key={s.url} className="truncate"><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.title}</a>{s.publisher ? <span className="text-muted-foreground"> · {s.publisher}</span> : null}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
