"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Camera, Check, Copy, MapPin, Mic, Square, X } from "lucide-react";
import { cn } from "cn";
import { RichText } from "@/components/ai/rich-text";
import { compressPhoto, useRecorder } from "@/lib/capture/media";
import { createClient } from "@/lib/supabase/client";
import { CAPTURE_BUCKET, syncOne, type CaptureApi } from "@/domain/capture";
import type { RefLabel } from "@/server/ai/labels";
import { askRelevo, decideFromPanel, placeName, transcribeQuestion, undoFromPanel, type PanelDraft } from "@/app/w/[slug]/ai/panel-actions";

// Conversar (Surface): la calle es la oficina, el teléfono el sensor, la voz la interfaz. RELEVO ya trabajó;
// la conversación es protagonista y la Surface no explica el sistema: mueve la oportunidad.

export type TodayItem = { title: string; why: string };
export type Interrupt = { id: string; title: string; detail: string | null } | null;
type Msg = { role: "user" | "assistant"; text: string; photo?: string; labels?: Record<string, RefLabel>; drafts?: PanelDraft[] };
type Here = { lat: number; lng: number; accuracy: number };

const CONV_KEY = "relevo-hoy-conversation";
const DISMISSED_KEY = "relevo-hoy-dismissed";
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  local: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setLocal: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

const THINKING = [
  { after: 0, text: "Pensando" },
  { after: 4000, text: "Cruzando con lo que ya sabemos" },
  { after: 12000, text: "Armando la respuesta" },
];

/** Acciones sugeridas y mensaje listo que deja RELEVO al final: se muestran como botón y como tarjeta para copiar. */
export function parseReply(text: string): { body: string; actions: string[]; messages: string[] } {
  const actions = [...text.matchAll(/\[\[acci[oó]n:\s*([^\]]+)\]\]/gi)].map((m) => m[1].trim()).slice(0, 2);
  const messages = [...text.matchAll(/\[\[mensaje\]\]([\s\S]*?)\[\[\/mensaje\]\]/gi)].map((m) => m[1].trim()).filter(Boolean);
  const body = text.replace(/\[\[acci[oó]n:[^\]]+\]\]/gi, "").replace(/\[\[mensaje\]\][\s\S]*?\[\[\/mensaje\]\]/gi, "").trim();
  return { body, actions, messages };
}

