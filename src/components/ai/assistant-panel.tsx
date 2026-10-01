"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowUp, ExternalLink, Loader2, MapPin, Mic, Plus, Sparkles, Square, X } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RichText } from "@/components/ai/rich-text";
import { useCapture } from "@/components/app/capture/capture-dock";
import { useRecorder } from "@/lib/capture/media";
import type { RefLabel } from "@/server/ai/labels";
import { approveFromPanel, askRelevo, decideFromPanel, ignoreFromPanel, transcribeQuestion, undoFromPanel, type PanelCapture, type PanelDraft } from "@/app/w/[slug]/ai/panel-actions";

// RELEVO en todas las pantallas: entiende lo que estás mirando, consulta toda la memoria, navega y
// propone cambios que solo se ejecutan con tu aprobación.

export const OPEN_ASSISTANT = "relevo:open-assistant";

const SCOPES: [RegExp, string, string][] = [
  [/\/e\/(company|establishment|asset)\/([0-9a-f-]{36})/, "$1", "ficha"],
  [/\/hallazgos\/([0-9a-f-]{36})/, "finding", "hipótesis"],
  [/\/capturas\/([0-9a-f-]{36})/, "capture", "captura"],
  [/\/explorar\/personas\/([0-9a-f-]{36})/, "contact", "persona"],
  [/\/oportunidades\/o\/([0-9a-f-]{36})/, "opportunity", "oportunidad"],
  [/\/explorar\/c\/([0-9a-f-]{36})/, "campaign", "misión"],
];
const KIND_LABEL: Record<string, string> = { company: "empresa", establishment: "establecimiento", asset: "activo" };

function contextOf(pathname: string, slug: string): { scope: string; screen: string } {
  for (const [re, type, label] of SCOPES) {
    const m = pathname.match(re);
    if (m) {
      const t = type === "$1" ? m[1] : type;
      const id = type === "$1" ? m[2] : m[1];
      return { scope: `${t}:${id}`, screen: `ficha de ${KIND_LABEL[t] ?? label}` };
    }
  }
  const rest = pathname.replace(`/w/${slug}`, "") || "/";
  const screen = rest === "/" ? "HOY" : rest.startsWith("/explorar") ? `Red (${rest.split("/")[2] ?? "misiones"})` : rest.slice(1).split("/")[0];
  return { scope: "", screen };
}

type Msg = { role: "user" | "assistant"; text: string; labels?: Record<string, RefLabel>; drafts?: PanelDraft[]; captures?: PanelCapture[]; web?: { url: string; title: string }[]; note?: string };

const CONV_KEY = "relevo-panel-conversation";
const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ } };

