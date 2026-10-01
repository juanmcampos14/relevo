"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Mic, Square } from "lucide-react";
import { cn } from "cn";
import { RichText } from "@/components/ai/rich-text";
import { useRecorder } from "@/lib/capture/media";
import type { RefLabel } from "@/server/ai/labels";
import { approveFromPanel, askRelevo, decideFromPanel, transcribeQuestion, undoFromPanel, type PanelCapture, type PanelDraft } from "@/app/w/[slug]/ai/panel-actions";

// Conversar (nueva superficie): RELEVO ya trabajó; la conversación es protagonista. Los objetos
// (una acción hecha, una propuesta, lo que entendió de una captura) aparecen solo cuando aportan.

export type TodayItem = { title: string; why: string };
type Msg = { role: "user" | "assistant"; text: string; labels?: Record<string, RefLabel>; drafts?: PanelDraft[]; captures?: PanelCapture[] };

const CONV_KEY = "relevo-hoy-conversation";
const read = () => { try { return sessionStorage.getItem(CONV_KEY); } catch { return null; } };
const write = (v: string | null) => { try { if (v) sessionStorage.setItem(CONV_KEY, v); else sessionStorage.removeItem(CONV_KEY); } catch { /* sin almacenamiento */ } };

// Estados de "pensando" humanos y tranquilos, según cuánto lleva la respuesta.
const THINKING = [
  { after: 0, text: "Pensando" },
  { after: 4000, text: "Cruzando con lo que ya sabemos" },
  { after: 12000, text: "Armando la respuesta" },
];

