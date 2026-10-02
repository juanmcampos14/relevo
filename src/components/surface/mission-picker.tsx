"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { chooseMission } from "@/app/hoy/[slug]/actions";
import type { MissionOption } from "@/server/mission/current";
import { card } from "./cards";

// ¿En qué misión vas a trabajar ahora? Se elige tocando (o diciéndolo abajo: "entrá a Vaca Muerta").

export function MissionPicker({ slug, missions, current }: { slug: string; missions: MissionOption[]; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (id: string) => start(async () => { if ((await chooseMission(slug, id)).ok) router.push(`/hoy/${slug}`); });
  return (
    <div className="pt-10 sm:pt-14">
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">¿En qué misión vas a trabajar ahora?</h1>
      <ul className="mt-8 space-y-3">
        {missions.map((m) => (
          <li key={m.id}>
            <button type="button" disabled={pending} onClick={() => go(m.id)} className={`${card} group flex w-full items-start gap-4 text-left transition-colors hover:bg-[#FFFDF8] disabled:opacity-60`}>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-semibold">{m.short}{m.id === current && <span className="ml-2 text-[13px] font-normal text-[#9C968A]">la de recién</span>}</span>
                {m.objective && <span className="mt-1 block text-[15px] leading-relaxed text-[#6F6A60]">{m.objective}</span>}
              </span>
              <ArrowRight className="mt-1.5 size-5 shrink-0 text-[#B0A894] group-hover:text-[#1C1B19]" aria-hidden="true" />
            </button>
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
