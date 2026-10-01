"use client";

import { useEffect, useRef, useState } from "react";
import { PAYERS, nextStep, skipReason, type Answer, type Answers, type Question, type SurveyDefinition } from "@/domain/voice/survey";

// Formulario público: una pregunta por pantalla, botones grandes, siempre se puede omitir o decir «no sé».
// No pide nombre, teléfono, empleador ni dirección. El toque inicial no cambia las preguntas siguientes.

type Identity = { responsible: string | null; contact: string | null; notice: string | null; retentionDays: number };
type Stage = "intro" | "toque" | "elegibilidad" | "pregunta" | "fin" | "fuera" | "cerrado" | "error";

async function post(slug: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/r/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const elapsedSince = (t: number) => Date.now() - t;
const now = () => Date.now();

const btn = "min-h-12 w-full rounded-xl px-4 py-3 text-left text-base transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#12675f]";
const primary = "min-h-12 rounded-xl bg-[#12675f] px-5 py-3 font-medium text-white disabled:opacity-40";
const secondary = "min-h-12 rounded-xl bg-[#e8eeeb] px-5 py-3 text-[#162d31]";

export function VoiceForm({ slug, definition: def, token, test, identity }: { slug: string; definition: SurveyDefinition; token: string | null; test: boolean; identity: Identity }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [session, setSession] = useState<{ id: string; quickTap: boolean } | null>(null);
  const [current, setCurrent] = useState<string>(def.questions[0].id);
  const [history, setHistory] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({ items: {} });
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(0);
  const hp = useRef<HTMLInputElement>(null);

  // Una sesión por visita (recargar no cuenta dos visitas; el efecto doble de desarrollo tampoco).
  const creating = useRef(false);
  useEffect(() => {
    const key = `relevo:${slug}:sesion`;
    if (creating.current) return;
    creating.current = true;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      void Promise.resolve(JSON.parse(saved) as { id: string; quickTap: boolean }).then(setSession);
      return;
    }
    const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "movil" : "escritorio";
    const referrer = document.referrer ? new URL(document.referrer).host : null;
    post(slug, { action: "sesion", token, test, params: window.location.search.slice(1), referrer, device }).then(({ status, data }) => {
      if (status === 200 && typeof data.sessionId === "string") {
        const s = { id: data.sessionId, quickTap: !!data.quickTap };
        sessionStorage.setItem(key, JSON.stringify(s));
        setSession(s);
      } else setStage(status === 403 ? "cerrado" : "error");
    });
  }, [slug, token, test]);

  const event = (kind: string, extra: Record<string, unknown> = {}) => session && post(slug, { action: "evento", sessionId: session.id, kind, ...extra });
  const q = def.questions.find((x) => x.id === current)!;
  const total = def.questions.length;
  const position = def.questions.findIndex((x) => x.id === current) + 1;
  const setItem = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, items: { ...a.items, [id]: { ...a.items[id], ...patch } } }));

  function begin() {
    started.current = now();
    event("inicio");
    setStage(session?.quickTap ? "toque" : "pregunta");
  }

  function go(from: string, current: Answers = answers) {
    let a = current;
    const next = nextStep(def, from as never, a);
    // Preguntas salteadas por ramificación: quedan registradas como omitidas con su motivo.
    const ids = def.questions.map((x) => x.id);
    const start = from === "elegibilidad" ? ids.indexOf("vinculo") : ids.indexOf(from) + 1;
    const end = typeof next === "string" && ids.includes(next) ? ids.indexOf(next) : ids.length;
    for (let i = start; i < end && i >= 0; i++) {
      const r = skipReason(ids[i], a);
      if (r) a = { ...a, items: { ...a.items, [ids[i]]: { omitted: true, skipped: r } } };
    }
    setAnswers(a);
    if (next === "elegibilidad") return setStage("elegibilidad");
    if (next === "fuera") {
      event("fuera_de_alcance");
      sessionStorage.removeItem(`relevo:${slug}:sesion`);
      return setStage("fuera");
    }
    if (next === null) return submit(a);
    setHistory((h) => [...h, from]);
    setCurrent(next);
    setStage("pregunta");
    event("pregunta", { question: next });
    window.scrollTo({ top: 0 });
  }

  async function submit(a: Answers) {
    if (!session) return;
    setBusy(true);
    const { status, data } = await post(slug, { action: "respuesta", sessionId: session.id, answers: a, website: hp.current?.value ?? "", elapsedMs: elapsedSince(started.current) });
    setBusy(false);
    if (status === 200 && typeof data.code === "string") {
      setCode(data.code);
      setStage("fin");
      sessionStorage.removeItem(`relevo:${slug}:sesion`);
    } else if (status === 409 || status === 400) {
      // La sesión guardada ya se había cerrado: se libera para poder empezar de nuevo.
      sessionStorage.removeItem(`relevo:${slug}:sesion`);
      setStage("error");
    } else setStage("error");
  }

  function back() {
    const prev = history[history.length - 1];
    if (!prev) return setStage("intro");
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
  }

  const card = "rounded-2xl bg-white p-5 shadow-sm sm:p-6";

  if (stage === "cerrado") return <section className={card}><h2 className="text-xl font-semibold">Este relevamiento no está abierto</h2></section>;
  if (stage === "error") return <section className={card}><h2 className="text-xl font-semibold">No pudimos guardar</h2><p className="mt-2 text-[#52676c]">Recargá la página y probá de nuevo. Si ya habías enviado tus respuestas, no hace falta repetirlas.</p></section>;

  if (stage === "intro")
    return (
      <section className={card}>
        <h2 className="text-xl font-semibold">{def.intro.title}</h2>
        <div className="mt-3 space-y-3 text-[15px] leading-relaxed">{def.intro.body.map((p, i) => <p key={i}>{p}</p>)}</div>
        <p className="mt-3 text-sm text-[#52676c]">{def.intro.window}</p>
        {/* Aviso breve → aceptación → Voice. «Continuar» es la aceptación (queda como evento «inicio»). */}
        <div className="mt-4 rounded-xl bg-[#e8eeeb] p-4 text-sm leading-relaxed">
          <p>
            <b>Antes de empezar:</b> tus respuestas serán procesadas por RELEVO y pueden ser analizadas mediante inteligencia artificial para identificar necesidades y oportunidades relacionadas con Añelo y Vaca Muerta. No compartas información sensible o confidencial que no estés autorizado a comunicar.
          </p>
          <p className="mt-2">Al continuar, confirmás que leíste y aceptás el aviso de privacidad.</p>
          <details className="mt-3">
            <summary className="cursor-pointer font-medium underline">Aviso de privacidad</summary>
            <div className="mt-2 space-y-2 text-[#33494e]">
              <p>Responsable: {identity.responsible ?? "a completar antes de publicar"}{identity.contact ? <> · <a className="underline" href={`mailto:${identity.contact}`}>{identity.contact}</a></> : null}</p>
              {(identity.notice ?? "Las respuestas se guardan en la base privada de RELEVO, con acceso restringido a su equipo responsable. Se analizan de forma agregada y no se publican casos individuales. No se incorporan a ninguna base de contactos.")
                .split(/\n\s*\n/)
                .map((para, i) => <p key={i}>{para}</p>)}
              <p>Se conservan {Math.round(identity.retentionDays / 30)} meses y después se borran. Al terminar te damos un código: con él podés pedir que borremos tu respuesta escribiendo al contacto.</p>
            </div>
          </details>
        </div>
        <button className={`${primary} mt-5 w-full`} disabled={!session} onClick={begin}>Continuar</button>
        <input ref={hp} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      </section>
    );

  if (stage === "toque")
    return (
      <section className={card}>
        <h2 className="text-xl font-semibold leading-snug">{def.quickTap.title}</h2>
        <p className="mt-1 text-sm text-[#52676c]">Es solo para empezar: después te preguntamos por todo igual.</p>
        <div className="mt-4 grid gap-2">
          {def.quickTap.options.map((o) => (
            <button key={o.value} className={`${btn} border border-[#ccd8d4] bg-white`} onClick={() => { setAnswers((a) => ({ ...a, quick_tap: o.value })); event("toque", { value: o.value }); setStage("pregunta"); }}>{o.label}</button>
          ))}
        </div>
      </section>
    );

  if (stage === "elegibilidad")
    return (
      <section className={card}>
        <h2 className="text-xl font-semibold leading-snug">{def.eligibility.title}</h2>
        <div className="mt-4 grid gap-2">
          {def.eligibility.options.map((o) => (
            <button key={o.value} className={`${btn} border border-[#ccd8d4] bg-white`} onClick={() => go("elegibilidad", { ...answers, eligibility: o.value })}>{o.label}</button>
          ))}
        </div>
      </section>
    );

  if (stage === "fuera")
    return <section className={card}><h2 className="text-xl font-semibold">Gracias</h2><p className="mt-2">Este relevamiento busca a quienes viven, trabajan o pasan tiempo en Añelo. No hace falta que sigas.</p></section>;

  if (stage === "fin")
    return (
      <section className={card}>
        <h2 className="text-xl font-semibold">¡Gracias por contarnos!</h2>
        <p className="mt-2">Tu experiencia nos ayuda a entender qué pasa en Añelo. No te vamos a contactar por esto.</p>
        {code && <p className="mt-4 rounded-xl bg-[#e8eeeb] p-3 text-sm">Tu código de respuesta: <b className="font-mono">{code}</b>. Si querés que la borremos, escribí{identity.contact ? <> a <a className="underline" href={`mailto:${identity.contact}?subject=Borrar respuesta ${code}`}>{identity.contact}</a></> : " al contacto indicado"} con este código.</p>}
      </section>
    );

  return <QuestionCard q={q} position={position} total={total} answer={answers.items[q.id] ?? {}} onChange={(p) => setItem(q.id, p)} onNext={() => go(q.id)} onSkip={() => go(q.id, { ...answers, items: { ...answers.items, [q.id]: { omitted: true } } })} onBack={back} busy={busy} last={nextStep(def, q.id as never, answers) === null} />;
}