export function Conversation({ slug, canEdit, greeting, intro, items, missionLabel }: { slug: string; canEdit: boolean; greeting: string; intro: string; items: TodayItem[]; missionLabel: string | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => (typeof window === "undefined" ? null : read()));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, startBusy] = useTransition();
  const [transcribing, setTranscribing] = useState(false);
  const [thinking, setThinking] = useState(THINKING[0].text);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const here = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);

  // Ubicación solo si el permiso ya está dado (no interrumpe con un pedido de permiso al entrar).
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => {
      if (p.state === "granted") navigator.geolocation.getCurrentPosition((g) => (here.current = { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: g.coords.accuracy }), () => {}, { maximumAge: 120_000, timeout: 10_000 });
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, pending]);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setThinking([...THINKING].reverse().find((s) => Date.now() - started >= s.after)!.text), 500);
    return () => clearInterval(t);
  }, [pending]);

  const ask = useCallback((q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setError(null);
    setText("");
    setThinking(THINKING[0].text);
    setMessages((m) => [...m, { role: "user", text: question }]);
    start(async () => {
      const res = await askRelevo(slug, { conversationId, scope: "", screen: "Conversar (HOY)", text: question, here: here.current });
      if (res.conversationId) { setConversationId(res.conversationId); write(res.conversationId); }
      if (!res.ok) { setError(res.message); return; }
      setMessages((m) => [...m, { role: "assistant", text: res.text, labels: res.labels, drafts: res.drafts, captures: res.captures }]);
      if (res.navigate) router.push(res.navigate);
    });
  }, [conversationId, pending, router, slug]);

  // Voz: tocás, hablás, tocás de nuevo y se envía sola (sin pasar por un formulario).
  const recorder = useRecorder(useCallback(async (audio: { data: ArrayBuffer; mimeType: string }) => {
    setTranscribing(true);
    const fd = new FormData();
    fd.set("audio", new Blob([audio.data], { type: audio.mimeType }));
    const res = await transcribeQuestion(slug, fd);
    setTranscribing(false);
    if (res.text) ask(res.text);
    else setError(res.error ?? "No te pude escuchar bien. Probá de nuevo.");
  }, [ask, slug]));

  const replaceDraft = (d: PanelDraft | null): void => { if (d) setMessages((ms) => ms.map((m) => (m.drafts ? { ...m, drafts: m.drafts.map((x) => (x.id === d.id ? d : x)) } : m))); };
  const replaceCapture = (c: PanelCapture | null): void => { if (c) setMessages((ms) => ms.map((m) => (m.captures ? { ...m, captures: m.captures.map((x) => (x.id === c.id ? c : x)) } : m))); };
  const reset = () => { setMessages([]); setConversationId(null); write(null); setError(null); inputRef.current?.focus(); };

  const listening = recorder.state === "recording";
  const started = messages.length > 0;

  return (
    <div className="relative min-h-dvh bg-[#FAF8F3] text-[#1C1B19] antialiased selection:bg-[#E9DFCB]">
      <header className="sticky top-0 z-10 bg-[#FAF8F3]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <button type="button" onClick={reset} className="text-[15px] font-semibold tracking-[0.18em]" aria-label="RELEVO · empezar de nuevo">RELEVO</button>
          <nav className="flex items-center gap-4 text-[13px] text-[#6F6A60] sm:gap-5 sm:text-[14px]">
            <span className="text-[#1C1B19]">Conversar</span>
            <Link href={`/w/${slug}/explorar`} className="hover:text-[#1C1B19]">Explorar</Link>
            <Link href={`/w/${slug}/oportunidades`} className="hover:text-[#1C1B19]">Oportunidades</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-48">
        {/* RELEVO ya trabajó */}
        <section className={cn("pt-14 transition-opacity duration-500", started && "opacity-60")}>
          <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">{greeting}</h1>
          <p className="mt-3 max-w-[38rem] text-[18px] leading-relaxed text-[#4A463F]">{intro}</p>
          {items.length > 0 && (
            <ol className="mt-8 space-y-1">
              {items.map((it, i) => (
                <li key={it.title} className="group flex items-start gap-4 rounded-2xl px-2 py-4 transition-colors hover:bg-white sm:px-4">
                  <span className="mt-0.5 text-[15px] font-medium text-[#B0A894] tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[17px] leading-snug font-medium">{it.title}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{it.why}</p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => ask(`${it.title}. ¿Cómo lo hacemos?`)}
                    className="-ml-3 mt-2 shrink-0 rounded-full px-3 py-1.5 text-[14px] font-medium text-[#9A4B1F] transition-colors hover:bg-[#F3E9DC] disabled:opacity-40 sm:mt-0.5 sm:ml-0"
                  >
                    Avanzar
                  </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {missionLabel && <p className="mt-6 px-4 text-[13px] text-[#9C968A]">Misión {missionLabel}</p>}
        </section>

        {/* Conversación */}
        {started && (
          <section className="mt-12 space-y-10" aria-live="polite">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-3xl bg-[#EFEBE2] px-5 py-3 text-[16px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                </div>
              ) : (
                <div key={i} className="space-y-4">
                  <div className="text-[17px] leading-[1.7] text-[#1C1B19] [&_a]:text-[#9A4B1F] [&_ul]:space-y-2 [&_strong]:font-semibold">
                    <RichText text={m.text} labels={new Map(Object.entries(m.labels ?? {}))} />
                  </div>
                  {m.drafts?.map((d) => (
                    <ActionObject key={d.id} d={d} canEdit={canEdit} busy={busy}
                      onUndo={() => startBusy(async () => replaceDraft(await undoFromPanel(slug, d.id)))}
                      onDecide={(v) => startBusy(async () => replaceDraft(await decideFromPanel(slug, d.id, v)))} />
                  ))}
                  {m.captures?.map((c) => (
                    <CaptureObject key={c.id} c={c} slug={slug} canEdit={canEdit} busy={busy} onApprove={() => startBusy(async () => replaceCapture((await approveFromPanel(slug, c.id)).card))} />
                  ))}
                </div>
              ),
            )}
            {pending && (
              <div className="flex items-center gap-3 text-[15px] text-[#8A8478]">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#C9773F]/40 [animation-duration:1.8s]" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-[#C9773F]" />
                </span>
                <span className="transition-opacity">{thinking}…</span>
              </div>
            )}
            {error && <p className="text-[15px] text-[#A3402A]">{error}</p>}
          </section>
        )}
        <div ref={endRef} />
      </main>

      {/* Entrada universal */}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[#FAF8F3] via-[#FAF8F3] to-transparent pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 px-5"
          onSubmit={(e) => { e.preventDefault(); ask(text); }}
        >
          <div className="flex min-h-14 flex-1 items-end rounded-[28px] bg-white px-5 py-3 shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.06)]">
            <textarea
              ref={inputRef}
              value={listening ? "" : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }}
              rows={1}
              placeholder={listening ? "Te escucho…" : transcribing ? "Entendiendo lo que dijiste…" : "Contale algo a RELEVO…"}
              aria-label="Contale algo a RELEVO"
              className="max-h-40 min-h-7 flex-1 resize-none bg-transparent text-[17px] leading-7 outline-none placeholder:text-[#A8A295] [field-sizing:content]"
            />
          </div>
          <button
            type="button"
            onClick={() => (listening ? recorder.stop() : recorder.start())}
            disabled={pending || transcribing}
            aria-label={listening ? "Terminar y enviar" : "Hablar con RELEVO"}
            className={cn(
              "relative flex size-14 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40",
              listening ? "bg-[#1C1B19] text-white" : "bg-white text-[#1C1B19] shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.06)] hover:bg-[#F4F1EA]",
            )}
          >
            {listening && <span className="absolute inset-0 animate-ping rounded-full bg-[#1C1B19]/20 [animation-duration:2.2s]" />}
            {listening ? <Square className="size-4 fill-current" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
          {text.trim() && !listening && (
            <button type="submit" disabled={pending} aria-label="Enviar" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#1C1B19] text-white transition-opacity disabled:opacity-40">
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/** Una acción: si RELEVO ya la hizo, se informa (Calendar / Deshacer); si es una propuesta, una decisión. */
function ActionObject({ d, canEdit, busy, onUndo, onDecide }: { d: PanelDraft; canEdit: boolean; busy: boolean; onUndo: () => void; onDecide: (v: "aprobar" | "rechazar") => void }) {
  const summary = d.preview?.summary ?? d.rationale ?? "";
  const undone = d.status === "deshecha" || d.status === "rechazada";
  return (
    <div className="rounded-3xl bg-white px-6 py-5 shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.05)]">
      <p className={cn("text-[16px] leading-relaxed", undone && "text-[#A8A295] line-through")}>{summary}</p>
      {d.applied ? (
        d.status === "ejecutada" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {d.calendarUrl && <a href={d.calendarUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white">Agregar a Calendar</a>}
            {canEdit && <button type="button" disabled={busy} onClick={onUndo} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA] disabled:opacity-40">Deshacer</button>}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-[#9C968A]">{d.status === "deshecha" ? "Deshecho. No quedó nada." : d.error ?? ""}</p>
        )
      ) : d.status === "propuesta" && canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => onDecide("aprobar")} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-40">Hacerlo</button>
          <button type="button" disabled={busy} onClick={() => onDecide("rechazar")} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA] disabled:opacity-40">Ahora no</button>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-[#9C968A]">{d.status === "ejecutada" ? "Hecho." : d.status === "rechazada" ? "Lo dejamos." : d.error ?? ""}</p>
      )}
    </div>
  );
}

/** Lo que RELEVO entendió de algo que contaste: una sola decisión (guardarlo); el detalle, en profundidad. */
function CaptureObject({ c, slug, canEdit, busy, onApprove }: { c: PanelCapture; slug: string; canEdit: boolean; busy: boolean; onApprove: () => void }) {
  const open = c.items.filter((i) => i.status === "propuesta").length;
  return (
    <div className="rounded-3xl bg-white px-6 py-5 shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.05)]">
      <p className="text-[13px] tracking-wide text-[#9C968A] uppercase">Lo que entendí</p>
      <p className="mt-2 text-[16px] leading-relaxed">{c.summary}</p>
      {c.unknowns.length > 0 && <p className="mt-2 text-[14px] text-[#6F6A60]">Todavía no sabemos: {c.unknowns.slice(0, 2).join(" · ")}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canEdit && open > 0 && <button type="button" disabled={busy} onClick={onApprove} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-40">Guardar</button>}
        <Link href={`/w/${slug}/capturas/${c.id}`} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Ver detalle</Link>
      </div>
    </div>
  );
}
