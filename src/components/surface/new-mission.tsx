"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square } from "lucide-react";
import { cn } from "cn";
import { useRecorder } from "@/lib/capture/media";
import { transcribeQuestion } from "@/app/w/[slug]/ai/panel-actions";
import { createNewMission, draftNewMission } from "@/app/hoy/[slug]/actions";
import type { MissionDraft } from "@/server/mission/create";
import { card } from "./cards";

// Nueva misión, sin formulario: "¿Qué querés investigar?". RELEVO propone nombre, objetivo y contexto; si falta
// algo indispensable, pregunta una sola cosa. Después: Crear misión y a trabajar.

export function NewMission({ slug }: { slug: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [draft, setDraft] = useState<MissionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [transcribing, setTranscribing] = useState(false);

  const think = (full: string) => start(async () => {
    setError(null);
    const r = await draftNewMission(slug, full);
    if (r.ok) setDraft(r.draft);
    else setError(r.message);
  });
  const recorder = useRecorder(useCallback(async (audio: { data: ArrayBuffer; mimeType: string }) => {
    setTranscribing(true);
    const fd = new FormData();
    fd.set("audio", new Blob([audio.data], { type: audio.mimeType }));
    const res = await transcribeQuestion(slug, fd);
    setTranscribing(false);
    if (res.text) setText((t) => (t ? `${t} ${res.text}` : res.text!));
    else setError(res.error ?? "No te pude escuchar bien.");
  }, [slug]));
  const create = () => draft && start(async () => {
    const r = await createNewMission(slug, { name: draft.name, objective: draft.objective, context: draft.context, zone: draft.zone, queries: draft.queries });
    if (r.ok) router.push(`/hoy/${slug}`);
    else setError(r.message);
  });
  const listening = recorder.state === "recording";
  const field = "w-full rounded-2xl bg-[#F7F4EE] px-4 py-3 text-[16px] outline-none focus:bg-white focus:ring-2 focus:ring-[#E3C9B4]";

  return (
    <div className="pt-10 sm:pt-14">
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">Nueva misión</h1>
      <p className="mt-3 text-[18px] leading-relaxed text-[#4A463F]">¿Qué querés investigar?</p>
      <div className={cn(card, "mt-6")}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Quiero investigar oportunidades en locales comerciales en San Isidro y Zona Norte: locales vacíos, negocios con mucha demanda, comercios que podrían expandirse…" className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-[#A8A295]" aria-label="Qué querés investigar" />
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => (listening ? recorder.stop() : recorder.start())} disabled={transcribing} aria-label={listening ? "Terminar" : "Decirlo"} className={cn("flex size-11 items-center justify-center rounded-full", listening ? "bg-[#1C1B19] text-white" : "bg-[#F4F1EA] text-[#1C1B19]")}>
            {listening ? <Square className="size-4 fill-current" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
          <button type="button" disabled={pending || text.trim().length < 10} onClick={() => think(text)} className="rounded-full bg-[#1C1B19] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-40">
            {pending && !draft ? "Entendiendo…" : draft ? "Volver a pensarla" : "Seguir"}
          </button>
        </div>
      </div>

      {draft && (
        <div className={cn(card, "mt-4 space-y-4")}>
          <label className="block"><span className="text-[13px] tracking-[0.08em] text-[#9C968A] uppercase">Nombre</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={cn(field, "mt-1 font-semibold")} /></label>
          <label className="block"><span className="text-[13px] tracking-[0.08em] text-[#9C968A] uppercase">Objetivo</span>
            <textarea value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} rows={2} className={cn(field, "mt-1 resize-none")} /></label>
          <label className="block"><span className="text-[13px] tracking-[0.08em] text-[#9C968A] uppercase">Contexto inicial</span>
            <input value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} className={cn(field, "mt-1")} /></label>
          {draft.question && (
            <div className="rounded-2xl bg-[#F4ECE1] px-4 py-3">
              <p className="text-[15px] font-medium">{draft.question}</p>
              <div className="mt-2 flex gap-2">
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} className={cn(field, "bg-white")} placeholder="Tu respuesta" />
                <button type="button" disabled={pending || !answer.trim()} onClick={() => { const full = `${text}\n${draft.question} ${answer}`; setText(full); setAnswer(""); think(full); }} className="shrink-0 rounded-full bg-[#1C1B19] px-4 text-[14px] font-medium text-white disabled:opacity-40">Listo</button>
              </div>
            </div>
          )}
          <button type="button" disabled={pending || !draft.name.trim() || !draft.objective.trim()} onClick={create} className="w-full rounded-full bg-[#1C1B19] px-5 py-3.5 text-[16px] font-medium text-white disabled:opacity-40">
            {pending ? "Creando…" : "Crear misión"}
          </button>
          <p className="text-center text-[13px] text-[#9C968A]">Entrás directo a trabajar; armo un primer panorama mientras tanto.</p>
        </div>
      )}
      {error && <p className="mt-4 text-[15px] text-[#A3402A]">{error}</p>}
    </div>
  );
}
