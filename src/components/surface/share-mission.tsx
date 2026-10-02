"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { inviteToCurrentMission, revokeMissionInvite, updateMissionMember } from "@/app/hoy/[slug]/actions";
import { card } from "./cards";

// Compartir la misión: un mail y si puede trabajar o solo mirar. Nada más.

export type MemberView = { userId: string; name: string; email: string | null; role: "owner" | "member" | "viewer"; me: boolean };
export type InviteView = { id: string; email: string; role: "member" | "viewer" };

const ROLE = { owner: "Creó la misión", member: "Puede trabajar", viewer: "Solo mira" } as const;

export function ShareMission({ slug, members, invites, isOwner }: { slug: string; members: MemberView[]; invites: InviteView[]; isOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const invite = () => start(async () => {
    const r = await inviteToCurrentMission(slug, { email, role });
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setEmail(""); router.refresh(); }
  });
  const field = "rounded-2xl bg-[#F7F4EE] px-4 py-3 text-[16px] outline-none focus:bg-white focus:ring-2 focus:ring-[#E3C9B4]";
  return (
    <div className="space-y-6">
      <ul className={cn(card, "divide-y divide-[#F1EDE4] py-2")}>
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-[16px] font-medium">{m.name}{m.me && <span className="text-[#9C968A]"> · vos</span>}</p>
              <p className="text-[14px] text-[#6F6A60]">{ROLE[m.role]}{m.email ? ` · ${m.email}` : ""}</p>
            </div>
            {isOwner && m.role !== "owner" && (
              <div className="flex gap-1">
                <button type="button" disabled={pending} onClick={() => start(async () => { await updateMissionMember(slug, m.userId, m.role === "member" ? "viewer" : "member"); router.refresh(); })} className="rounded-full px-3 py-1.5 text-[13px] text-[#6F6A60] hover:bg-[#F4F1EA]">{m.role === "member" ? "Que solo mire" : "Que pueda trabajar"}</button>
                <button type="button" disabled={pending} onClick={() => start(async () => { await updateMissionMember(slug, m.userId, "sacar"); router.refresh(); })} className="rounded-full px-3 py-1.5 text-[13px] text-[#A3402A] hover:bg-[#F4F1EA]">Sacar</button>
              </div>
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><p className="text-[16px]">{i.email}</p><p className="text-[14px] text-[#9C968A]">Invitación enviada · {ROLE[i.role].toLowerCase()}</p></div>
            {isOwner && <button type="button" disabled={pending} onClick={() => start(async () => { await revokeMissionInvite(slug, i.id); router.refresh(); })} className="rounded-full px-3 py-1.5 text-[13px] text-[#6F6A60] hover:bg-[#F4F1EA]">Cancelar</button>}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <div className={cn(card, "space-y-3")}>
          <p className="text-[17px] font-medium">Invitar a alguien</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mail@ejemplo.com" className={cn(field, "w-full")} aria-label="Mail" />
          <div className="flex flex-wrap gap-2">
            {(["member", "viewer"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)} className={cn("rounded-full px-4 py-2 text-[14px]", role === r ? "bg-[#1C1B19] text-white" : "bg-[#EFEBE2]")}>{ROLE[r]}</button>
            ))}
          </div>
          <button type="button" disabled={pending || !email.includes("@")} onClick={invite} className="w-full rounded-full bg-[#1C1B19] px-5 py-3 text-[16px] font-medium text-white disabled:opacity-40">{pending ? "Invitando…" : "Invitar a la misión"}</button>
          {msg && <p className={cn("text-[14px]", msg.ok ? "text-[#3F6B3A]" : "text-[#A3402A]")}>{msg.text}</p>}
          <p className="text-[13px] text-[#9C968A]">Va a ver solo esta misión. Tus otras misiones siguen siendo tuyas.</p>
        </div>
      ) : (
        <p className="px-1 text-[15px] text-[#6F6A60]">Solo quien creó la misión puede invitar gente.</p>
      )}
    </div>
  );
}
