"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Camera, Check, ChevronDown, Copy, MapPin, Mic, Square, X } from "lucide-react";
import { cn } from "cn";
import { RichText } from "@/components/ai/rich-text";
import { compressPhoto, useRecorder } from "@/lib/capture/media";
import { createClient } from "@/lib/supabase/client";
import { CAPTURE_BUCKET, syncOne, type CaptureApi } from "@/domain/capture";
import type { RefLabel } from "@/server/ai/labels";
import { askRelevo, decideFromPanel, placeName, transcribeQuestion, undoFromPanel, type PanelDraft, type PanelReply } from "@/app/w/[slug]/ai/panel-actions";
import { advance, catchUpSince, correctFocus, markSent } from "@/app/hoy/[slug]/actions";
import { parseReply, speakable, type ReadyMessage } from "./reply";
import { hostOf } from "@/domain/links";
import { FocusList, type FocusChange, type FocusView } from "./focus-list";
import { SourceLink } from "./cards";

// RELEVO (Surface): un solo producto. Ahora, Explorar, Oportunidades y Misión son cuatro formas de mirar el
// mismo Brain; conversar no es una sección: es cómo se opera todo, desde cualquier lugar, con la misma
// entrada (escribir, hablar, mostrar). La calle es la oficina, el teléfono el
// sensor, la voz la interfaz. La Surface no explica el sistema: mueve la oportunidad.

export type Interrupt = { id: string; title: string; detail: string | null; source?: { name: string | null; url: string | null } } | null;
export type SurfaceTab = "ahora" | "explorar" | "oportunidades" | "mision";
type Sent = { line: string; draft: PanelDraft | null } | "enviando" | { error: string };
type Msg = { role: "user" | "assistant"; text: string; photo?: string; labels?: Record<string, RefLabel>; drafts?: PanelDraft[]; note?: boolean; sources?: { url: string; title: string }[] };
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
  { after: 12000, text: "Buscando lo que falta" },
  { after: 24000, text: "Armando el próximo paso" },
];

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
        u.rate = 1.05;
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

const shadow = "shadow-[0_1px_2px_rgba(28,27,25,0.04),0_8px_28px_rgba(28,27,25,0.06)]";

