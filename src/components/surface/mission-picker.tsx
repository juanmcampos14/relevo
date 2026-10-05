"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, MoreHorizontal, Plus } from "lucide-react";
import { chooseMission, deleteMission, restoreMission } from "@/app/hoy/[slug]/actions";
import type { MissionOption } from "@/server/mission/current";
import { card } from "./cards";

// ¿En qué misión vas a trabajar ahora? Se elige tocando (o diciéndolo abajo: "entrá a Vaca Muerta").
// Quien creó una misión puede eliminarla desde "···" (se archiva: nada se borra y se puede deshacer).

export function MissionPicker({ slug, missions, current, owned = [] }: { slug: string; missions: MissionOption[]; current: string | null; owned?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (id: string) => start(async () => { if ((await chooseMission(slug, id)).ok) router.push(`/hoy/${slug}`); });
  const remove = (m: MissionOption) => start(async () => {
    const r = await deleteMission(slug, m.id);
    setConfirm(null);
    setMenu(null);
    if (r.ok) { setRemoved({ id: m.id, name: m.short }); setError(null); router.refresh(); } else setError(r.message ?? "No se pudo eliminar la misión.");
  });
  const undo = () => start(async () => { if (removed && (await restoreMission(slug, removed.id)).ok) { setRemoved(null); router.refresh(); } });
  return (
    <div className="pt-10 sm:pt-14">
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">¿En qué misión vas a trabajar ahora?</h1>
      {removed && (
        <p className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl bg-[#EFEBE2] px-4 py-3 text-[15px]" role="status">
          Eliminaste {removed.name}.
          <button type="button" disabled={pending} onClick={undo} className="font-medium underline underline-offset-4">Deshacer</button>
        </p>
      )}
      {error && <p className="mt-6 text-[15px] text-[#A3402A]" role="alert">{error}</p>}
      <ul className="mt-8 space-y-3">
        {missions.map((m) => (
          <li key={m.id} className="relative">
            <button type="button" disabled={pending} onClick={() => go(m.id)} className={`${card} group flex w-full items-start gap-4 text-left transition-colors hover:bg-[#FFFDF8] disabled:opacity-60 ${owned.includes(m.id) ? "pr-16" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-semibold">{m.short}{m.id === current && <span className="ml-2 text-[13px] font-normal text-[#9C968A]">la de recién</span>}</span>
                {m.objective && <span className="mt-1 block text-[15px] leading-relaxed text-[#6F6A60]">{m.objective}</span>}
              </span>
              <ArrowRight className="mt-1.5 size-5 shrink-0 text-[#B0A894] group-hover:text-[#1C1B19]" aria-hidden="true" />
            </button>
            {owned.includes(m.id) && (
              <button type="button" onClick={() => { setMenu(menu === m.id ? null : m.id); setConfirm(null); }} aria-label={`Más opciones: ${m.short}`} aria-expanded={menu === m.id} className="absolute top-4 right-3 flex size-9 items-center justify-center rounded-full text-[#8A8478] hover:bg-[#F4F1EA]">
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
            )}
            {menu === m.id && (
              <div className="mt-2 rounded-2xl bg-white px-5 py-4 shadow-[0_8px_28px_rgba(28,27,25,0.10)]">
                {confirm === m.id ? (
                  <>
                    <p className="text-[15px] font-medium">¿Eliminar {m.short}?</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#6F6A60]">Desaparece de las misiones de todos los que trabajan en ella y RELEVO la deja de vigilar. Lo aprendido no se borra.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={pending} onClick={() => remove(m)} className="rounded-full bg-[#A3402A] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50">Eliminar misión</button>
                      <button type="button" onClick={() => { setConfirm(null); setMenu(null); }} className="rounded-full px-3 py-2 text-[14px] text-[#6F6A60] hover:bg-[#F4F1EA]">Cancelar</button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirm(m.id)} className="text-[15px] text-[#A3402A]">Eliminar misión</button>
                )}
              </div>
            )}
          </li>
        ))}
        <li>
          <Link href={`/hoy/${slug}/nueva`} className="flex items-center gap-3 rounded-3xl border border-dashed border-[#D9D2C3] px-6 py-5 text-[16px] text-[#6F6A60] hover:border-[#B0A894] hover:text-[#1C1B19]">
            <Plus className="size-5" aria-hidden="true" /> Nueva misión
          </Link>
        </li>
      </ul>
    </div>
  );
}