function QuestionCard({ q, position, total, answer, onChange, onNext, onSkip, onBack, busy, last }: { q: Question; position: number; total: number; answer: Answer; onChange: (p: Partial<Answer>) => void; onNext: () => void; onSkip: () => void; onBack: () => void; busy: boolean; last: boolean }) {
  const chosen = q.multi ? (answer.choices ?? []) : answer.choice ? [answer.choice] : [];
  const toggle = (v: string) => (q.multi ? onChange({ choices: chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v], omitted: false }) : onChange({ choice: v, omitted: false }));
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs text-[#52676c]">Pregunta {position} de {total} · podés omitirla</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e8eeeb]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position}>
        <div className="h-full bg-[#12675f] transition-[width]" style={{ width: `${(position / total) * 100}%` }} />
      </div>
      <h2 className="mt-4 text-xl font-semibold leading-snug">{q.title}</h2>
      {q.hint && <p className="mt-1 text-sm text-[#52676c]">{q.hint}</p>}
      {q.options.length > 0 && (
        <div className="mt-4 grid gap-2" role={q.multi ? "group" : "radiogroup"} aria-label={q.title}>
          {q.options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button key={o.value} type="button" role={q.multi ? "checkbox" : "radio"} aria-checked={on} className={`${btn} border ${on ? "border-[#12675f] bg-[#e6f2ef] font-medium" : "border-[#ccd8d4] bg-white"}`} onClick={() => toggle(o.value)}>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {q.money?.map((m) => (
        <label key={m.key} className="mt-4 block text-sm">
          <span className="font-medium">{m.label}</span>
          {m.kind === "hipotetico" && <span className="block text-xs text-[#52676c]">Es una estimación tuya, no un compromiso.</span>}
          <input inputMode="numeric" pattern="[0-9]*" className="mt-1 block w-full rounded-xl border border-[#bdceca] p-3 text-base" placeholder="Ej.: 15000" value={answer.money?.[m.key] ?? ""}
            onChange={(e) => { const n = e.target.value.replace(/\D/g, ""); onChange({ money: { ...answer.money, [m.key]: n ? Number(n) : null } }); }} />
        </label>
      ))}
      {q.payer && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">¿Quién pagó?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAYERS.map((p) => (
              <button key={p.value} type="button" aria-pressed={answer.payer === p.value} className={`min-h-11 rounded-full border px-4 text-sm ${answer.payer === p.value ? "border-[#12675f] bg-[#e6f2ef]" : "border-[#ccd8d4]"}`} onClick={() => onChange({ payer: p.value })}>{p.label}</button>
            ))}
          </div>
        </fieldset>
      )}
      {q.detail && (
        <label className="mt-4 block text-sm">
          <span className="font-medium">{q.detail}</span>
          <span className="block text-xs text-[#52676c]">Opcional. No incluyas nombres, teléfonos ni datos de contacto.</span>
          <textarea aria-label={q.detail} className="mt-1 block min-h-24 w-full rounded-xl border border-[#bdceca] p-3 text-base" maxLength={1500} value={answer.detail ?? ""} onChange={(e) => onChange({ detail: e.target.value })} />
        </label>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button className={secondary} onClick={onBack}>Atrás</button>
        <button className={primary} onClick={onNext} disabled={busy}>{last ? (busy ? "Enviando…" : "Enviar") : "Siguiente"}</button>
        <button className={secondary} onClick={onSkip} disabled={busy}>Omitir</button>
      </div>
    </section>
  );
}