export function Conversation(props: {
  slug: string; workspaceId: string; missionId: string | null; canEdit: boolean;
  tab: SurfaceTab;
  /** Lo que se está mirando (una oportunidad, por ejemplo): las preguntas son sobre eso. */
  scope?: string;
  screen?: string;
  greeting?: string | null; intro?: string | null;
  /** Qué es RELEVO y en qué estamos, en una línea (quien lo abre por primera vez entiende sin explicación). */
  about?: { text: string; href: string } | null;
  focus?: FocusView[]; focusVersion?: string;
  missionLabel?: string | null; interrupt?: Interrupt;
  /** Pregunta que llega desde otra pantalla ("Contame" en Explorar): se hace sola al entrar. */
  initialAsk?: string | null;
  /** El registro del que trata esa pregunta (p. ej. el activo de una tarjeta de Explorar). */
  initialScope?: string | null;
  placeholder?: string;
  /** Un aviso de equipo arriba: bienvenida a la misión o "desde tu última visita". */
  notice?: { title: string; lines: string[]; actions: { label: string; ask?: string; focus?: boolean }[] } | null;
  /** Volvió después de un rato a una misión compartida: RELEVO cuenta qué cambió desde entonces. */
  catchUpSince?: string | null;
  /** La misión de trabajo (arriba, discreta, con su menú). */
  mission?: { short: string } | null;
  children?: ReactNode;
}) {
  const { slug, workspaceId, missionId, canEdit, tab, greeting, intro, missionLabel } = props;
  const scope = props.scope ?? "";
  const screen = props.screen ?? "Conversar (calle)";
  const router = useRouter();
  const voice = useVoice();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => (typeof window === "undefined" || scope ? null : store.get(CONV_KEY)));
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
  const [sent, setSent] = useState<Record<string, Sent>>({});
  const spoke = useRef(false);
  const asked = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => { if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, pending]);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setThinking([...THINKING].reverse().find((s) => Date.now() - started >= s.after)!.text), 500);
    return () => clearInterval(t);
  }, [pending]);

  /** Muestra la respuesta, la dice si se habló, y si cambió el presente (algo se hizo) refresca el home. */
  const receive = useCallback((res: PanelReply) => {
    if (res.conversationId && !scope) store.set(CONV_KEY, res.conversationId);
    if (res.conversationId) setConversationId(res.conversationId);
    if (!res.ok) { setError(res.message); return; }
    setMessages((m) => [...m, { role: "assistant", text: res.text, labels: res.labels, drafts: res.drafts.filter((d) => !(d.action === "record_web_evidence" && d.status === "ejecutada")), sources: res.webSources }]);
    if (spoke.current) voice.say(speakable(res.text));
    if (res.homeChanged) router.refresh();
    if (res.navigate) router.push(res.navigate);
  }, [router, scope, voice]);

  const ask = useCallback((q: string, opts: { viaVoice?: boolean; scope?: string | null } = {}) => {
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
          aiConsent: true, campaignId: missionId, state: "pendiente", attempts: 0,
          media: [{ id: crypto.randomUUID(), kind: "photo", mimeType: shot.mimeType, data: shot.data }],
        }, captureApi());
        if (!res.ok) { setError(res.message); return; }
        captureId = res.id;
      }
      receive(await askRelevo(slug, { conversationId, scope: opts.scope && /^[a-z]+:[0-9a-f-]{36}$/.test(opts.scope) ? opts.scope : scope, screen, text: question, here, place, captureId }));
    });
  }, [conversationId, here, missionId, pending, photo, place, receive, scope, screen, slug, workspaceId]);

  // Una pregunta que llega desde otra pantalla se hace sola, una vez.
  useEffect(() => {
    if (!props.initialAsk || asked.current) return;
    asked.current = true;
    const q = props.initialAsk;
    const sc = props.initialScope ?? null;
    queueMicrotask(() => ask(q, { scope: sc }));
    router.replace(window.location.pathname, { scroll: false });
  }, [ask, props.initialAsk, props.initialScope, router]);

  /** Avanzar una prioridad: si RELEVO ya la preparó, aparece al instante. */
  const advanceItem = (it: FocusView) => {
    if (pending) return;
    spoke.current = false;
    setError(null);
    setThinking(THINKING[0].text);
    setMessages((m) => [...m, { role: "user", text: `Avanzar: ${it.title}` }]);
    start(async () => receive(await advance(slug, { focusId: it.id, conversationId, here, place })));
  };

  const changeFocus = (c: FocusChange) => {
    startBusy(async () => { await correctFocus(slug, c); router.refresh(); });
  };

  const confirmSent = (key: string, msg: ReadyMessage) => {
    if (!msg.to) return;
    setSent((s) => ({ ...s, [key]: "enviando" }));
    startBusy(async () => {
      const r = await markSent(slug, { ref: msg.to!, conversationId });
      setSent((s) => ({ ...s, [key]: r.ok ? { line: r.line, draft: r.draft } : { error: r.message } }));
      if (r.ok) { if (spoke.current) voice.say(r.line); router.refresh(); }
    });
  };

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
  const reset = () => { voice.stop(); setMessages([]); setConversationId(null); if (!scope) store.set(CONV_KEY, null); setError(null); setSent({}); };
  const dismiss = () => { if (interrupt) store.setLocal(DISMISSED_KEY, interrupt.id); setInterrupt(null); };

  const listening = recorder.state === "recording";
  const started = messages.length > 0;
  const tabs: { key: SurfaceTab; label: string; href: string }[] = [
    { key: "ahora", label: "Ahora", href: `/hoy/${slug}` },
    { key: "explorar", label: "Explorar", href: `/hoy/${slug}/explorar` },
    { key: "oportunidades", label: "Oportunidades", href: `/hoy/${slug}/oportunidades` },
  ];

  return (
    <div className="relative min-h-dvh bg-[#FAF8F3] text-[#1C1B19] antialiased selection:bg-[#E9DFCB]">
      <header className="sticky top-0 z-30 bg-[#FAF8F3]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2">
            {tab === "ahora" && !scope
              ? <button type="button" onClick={reset} className="shrink-0 text-[15px] font-semibold tracking-[0.18em]" aria-label="RELEVO · empezar de nuevo">RELEVO</button>
              : <Link href={`/hoy/${slug}`} className="shrink-0 text-[15px] font-semibold tracking-[0.18em]">RELEVO</Link>}
            {props.mission && <MissionMenu slug={slug} current={props.mission} />}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <nav className="hidden items-center gap-5 text-[14px] text-[#6F6A60] sm:flex">
              {tabs.map((t) => t.key === tab && !scope
                ? <span key={t.key} className="text-[#1C1B19]">{t.label}</span>
                : <Link key={t.key} href={t.href} className="hover:text-[#1C1B19]">{t.label}</Link>)}
            </nav>
            <button type="button" onClick={() => locate(true)} title={place ?? "Usar mi ubicación"} className="flex max-w-[9rem] items-center gap-1 rounded-full px-2 py-1 text-[13px] text-[#8A8478] hover:bg-[#F1EDE4]" aria-label={place ? `Estás en ${place}. Actualizar` : "Usar mi ubicación"}>
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{place ? place.split(",")[0] : here ? "Ubicado" : "Ubicación"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-56">
        {props.catchUpSince && !started && <CatchUpCard slug={slug} since={props.catchUpSince} onMore={() => ask("¿Qué pasó en la misión desde mi última visita y qué cambia para mí?")} />}
        {props.notice && !started && (
          <section className={cn("mt-4 rounded-3xl bg-white px-6 py-5", shadow)} aria-live="polite">
            <p className="text-[17px] font-semibold">{props.notice.title}</p>
            <div className="mt-2 space-y-1.5 text-[15px] leading-relaxed text-[#4A463F]">{props.notice.lines.map((l) => <p key={l}>{l}</p>)}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {props.notice.actions.map((a, k) => (
                <button key={a.label} type="button" onClick={() => (a.ask ? ask(a.ask) : textRef.current?.focus())} className={cn("rounded-full px-4 py-2 text-[14px] font-medium", k === 0 ? "bg-[#1C1B19] text-white" : "bg-[#EFEBE2]")}>{a.label}</button>
              ))}
            </div>
          </section>
        )}
        {interrupt && (
          <section className={cn("mt-4 rounded-3xl bg-white px-6 py-5", shadow)} aria-live="polite">
            <p className="text-[16px] font-medium">{interrupt.title}</p>
            {interrupt.detail && <p className="mt-1 text-[15px] leading-relaxed text-[#6F6A60]">{interrupt.detail}</p>}
            {interrupt.source && <SourceLink source={interrupt.source} />}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { dismiss(); ask(`Contame de esto: ${interrupt.detail ?? interrupt.title}`); }} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white">Ver ahora</button>
              <button type="button" onClick={dismiss} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Después</button>
            </div>
          </section>
        )}

        {(greeting || intro || props.focus || props.about) && (
          <section className={cn("pt-10 transition-opacity duration-500 sm:pt-14", started && "opacity-60")}>
            {greeting && <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">{greeting}</h1>}
            {props.about && (
              <p className="mt-3 max-w-[38rem] text-[17px] leading-relaxed text-[#6F6A60]">
                {props.about.text} <Link href={props.about.href} className="whitespace-nowrap text-[#9A4B1F] underline decoration-[#E3C9B4] underline-offset-4 hover:decoration-[#9A4B1F]">Ver la misión</Link>
              </p>
            )}
            {intro && <p className={cn("max-w-[38rem] text-[18px] leading-relaxed text-[#4A463F]", props.about ? "mt-6 font-medium text-[#1C1B19]" : "mt-3")}>{intro}</p>}
            {props.focus && (
              <FocusList key={props.focusVersion} initial={props.focus} disabled={pending} canEdit={canEdit} onAdvance={advanceItem} onChange={changeFocus} />
            )}
            {missionLabel && <p className="mt-4 px-2 text-[13px] text-[#9C968A] sm:px-4">Misión {missionLabel}</p>}
          </section>
        )}

        {props.children && <div className={cn("transition-opacity duration-500", started && "opacity-60")}>{props.children}</div>}

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
              const last = i === messages.length - 1;
              return (
                <div key={i} className="space-y-4">
                  {r.body && (
                    <div className="text-[17px] leading-[1.65] [&_a]:text-[#9A4B1F] [&_strong]:font-semibold [&_ul]:space-y-2">
                      <RichText text={r.body} labels={new Map(Object.entries(m.labels ?? {}))} />
                    </div>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <p className="text-[13px] leading-relaxed text-[#9C968A]">
                      Fuentes:{" "}
                      {m.sources.slice(0, 6).map((src, k) => (
                        <span key={src.url}>{k > 0 && " · "}<a href={src.url} target="_blank" rel="noopener noreferrer" title={src.title} className="underline decoration-[#D9D2C3] underline-offset-2 hover:text-[#1C1B19]">{hostOf(src.url)}</a></span>
                      ))}
                    </p>
                  )}
                  {r.detail && (
                    <details className="group rounded-2xl bg-[#F4F1EA] px-5 py-3">
                      <summary className="cursor-pointer list-none text-[14px] font-medium text-[#6F6A60] group-open:mb-2">Ver investigación completa</summary>
                      <div className="text-[15px] leading-relaxed text-[#4A463F] [&_a]:text-[#9A4B1F] [&_strong]:font-semibold">
                        <RichText text={r.detail} labels={new Map(Object.entries(m.labels ?? {}))} />
                      </div>
                    </details>
                  )}
                  {r.messages.map((msg, k) => {
                    const key = `${i}-${k}`;
                    const s = sent[key];
                    return (
                      <div key={key} className={cn("rounded-3xl bg-white px-6 py-5", shadow)}>
                        <p className="text-[16px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => { navigator.clipboard?.writeText(msg.text); setCopied(key); setTimeout(() => setCopied(null), 1800); }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">
                            {copied === key ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                            {copied === key ? "Copiado" : "Copiar"}
                          </button>
                          {msg.to && canEdit && !s && (
                            <span className="ml-auto flex items-center gap-2 text-[14px] text-[#6F6A60]">
                              ¿Lo mandaste?
                              <button type="button" disabled={busy} onClick={() => confirmSent(key, msg)} className="rounded-full bg-[#1C1B19] px-4 py-2 font-medium text-white disabled:opacity-40">Sí</button>
                            </span>
                          )}
                          {s === "enviando" && <span className="ml-auto text-[14px] text-[#8A8478]">Anotando…</span>}
                        </div>
                        {s && s !== "enviando" && ("error" in s
                          ? <p className="mt-2 text-[14px] text-[#A3402A]">{s.error}</p>
                          : (
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F1EDE4] pt-3">
                              <p className={cn("flex-1 text-[15px]", s.draft?.status === "deshecha" && "text-[#A8A295] line-through")}>{s.line}</p>
                              {s.draft && s.draft.status === "ejecutada" && (
                                <button type="button" disabled={busy} onClick={() => startBusy(async () => { const d = await undoFromPanel(slug, s.draft!.id); setSent((x) => ({ ...x, [key]: { line: s.line, draft: d } })); router.refresh(); })} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA] disabled:opacity-40">Deshacer</button>
                              )}
                            </div>
                          ))}
                      </div>
                    );
                  })}
                  {m.drafts?.map((d) => (
                    <ActionObject key={d.id} d={d} canEdit={canEdit} busy={busy}
                      onUndo={() => startBusy(async () => { replaceDraft(await undoFromPanel(slug, d.id)); router.refresh(); })}
                      onDecide={(v) => startBusy(async () => replaceDraft(await decideFromPanel(slug, d.id, v)))} />
                  ))}
                  {r.actions.length > 0 && last && (
                    <div className="flex flex-wrap gap-2">
                      {r.actions.map((a, k) => (
                        <button key={a} type="button" disabled={pending} onClick={() => ask(a)} className={cn("rounded-full px-4 py-2 text-[14px] font-medium transition-opacity disabled:opacity-40", k === 0 ? "bg-[#1C1B19] text-white" : "text-[#6F6A60] hover:bg-[#F4F1EA]")}>
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
          </section>
        )}
        {error && <p className="mt-6 text-[15px] text-[#A3402A]">{error}</p>}
        <div ref={endRef} />
      </main>

      {/* Entrada universal: escribir, hablar, mostrar */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#FAF8F3] via-[#FAF8F3] to-transparent pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                ref={textRef}
                value={listening ? "" : text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }}
                rows={1}
                placeholder={listening ? "Te escucho…" : transcribing ? "Entendiendo lo que dijiste…" : props.placeholder ?? "Preguntame o mostrame algo…"}
                aria-label="Preguntale o mostrale algo a RELEVO"
                className="mb-1.5 max-h-40 min-h-7 flex-1 resize-none bg-transparent text-[16px] leading-7 outline-none placeholder:text-[#A8A295] [field-sizing:content] sm:text-[17px]"
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
            {tabs.map((t) => t.key === tab && !scope
              ? <span key={t.key} className="text-[#1C1B19]">{t.label}</span>
              : <Link key={t.key} href={t.href} className="py-1">{t.label}</Link>)}
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
    <div className={cn("rounded-3xl bg-white px-6 py-5", shadow)}>
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

/** "Vaca Muerta / Añelo ▾": ver el estado de la misión, cambiar de misión o crear una nueva, sin salir del flujo. */
function MissionMenu({ slug, current }: { slug: string; current: { short: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[14px] font-medium text-[#4A463F] hover:bg-[#F1EDE4]">
        <span className="truncate">{current.short}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-1 w-60 overflow-hidden rounded-2xl bg-white py-1 text-[15px] shadow-[0_12px_40px_rgba(28,27,25,0.16)]">
          <Link role="menuitem" href={`/hoy/${slug}/mision`} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-[#F4F1EA]">Ver estado de la misión</Link>
          <Link role="menuitem" href={`/hoy/${slug}/mision/compartir`} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-[#F4F1EA]">Compartir misión</Link>
          <Link role="menuitem" href={`/hoy/${slug}/misiones`} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-[#F4F1EA]">Cambiar misión</Link>
          <Link role="menuitem" href={`/hoy/${slug}/nueva`} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-[#F4F1EA]">Nueva misión</Link>
        </div>
      )}
    </div>
  );
}

/** "Desde tu última visita": primero qué cambió, después quién, y qué haría. Se arma al abrir, sin demorar Ahora. */
function CatchUpCard({ slug, since, onMore }: { slug: string; since: string; onMore: () => void }) {
  const [lines, setLines] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    catchUpSince(slug, since).then((r) => { if (alive) setLines(r?.lines ?? null); }).catch(() => { if (alive) setLines(null); });
    return () => { alive = false; };
  }, [slug, since]);
  if (lines === null) return null;
  return (
    <section className={cn("mt-4 rounded-3xl bg-white px-6 py-5", shadow)} aria-live="polite">
      <p className="text-[17px] font-semibold">Desde tu última visita</p>
      {lines === undefined ? (
        <p className="mt-2 text-[15px] text-[#8A8478]">Poniéndote al día…</p>
      ) : (
        <>
          <div className="mt-2 space-y-1.5 text-[15px] leading-relaxed text-[#4A463F] [&_strong]:font-semibold [&_strong]:text-[#1C1B19]">
            {lines.map((l) => <RichText key={l} text={l} labels={new Map()} />)}
          </div>
          <button type="button" onClick={onMore} className="mt-3 rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium">Contame más</button>
        </>
      )}
    </section>
  );
}
