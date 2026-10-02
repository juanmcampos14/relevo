"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerQuestion, undoLearned } from "@/app/hoy/[slug]/actions";
import type { Learned, Question } from "@/server/surface";
import { card } from "./cards";

// Lo que RELEVO sumó solo a la memoria (con Deshacer) y, si tiene una duda, UNA pregunta.

export function QuestionCard({ slug, q, canEdit }: { slug: string; q: Question; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (a: "misma" | "otra" | "no") => start(async () => { await answerQuestion(slug, q.id, a); router.refresh(); });
  return (
    <div className={card}>
      <p className="text-[13px] text-[#9C968A]">Una pregunta</p>
      <p className="mt-1 text-[17px] font-medium">{q.question}</p>
      {q.detail && <p className="mt-1 text-[15px] text-[#6F6A60]">{q.detail}</p>}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => go("misma")} className="rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-40">{q.kind === "activo" ? "Es el mismo" : "Es la misma"}</button>
          <button type="button" disabled={pending} onClick={() => go("otra")} className="rounded-full bg-[#EFEBE2] px-4 py-2 text-[14px] font-medium disabled:opacity-40">{q.kind === "activo" ? "Es otro, seguilo" : "Es otra, seguila"}</button>
          <button type="button" disabled={pending} onClick={() => go("no")} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA] disabled:opacity-40">No me interesa</button>
        </div>
      )}
    </div>
  );
}

export function LearnedList({ slug, items, canEdit }: { slug: string; items: Learned[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ul className={`${card} space-y-3`}>
      {items.map((l) => (
        <li key={l.id} className="flex items-start justify-between gap-3 text-[15px] leading-relaxed">
          <span className={l.undone ? "text-[#A8A295] line-through" : ""}>{l.summary}</span>
          {canEdit && !l.undone && (
            <button type="button" disabled={pending} onClick={() => start(async () => { await undoLearned(slug, l.id); router.refresh(); })} className="shrink-0 rounded-full px-3 py-1 text-[13px] text-[#6F6A60] hover:bg-[#F4F1EA] disabled:opacity-40">Deshacer</button>
          )}
        </li>
      ))}
    </ul>
  );
}