/** Texto para decir en voz alta: sin citas, marcas ni formato. */
const speakable = (text: string) =>
  parseReply(text).body.replace(/\[\[[a-z]+:[0-9a-f-]{36}\]\]/g, "").replace(/\[referencia no verificada\]/g, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();

function useVoice() {
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => {
      const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
      voice.current = vs.find((v) => /es-AR/i.test(v.lang)) ?? vs.find((v) => /es-(419|US|MX)/i.test(v.lang)) ?? vs[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", pick);
  }, []);
  return {
    /** iOS solo deja hablar si antes hubo un gesto: se "destraba" al tocar el micrófono. */
    unlock: () => { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch { /* sin voz */ } },
    stop: () => { try { speechSynthesis.cancel(); } catch { /* sin voz */ } },
    say: (text: string) => {
      try {
        if (!text) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = voice.current?.lang ?? "es-AR";
        if (voice.current) u.voice = voice.current;
        u.rate = 1.03;
        speechSynthesis.speak(u);
      } catch { /* sin voz */ }
    },
  };
}

function captureApi(): CaptureApi {
  const supabase = createClient();
  return {
    upload: async (path, data, contentType) => {
      const { error } = await supabase.storage.from(CAPTURE_BUCKET).upload(path, data, { contentType, upsert: false });
      return { error: error as { message?: string; statusCode?: string } | null };
    },
    createCapture: async (payload) => {
      const { data, error } = await supabase.rpc("create_capture", { p: payload });
      return { error, id: (data as string | null) ?? null };
    },
  };
}

/** ¿Está cerca de la zona de la misión (Añelo)? Lejos, lo que captura queda en su lugar y no en la misión. */
const nearMission = (h: Here | null) => !!h && Math.hypot(h.lat + 38.3542, h.lng + 68.7877) < 1.4;

export function Conversation(props: {
  slug: string; workspaceId: string; missionId: string | null; canEdit: boolean;
  greeting: string; intro: string; items: TodayItem[]; missionLabel: string | null; interrupt: Interrupt;
}) {
  const { slug, workspaceId, missionId, canEdit, greeting, intro, items, missionLabel } = props;
  const router = useRouter();
  const voice = useVoice();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => (typeof window === "undefined" ? null : store.get(CONV_KEY)));
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ data: ArrayBuffer; mimeType: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, startBusy] = useTransition();
  const [transcribing, setTranscribing] = useState(false);
  const [thinking, setThinking] = useState(THINKING[0].text);
  const [here, setHere] = useState<Here | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [interrupt, setInterrupt] = useState<Interrupt>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const spoke = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // El aviso de la misión aparece una sola vez (hasta que se mira o se deja para después).
  useEffect(() => {
    const it = props.interrupt;
    if (it && store.local(DISMISSED_KEY) !== it.id) queueMicrotask(() => setInterrupt(it));
  }, [props.interrupt]);

  const locate = useCallback((ask: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const go = () => navigator.geolocation.getCurrentPosition(
      async (g) => {
        const h = { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: g.coords.accuracy };
        setHere(h);
        setPlace(await placeName(h.lat, h.lng));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 120_000, timeout: 10_000 },
    );
    if (ask) go();
    else navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => p.state === "granted" && go()).catch(() => {});
  }, []);
  useEffect(() => { locate(false); }, [locate]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, pending]);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setThinking([...THINKING].reverse().find((s) => Date.now() - started >= s.after)!.text), 500);
    return () => clearInterval(t);
  }, [pending]);

  const ask = useCallback((q: string, opts: { viaVoice?: boolean } = {}) => {
    const question = q.trim() || (photo ? "¿Qué ves acá? ¿Hay algo?" : "");
    if (!question || pending) return;
    spoke.current = !!opts.viaVoice;
    const shot = photo;
    setError(null);
    setText("");
    setPhoto(null);
    setThinking(THINKING[0].text);
    setMessages((m) => [...m, { role: "user", text: question, photo: shot?.url }]);
    start(async () => {
      let captureId: string | null = null;
      if (shot) {
        // La foto queda guardada como captura con su ubicación (en la misión solo si está en su zona).
        const res = await syncOne({
          clientId: crypto.randomUUID(), workspaceId, body: question, capturedAt: new Date().toISOString(),
          location: here ? { lat: here.lat, lng: here.lng, accuracy: here.accuracy } : null,
          aiConsent: true, campaignId: nearMission(here) ? missionId : null, state: "pendiente", attempts: 0,
          media: [{ id: crypto.randomUUID(), kind: "photo", mimeType: shot.mimeType, data: shot.data }],
        }, captureApi());
        if (!res.ok) { setError(res.message); return; }
        captureId = res.id;
      }
      const res = await askRelevo(slug, { conversationId, scope: "", screen: "Conversar (calle)", text: question, here, place, captureId });
      if (res.conversationId) { setConversationId(res.conversationId); store.set(CONV_KEY, res.conversationId); }
      if (!res.ok) { setError(res.message); return; }
      setMessages((m) => [...m, { role: "assistant", text: res.text, labels: res.labels, drafts: res.drafts }]);
      if (spoke.current) voice.say(speakable(res.text));
      if (res.navigate) router.push(res.navigate);
    });
  }, [conversationId, here, missionId, pending, photo, place, router, slug, voice, workspaceId]);

  // Voz: tocás, hablás, tocás de nuevo y se envía; la respuesta vuelve hablada.
  const recorder = useRecorder(useCallback(async (audio: { data: ArrayBuffer; mimeType: string }) => {
    setTranscribing(true);
    const fd = new FormData();
    fd.set("audio", new Blob([audio.data], { type: audio.mimeType }));
    const res = await transcribeQuestion(slug, fd);
    setTranscribing(false);
    if (res.text) ask(res.text, { viaVoice: true });
    else setError(res.error ?? "No te pude escuchar bien. Probá de nuevo.");
  }, [ask, slug]));

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    locate(true);
    const p = await compressPhoto(file);
    setPhoto({ ...p, url: URL.createObjectURL(new Blob([p.data], { type: p.mimeType })) });
  };

  const replaceDraft = (d: PanelDraft | null): void => { if (d) setMessages((ms) => ms.map((m) => (m.drafts ? { ...m, drafts: m.drafts.map((x) => (x.id === d.id ? d : x)) } : m))); };
  const reset = () => { voice.stop(); setMessages([]); setConversationId(null); store.set(CONV_KEY, null); setError(null); };
  const dismiss = () => { if (interrupt) store.setLocal(DISMISSED_KEY, interrupt.id); setInterrupt(null); };

  const listening = recorder.state === "recording";
  const started = messages.length > 0;
  const shadow = "shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.06)]";

  return (
    <div className="relative min-h-dvh bg-[#FAF8F3] text-[#1C1B19] antialiased selection:bg-[#E9DFCB]">
      <header className="sticky top-0 z-10 bg-[#FAF8F3]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={reset} className="text-[15px] font-semibold tracking-[0.18em]" aria-label="RELEVO · empezar de nuevo">RELEVO</button>
            <button type="button" onClick={() => locate(true)} className="flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] text-[#6F6A60] hover:bg-[#F1EDE4]" aria-label="Actualizar dónde estoy">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{place ?? (here ? "Ubicado" : "Usar mi ubicación")}</span>
            </button>
          </div>
          <nav className="hidden items-center gap-5 text-[14px] text-[#6F6A60] sm:flex">
            <span className="text-[#1C1B19]">Conversar</span>
            <Link href={`/w/${slug}/explorar`} className="hover:text-[#1C1B19]">Explorar</Link>
            <Link href={`/w/${slug}/oportunidades`} className="hover:text-[#1C1B19]">Oportunidades</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-56">
        {interrupt && (
          <section className={cn("mt-4 rounded-3xl bg-white px-6 py-5", shadow)} aria-live="polite">
            <p className="text-[16px] font-medium">{interrupt.title}</p>
            {interrupt.detail && <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{interrupt.detail}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { dismiss(); ask(`Contame de esto: ${interrupt.detail ?? interrupt.title}`); }} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white">Ver ahora</button>
              <button type="button" onClick={dismiss} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Después</button>
            </div>
          </section>
        )}

        {/* RELEVO ya trabajó */}
        <section className={cn("pt-10 transition-opacity duration-500 sm:pt-14", started && "opacity-60")}>
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">{greeting}</h1>
          <p className="mt-3 max-w-[38rem] text-[18px] leading-relaxed text-[#4A463F]">{intro}</p>
          {items.length > 0 && (
            <ol className="mt-6 space-y-1 sm:mt-8">
              {items.map((it, i) => (
                <li key={it.title} className={cn("flex items-start gap-4 rounded-2xl px-2 py-4 transition-colors hover:bg-white sm:px-4", i > 0 && "hidden sm:flex")}>
                  <span className="mt-0.5 hidden text-[15px] font-medium text-[#B0A894] tabular-nums sm:inline">{i + 1}</span>
                  <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] leading-snug font-medium">{it.title}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{it.why}</p>
                    </div>
                    <button type="button" disabled={pending} onClick={() => ask(`Avanzar: ${it.title}`)} className="mt-3 shrink-0 rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white transition-opacity disabled:opacity-40 sm:mt-0">
                      Avanzar
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {missionLabel && <p className="mt-4 px-2 text-[13px] text-[#9C968A] sm:px-4">Misión {missionLabel}</p>}
        </section>

        {/* Conversación */}
        {started && (
          <section className="mt-10 space-y-9" aria-live="polite">
            {messages.map((m, i) => {
              if (m.role === "user")
                return (
                  <div key={i} className="flex flex-col items-end gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto local recién sacada (blob) */}
                    {m.photo && <img src={m.photo} alt="Foto enviada" className="max-h-56 rounded-3xl object-cover" />}
                    <p className="max-w-[85%] rounded-3xl bg-[#EFEBE2] px-5 py-3 text-[16px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  </div>
                );
              const r = parseReply(m.text);
              return (
                <div key={i} className="space-y-4">
                  <div className="text-[17px] leading-[1.65] [&_a]:text-[#9A4B1F] [&_strong]:font-semibold [&_ul]:space-y-2">
                    <RichText text={r.body} labels={new Map(Object.entries(m.labels ?? {}))} />
                  </div>
                  {r.messages.map((msg, k) => {
                    const key = `${i}-${k}`;
                    return (
                      <div key={key} className={cn("rounded-3xl bg-white px-6 py-5", shadow)}>
                        <p className="text-[16px] leading-relaxed whitespace-pre-wrap">{msg}</p>
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(msg); setCopied(key); setTimeout(() => setCopied(null), 1800); }} className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">
                          {copied === key ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                          {copied === key ? "Copiado" : "Copiar mensaje"}
                        </button>
                      </div>
                    );
                  })}
                  {m.drafts?.map((d) => (
                    <ActionObject key={d.id} d={d} canEdit={canEdit} busy={busy}
                      onUndo={() => startBusy(async () => replaceDraft(await undoFromPanel(slug, d.id)))}
                      onDecide={(v) => startBusy(async () => replaceDraft(await decideFromPanel(slug, d.id, v)))} />
                  ))}
                  {r.actions.length > 0 && i === messages.length - 1 && (
                    <div className="flex flex-wrap gap-2">
                      {r.actions.map((a, k) => (
                        <button key={a} type="button" disabled={pending} onClick={() => ask(`Avanzar: ${a}`)} className={cn("rounded-full px-4 py-2 text-[14px] font-medium transition-opacity disabled:opacity-40", k === 0 ? "bg-[#1C1B19] text-white" : "text-[#6F6A60] hover:bg-[#F4F1EA]")}>
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {pending && (
              <div className="flex items-center gap-3 text-[15px] text-[#8A8478]">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#C9773F]/40 [animation-duration:1.8s]" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-[#C9773F]" />
                </span>
                <span>{thinking}…</span>
              </div>
            )}
            {error && <p className="text-[15px] text-[#A3402A]">{error}</p>}
          </section>
        )}
        <div ref={endRef} />
      </main>

      {/* Entrada universal: escribir, hablar, mostrar */}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[#FAF8F3] via-[#FAF8F3] to-transparent pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form className="mx-auto max-w-3xl px-4 sm:px-5" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          {photo && (
            <div className="mb-2 flex items-center gap-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto local recién sacada (blob) */}
                <img src={photo.url} alt="Foto para enviar" className="size-16 rounded-2xl object-cover" />
                <button type="button" onClick={() => setPhoto(null)} aria-label="Quitar foto" className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-[#1C1B19] text-white"><X className="size-3.5" /></button>
              </div>
              <p className="text-[13px] text-[#8A8478]">Decime qué querés saber, o mandala así.</p>
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className={cn("flex min-h-14 flex-1 items-end gap-1 rounded-[28px] bg-white py-2 pr-2 pl-5", shadow)}>
              <textarea
                value={listening ? "" : text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }}
                rows={1}
                placeholder={listening ? "Te escucho…" : transcribing ? "Entendiendo lo que dijiste…" : "Preguntame o mostrame algo…"}
                aria-label="Preguntale o mostrale algo a RELEVO"
                className="mb-1.5 max-h-40 min-h-7 flex-1 resize-none bg-transparent text-[16px] leading-7 sm:text-[17px] outline-none placeholder:text-[#A8A295] [field-sizing:content]"
              />
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} aria-label="Sacar o adjuntar una foto" className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#4A463F] hover:bg-[#F4F1EA] disabled:opacity-40">
                <Camera className="size-5" aria-hidden="true" />
              </button>
              {(text.trim() || photo) && !listening && (
                <button type="submit" disabled={pending} aria-label="Enviar" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#1C1B19] text-white disabled:opacity-40">
                  <ArrowUp className="size-5" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { if (listening) recorder.stop(); else { voice.unlock(); locate(true); recorder.start(); } }}
              disabled={pending || transcribing}
              aria-label={listening ? "Terminar y enviar" : "Hablar con RELEVO"}
              className={cn("relative flex size-14 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40", listening ? "bg-[#1C1B19] text-white" : cn("bg-white text-[#1C1B19] hover:bg-[#F4F1EA]", shadow))}
            >
              {listening && <span className="absolute inset-0 animate-ping rounded-full bg-[#1C1B19]/20 [animation-duration:2.2s]" />}
              {listening ? <Square className="size-4 fill-current" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
            </button>
          </div>
          <nav className="mt-3 flex justify-center gap-6 text-[13px] text-[#8A8478] sm:hidden">
            <span className="text-[#1C1B19]">Conversar</span>
            <Link href={`/w/${slug}/explorar`}>Explorar</Link>
            <Link href={`/w/${slug}/oportunidades`}>Oportunidades</Link>
          </nav>
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
