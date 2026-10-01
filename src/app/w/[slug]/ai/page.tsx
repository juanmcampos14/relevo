import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { labelRefs } from "@/server/ai/labels";
import { profileNames } from "@/server/findings";
import { EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { Composer } from "@/components/ai/composer";
import { RichText } from "@/components/ai/rich-text";
import { decideDraft, sendMessage, undoDraft } from "./actions";

export const metadata: Metadata = { title: "RELEVO AI" };

const actionLabel: Record<string, string> = {
  contact_event: "Contacto registrado",
  create_task: "Crear tarea",
  prepare_validation: "Agendar validación",
  link_evidence: "Vincular evidencia",
  update_next_action: "Actualizar próxima acción",
  request_help: "Pedir ayuda",
  draft_finding: "Registrar hipótesis (queda pendiente de revisión)",
  request_decision: "Pedir decisión",
  record_web_evidence: "Guardar fuente web como evidencia",
};
const draftStatus: Record<string, string> = { propuesta: "Propuesta", aprobada: "Aprobada", rechazada: "Rechazada", ejecutada: "Ejecutada", error: "Error", deshecha: "Deshecha" };

export default async function AiPage({ params, searchParams }: PageProps<"/w/[slug]/ai">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const convId = typeof sp.c === "string" ? sp.c : null;
  const scopeParam = typeof sp.scope === "string" && /^[a-z]+:[0-9a-f-]{36}$/.test(sp.scope) ? sp.scope : "";

  const [{ data: conversations }, { data: campaigns }] = await Promise.all([
    supabase.from("ai_conversations").select("id, title, user_id, updated_at, scope").order("updated_at", { ascending: false }).limit(40),
    supabase.from("campaigns").select("id, name").order("created_at", { ascending: false }),
  ]);
  const conv = convId ? conversations?.find((c) => c.id === convId) ?? null : null;
  const isMine = !conv || conv.user_id === ctx.user.id;

  const [{ data: messages }, { data: drafts }, { data: runs }] = conv
    ? await Promise.all([
        supabase.from("ai_messages").select("id, role, text, citations, run_id, created_at").eq("conversation_id", conv.id).order("created_at"),
        supabase.from("ai_action_drafts").select("id, message_id, action, payload, rationale, status, result_ref, error, preview, before_state, after_state, decided_at").eq("conversation_id", conv.id).order("created_at"),
        supabase.from("ai_runs").select("id, cost_usd, tool_calls, status, error, created_at").eq("conversation_id", conv.id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const labels = await labelRefs(supabase, slug, (messages ?? []).flatMap((m) => m.citations as string[]));
  const names = await profileNames(supabase, (conversations ?? []).map((c) => c.user_id));
  const runById = new Map((runs ?? []).map((r) => [r.id, r]));
  const failedRuns = (runs ?? []).filter((r) => r.status === "error");
  const scopeLabelOf = scopeParam ? (await labelRefs(supabase, slug, [scopeParam])).get(scopeParam)?.label : null;
  const scopes = [
    { value: "", label: "Todo el workspace" },
    ...(scopeParam && scopeLabelOf ? [{ value: scopeParam, label: `Este registro: ${scopeLabelOf}` }] : []),
    ...(campaigns ?? []).map((c) => ({ value: `campaign:${c.id}`, label: `Campaña: ${c.name}` })),
  ];
  const configured = !!process.env.ANTHROPIC_API_KEY;
  const disabledReason = !configured
    ? "RELEVO AI no está configurado en este entorno."
    : !isMine
      ? "Esta conversación es de otra persona: podés leerla, no continuarla."
      : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-3">
        <Link href={`/w/${slug}/ai`} className="inline-flex h-9 w-full items-center justify-center rounded-md border text-sm hover:bg-muted">
          + Nueva conversación
        </Link>
        <ul className="space-y-1">
          {(conversations ?? []).map((c) => (
            <li key={c.id}>
              <Link
                href={`/w/${slug}/ai?c=${c.id}`}
                className={`block rounded-md px-3 py-2 text-sm hover:bg-muted ${c.id === conv?.id ? "bg-muted font-medium" : ""}`}
              >
                <span className="line-clamp-2">{c.title}</span>
                <span className="text-xs text-muted-foreground">
                  {c.user_id === ctx.user.id ? "vos" : names.get(c.user_id) ?? "—"} · {formatDate(c.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 space-y-4">
        <PageHeader
          title="RELEVO AI"
          subtitle="Responde con lo que sabe RELEVO y cita cada dato; si hace falta, busca afuera y lo dice. Lo que le dictás de tus contactos y reuniones lo registra solo y se puede deshacer; el resto lo propone para que lo apruebes."
        />
        {!configured && (
          <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            Falta configurar el proveedor de IA en este entorno. El resto de la app funciona igual.
          </p>
        )}

        {conv ? (
          <div className="space-y-4">
            {(messages ?? []).map((m) => {
              const run = m.run_id ? runById.get(m.run_id) : null;
              const myDrafts = (drafts ?? []).filter((d) => d.message_id === m.id);
              return m.role === "user" ? (
                <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-primary/10 p-3 text-sm whitespace-pre-wrap">{m.text}</div>
              ) : (
                <div key={m.id} className="max-w-[95%] space-y-3 rounded-lg border p-4">
                  <RichText text={m.text} labels={labels} />
                  {myDrafts.map((d) => {
                    const p = d.payload as Record<string, string | undefined>;
                    // Acción aplicada por RELEVO (auditada): se informa y se puede deshacer.
                    if (d.action === "contact_event") {
                      const cal = (d.after_state as { calendar_url?: string | null } | null)?.calendar_url;
                      const summary = (d.preview as { summary?: string } | null)?.summary ?? d.rationale;
                      return (
                        <div key={d.id} className="space-y-2 rounded-md border p-3">
                          <p className="text-sm">{d.status === "deshecha" ? <s className="text-muted-foreground">{summary}</s> : summary}</p>
                          {d.status === "ejecutada" ? (
                            <div className="flex flex-wrap gap-2">
                              {cal && <a href={cal} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">Agregar a Calendar</a>}
                              {ctx.canEdit && (
                                <form action={undoDraft.bind(null, slug, d.id)}>
                                  <button className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">Deshacer</button>
                                </form>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">{d.status === "deshecha" ? "Deshecho: no quedó nada." : d.error ?? d.status}</p>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div key={d.id} className="space-y-2 rounded-md border border-dashed p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill>Borrador IA</Pill>
                          <span className="text-sm font-medium">{actionLabel[d.action]}</span>
                          <Pill className={d.status === "propuesta" ? "border-amber-400 text-amber-800 dark:text-amber-300" : ""}>{draftStatus[d.status]}</Pill>
                        </div>
                        <p className="text-sm">{(d.preview as { summary?: string } | null)?.summary ?? p.title ?? p.statement}</p>
                        {((d.preview as { changes?: { entity: string; field: string; before: string | null; after: string }[] } | null)?.changes ?? []).map((c, i) => (
                          <p key={i} className="text-xs"><span className="text-muted-foreground">{c.entity} · {c.field}:</span> {c.before ? <><s>{c.before}</s> → </> : null}{c.after}</p>
                        ))}
                        {((d.preview as { duplicate_risk?: string[] } | null)?.duplicate_risk ?? []).map((r) => <p key={r} className="text-xs text-amber-800 dark:text-amber-300">{r}</p>)}
                        {d.rationale && <p className="text-xs text-muted-foreground">Motivo: {d.rationale}</p>}
                        {d.status === "ejecutada" && d.decided_at && <p className="text-xs text-muted-foreground">Ejecutada {formatDate(d.decided_at, true)}{d.before_state ? " · se guardó el estado anterior" : ""}</p>}
                        {d.error && <p className="text-xs text-destructive">{d.error}</p>}
                        {d.status === "propuesta" && ctx.canEdit && (
                          <div className="flex gap-2">
                            <form action={decideDraft.bind(null, slug, d.id, "aprobar")}>
                              <button className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">Aprobar y ejecutar</button>
                            </form>
                            <form action={decideDraft.bind(null, slug, d.id, "rechazar")}>
                              <button className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">Rechazar</button>
                            </form>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {run && (
                    <p className="text-[11px] text-muted-foreground">
                      {run.tool_calls} consultas a la base · costo aprox. USD {Number(run.cost_usd).toFixed(3)}
                    </p>
                  )}
                </div>
              );
            })}
            {sp.error && failedRuns.length > 0 && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">La última consulta falló: {failedRuns[failedRuns.length - 1].error}</p>
            )}
          </div>
        ) : (
          <EmptyState title="Nueva conversación">
            Ejemplos: “¿Qué aprendimos de las visitas de esta semana?”, “¿Qué candidatas tienen solo hallazgos sin verificar?”, “Armame preguntas para la próxima visita a [registro]”.
          </EmptyState>
        )}

        <div className="sticky bottom-20 md:bottom-4">
          <Composer
            action={sendMessage.bind(null, slug, conv?.id ?? null)}
            scopes={conv ? [] : scopes}
            defaultScope={conv ? ((conv.scope as { ref?: string })?.ref ?? "") : scopeParam}
            disabledReason={disabledReason}
          />
        </div>
      </section>
    </div>
  );
}