export function AssistantPanel({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const capture = useCapture();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  // La conversación sigue mientras dure la pestaña (no se muestra en el HTML: sin desajuste de hidratación).
  const [conversationId, setConversationId] = useState<string | null>(() => (typeof window === "undefined" ? null : read(CONV_KEY)));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [executing, startExec] = useTransition();
  const [transcribing, setTranscribing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Ubicación del teléfono: "estoy acá", capturas con lugar y análisis territorial. Se puede apagar.
  const [here, setHere] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [useLocation, setUseLocation] = useState(true);
  useEffect(() => {
    if (!open || !useLocation || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => setHere(null),
      { enableHighAccuracy: true, maximumAge: 120_000, timeout: 10_000 },
    );
  }, [open, useLocation]);
  const ctx = contextOf(pathname, slug);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT, onOpen);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  const recorder = useRecorder(useCallback(async (audio: { data: ArrayBuffer; mimeType: string }) => {
    setTranscribing(true);
    const fd = new FormData();
    fd.set("audio", new Blob([audio.data], { type: audio.mimeType }));
    const res = await transcribeQuestion(slug, fd);
    setTranscribing(false);
    if (res.text) setText((t) => (t ? `${t} ${res.text}` : res.text!));
    else setError(res.error ?? "No se pudo transcribir.");
  }, [slug]));

  const send = () => {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    setText("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    start(async () => {
      const res = await askRelevo(slug, { conversationId, scope: ctx.scope, screen: ctx.screen, text: q, here: useLocation ? here : null });
      if (!res.ok) {
        setError(res.message);
        if (res.conversationId) { setConversationId(res.conversationId); write(CONV_KEY, res.conversationId); }
        return;
      }
      setConversationId(res.conversationId);
      write(CONV_KEY, res.conversationId);
      setMessages((m) => [...m, { role: "assistant", text: res.text, labels: res.labels, drafts: res.drafts, captures: res.captures, web: res.webSources, note: res.navigate ? "Te llevé ahí." : undefined }]);
      if (res.navigate) router.push(res.navigate);
    });
  };

  const decide = (draftId: string, verdict: "aprobar" | "rechazar") =>
    startExec(async () => {
      const d = await decideFromPanel(slug, draftId, verdict);
      if (d) setMessages((ms) => ms.map((m) => (m.drafts ? { ...m, drafts: m.drafts.map((x) => (x.id === draftId ? d : x)) } : m)));
      router.refresh();
    });

  const undo = (draftId: string) =>
    startExec(async () => {
      const d = await undoFromPanel(slug, draftId);
      if (d) setMessages((ms) => ms.map((m) => (m.drafts ? { ...m, drafts: m.drafts.map((x) => (x.id === draftId ? d : x)) } : m)));
      router.refresh();
    });

  const replaceCapture = (card: PanelCapture | null) => card && setMessages((ms) => ms.map((m) => (m.captures ? { ...m, captures: m.captures.map((c) => (c.id === card.id ? card : c)) } : m)));
  const approveCapture = (id: string) => startExec(async () => { const r = await approveFromPanel(slug, id); replaceCapture(r.card); router.refresh(); });
  const ignoreCapture = (id: string) => startExec(async () => { const r = await ignoreFromPanel(slug, id); replaceCapture(r.card); });

  const reset = () => { setMessages([]); setConversationId(null); write(CONV_KEY, null); setError(null); };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <SheetTitle className="flex-1 text-sm font-semibold">RELEVO</SheetTitle>
          <button type="button" onClick={reset} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Nueva</button>
          <Link href={`/w/${slug}/ai`} onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Historial</Link>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded-md p-1 hover:bg-muted"><X className="size-4" /></button>
        </header>
        <p className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          Mirando: {ctx.screen}. Consulto toda la memoria; propongo cambios que solo se ejecutan si los aprobás.
        </p>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!messages.length && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Probá, por ejemplo:</p>
              <ul className="space-y-1">
                {(ctx.scope ? ["¿Qué nos falta saber de esto?", "¿Qué lo contradice?", "¿Por qué todavía no es una oportunidad?"] : ["¿Qué cambió en los últimos siete días?", "Mostrame las hipótesis con economía pero sin comprador", "¿Qué necesita Fran decidir?"]).map((ex) => (
                  <li key={ex}><button type="button" onClick={() => setText(ex)} className="text-left text-primary hover:underline">{ex}</button></li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">{m.text}</div>
            ) : (
              <div key={i} className="space-y-3">
                <div className="text-sm"><RichText text={m.text} labels={new Map(Object.entries(m.labels ?? {}))} /></div>
                {m.captures?.map((c) => <CaptureCard key={c.id} c={c} canEdit={canEdit} busy={pending || executing} onApprove={approveCapture} onIgnore={ignoreCapture} />)}
                {m.web && m.web.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Fuentes web consultadas ({m.web.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.web.map((w) => <li key={w.url}><a href={w.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="size-3" aria-hidden="true" />{w.title}</a></li>)}
                    </ul>
                  </details>
                )}
                {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
                {m.drafts?.map((d) => <DraftCard key={d.id} d={d} canEdit={canEdit} busy={pending || executing} onDecide={decide} onUndo={undo} />)}
              </div>
            ),
          )}
          {pending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Consultando la memoria…</p>}
          {executing && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Ejecutando lo que aprobaste…</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder={recorder.state === "recording" ? "Grabando… tocá para terminar" : transcribing ? "Transcribiendo…" : "Preguntale a RELEVO"}
            aria-label="Pregunta"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (recorder.state === "recording" ? recorder.stop() : recorder.start())}
              disabled={transcribing}
              aria-label={recorder.state === "recording" ? "Terminar de dictar" : "Dictar la pregunta"}
              className={cn("flex size-10 items-center justify-center rounded-full border", recorder.state === "recording" && "border-destructive bg-destructive/10 text-destructive")}
            >
              {recorder.state === "recording" ? <Square className="size-4 fill-current" /> : transcribing ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
            </button>
            {canEdit && capture && (
              <button type="button" onClick={() => { setOpen(false); capture.open(); }} className="inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm">
                <Plus className="size-4" aria-hidden="true" />Capturar
              </button>
            )}
            <button
              type="button"
              onClick={() => setUseLocation((v) => !v)}
              title={useLocation ? (here ? `Usando tu ubicación (±${Math.round(here.accuracy)} m)` : "Buscando tu ubicación…") : "Ubicación apagada"}
              aria-label={useLocation ? "Apagar ubicación" : "Usar mi ubicación"}
              className={cn("flex size-10 items-center justify-center rounded-full border", useLocation && here ? "border-primary/40 text-primary" : "text-muted-foreground")}
            >
              <MapPin className="size-4" />
            </button>
            <span className="flex-1" />
            <button type="submit" disabled={!text.trim() || pending} aria-label="Enviar" className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
              <ArrowUp className="size-4" />
            </button>
          </div>
          {recorder.error && <p className="text-xs text-destructive">{recorder.error}</p>}
        </form>
      </SheetContent>
    </Sheet>
  );
}

const ACTION_LABEL: Record<string, string> = {
  contact_event: "Contacto registrado",
  create_task: "Crear tarea", prepare_validation: "Agendar validación", link_evidence: "Vincular evidencia", update_next_action: "Actualizar próxima acción",
  request_help: "Pedir ayuda", draft_finding: "Registrar hipótesis (queda pendiente de revisión)", request_decision: "Pedir una decisión",
  record_web_evidence: "Guardar fuente web como evidencia",
};

function DraftCard({ d, canEdit, busy, onDecide, onUndo }: { d: PanelDraft; canEdit: boolean; busy: boolean; onDecide: (id: string, v: "aprobar" | "rechazar") => void; onUndo: (id: string) => void }) {
  const p = d.preview;
  // Lo que RELEVO ya aplicó solo: se informa, con Calendar si es una reunión, y se puede deshacer.
  if (d.applied)
    return (
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p className="font-medium">{d.status === "deshecha" ? <s className="text-muted-foreground">{p?.summary ?? d.rationale}</s> : p?.summary ?? d.rationale}</p>
        {d.status === "ejecutada" ? (
          <div className="flex flex-wrap items-center gap-2">
            {d.calendarUrl && <a href={d.calendarUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground">Agregar a Calendar</a>}
            {canEdit && <button type="button" disabled={busy} onClick={() => onUndo(d.id)} className="inline-flex h-9 items-center rounded-md border px-3 text-sm disabled:opacity-50">Deshacer</button>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{d.status === "deshecha" ? "Deshecho: no quedó nada." : d.error ?? d.status}</p>
        )}
      </div>
    );
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Propuesta · {ACTION_LABEL[d.action] ?? d.action}</p>
      <p className="font-medium">{p?.summary ?? d.rationale}</p>
      {p && (
        <>
          <ul className="space-y-1 text-xs">
            {p.changes.map((c, i) => (
              <li key={i}><span className="text-muted-foreground">{c.entity} · {c.field}:</span> {c.before ? <><s className="text-muted-foreground">{c.before}</s> → </> : null}<span className="font-medium">{c.after}</span></li>
            ))}
          </ul>
          <p className="text-xs"><span className="text-muted-foreground">Por qué:</span> {p.why}</p>
          {p.evidence_refs.length > 0 && <p className="text-xs text-muted-foreground">Evidencia citada: {p.evidence_refs.length}</p>}
          {p.duplicate_risk.map((r) => <p key={r} className="flex gap-1 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{r}</p>)}
          <p className="text-xs"><span className="text-muted-foreground">Resultado esperado:</span> {p.expected}</p>
        </>
      )}
      {d.status === "propuesta" ? (
        canEdit ? (
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busy} onClick={() => onDecide(d.id, "aprobar")} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">Aprobar y ejecutar</button>
            <button type="button" disabled={busy} onClick={() => onDecide(d.id, "rechazar")} className="inline-flex h-9 items-center rounded-md border px-3 text-sm disabled:opacity-50">Rechazar</button>
          </div>
        ) : <p className="text-xs text-muted-foreground">Tu rol es de solo lectura.</p>
      ) : (
        <p className={cn("text-xs", d.status === "error" ? "text-destructive" : "text-muted-foreground")}>
          {d.status === "ejecutada" ? "Aprobada y ejecutada." : d.status === "rechazada" ? "Rechazada: no se cambió nada." : d.error ?? d.status}
          {d.resultHref && <> <Link href={d.resultHref} className="text-primary hover:underline">Ver resultado</Link></>}
        </p>
      )}
    </div>
  );
}

/** Botón para abrir RELEVO (barra superior en escritorio). */
export function AssistantButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT))} className="hidden h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted md:inline-flex">
      <Sparkles className="size-4 text-primary" aria-hidden="true" />
      Preguntar a RELEVO
    </button>
  );
}

function CaptureCard({ c, canEdit, busy, onApprove, onIgnore }: { c: PanelCapture; canEdit: boolean; busy: boolean; onApprove: (id: string) => void; onIgnore: (id: string) => void }) {
  const done = c.pending === 0;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Guardé tu nota · RELEVO entendió esto</p>
      {c.summary && <p>{c.summary}</p>}
      {c.items.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {c.items.map((it, i) => (
            <li key={i} className={cn(it.status === "rechazada" && "text-muted-foreground line-through")}>
              <span className="text-muted-foreground">{it.kind}:</span> {it.text}
              {it.exception && it.status === "propuesta" && <span className="block text-amber-800 dark:text-amber-300">{it.exception}</span>}
            </li>
          ))}
        </ul>
      )}
      {c.unknowns.length > 0 && <p className="text-xs"><span className="text-muted-foreground">Todavía no sabemos:</span> {c.unknowns.join(" · ")}</p>}
      {!done && canEdit ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy || c.pending === c.exceptions} onClick={() => onApprove(c.id)} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">Aprobar{c.exceptions ? " lo demás" : ""}</button>
          <Link href={c.href} className="inline-flex h-9 items-center rounded-md border px-3 text-sm">Revisar detalle</Link>
          <button type="button" disabled={busy} onClick={() => onIgnore(c.id)} className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">Ignorar</button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{done ? "Decidido: lo aprobado quedó guardado y relacionado." : "Tu rol es de solo lectura."} <Link href={c.href} className="text-primary hover:underline">Ver captura</Link></p>
      )}
      {!done && c.exceptions > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">{c.exceptions} {c.exceptions === 1 ? "cosa requiere" : "cosas requieren"} tu decisión en el detalle.</p>}
    </div>
  );
}
