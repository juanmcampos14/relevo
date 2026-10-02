import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { configuredEmailProvider } from "@/server/email/provider";

// Compartir una misión: el owner invita por email; la persona entra directo a la misión (no a un onboarding
// de software). Si ya tiene cuenta, se suma en el momento; si no, recibe desde RELEVO un link que crea su
// usuario y la lleva a la misión. Los permisos los decide la base (solo el owner invita o saca gente).

type Db = SupabaseClient<Database>;
export type MissionRole = "member" | "viewer";
export type InviteResult = { ok: true; message: string } | { ok: false; message: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function invitationEmail(o: { inviter: string; mission: string; purpose: string | null; link: string; existing: boolean }) {
  const subject = `${o.inviter} te ${o.existing ? "sumó" : "invitó"} a trabajar en ${o.mission} en RELEVO`;
  const lead = `${o.inviter} te ${o.existing ? "sumó" : "invitó"} a trabajar en ${o.mission}.`;
  const text = [lead, o.purpose ?? "", "", `Entrar a la misión: ${o.link}`].filter((x, i) => x || i === 2).join("\n");
  const html = `<div style="font:16px/1.55 -apple-system,Segoe UI,sans-serif;color:#1C1B19;max-width:520px">
<p style="font-size:13px;letter-spacing:.18em;font-weight:600">RELEVO</p>
<p style="font-size:20px;font-weight:600;margin:24px 0 8px">${esc(lead)}</p>
${o.purpose ? `<p style="color:#4A463F">${esc(o.purpose)}</p>` : ""}
<p style="margin:28px 0"><a href="${esc(o.link)}" style="background:#1C1B19;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">Entrar a la misión</a></p>
<p style="color:#9C968A;font-size:13px">RELEVO ya trabajó en esta misión: cuando entres, te pone al día.</p></div>`;
  return { subject, text, html };
}

export async function inviteToMission(
  db: Db,
  admin: Db,
  o: { workspaceId: string; campaignId: string; email: string; role: MissionRole; inviterId: string; inviterName: string; slug: string; siteUrl: string },
): Promise<InviteResult> {
  const email = o.email.trim().toLowerCase();
  const { data: mission } = await db.from("campaigns").select("name, objective").eq("id", o.campaignId).single();
  if (!mission) return { ok: false, message: "No encontré la misión." };
  const missionName = mission.name.split("—")[0].trim();
  // La invitación la registra el owner (si no lo es, la base no lo deja).
  const { error } = await db.from("mission_invitations").insert({ workspace_id: o.workspaceId, campaign_id: o.campaignId, email, role: o.role, invited_by: o.inviterId });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Esa persona ya tiene una invitación pendiente a esta misión." };
    return { ok: false, message: "Solo quien creó la misión puede invitar gente." };
  }
  const entry = `/hoy/${o.slug}/entrar/${o.campaignId}`;
  const { data: profile } = await admin.from("profiles").select("user_id").eq("email", email).maybeSingle();
  let link: string;
  if (profile) {
    // Ya tiene cuenta: se suma en el momento (y al workspace si todavía no estaba).
    await admin.from("memberships").upsert({ workspace_id: o.workspaceId, user_id: profile.user_id, role: "member" }, { onConflict: "workspace_id,user_id", ignoreDuplicates: true });
    await admin.from("campaign_members").upsert({ campaign_id: o.campaignId, workspace_id: o.workspaceId, user_id: profile.user_id, role: o.role, invited_by: o.inviterId }, { onConflict: "campaign_id,user_id" });
    await admin.from("mission_invitations").update({ status: "accepted", accepted_by: profile.user_id, accepted_at: new Date().toISOString() }).eq("campaign_id", o.campaignId).eq("email", email).eq("status", "pending");
    link = `${o.siteUrl}${entry}`;
  } else {
    // Sin cuenta: un link que crea su usuario y entra directo a la misión (la invitación se acepta al entrar).
    const { data, error: e } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${o.siteUrl}/auth/callback?next=${encodeURIComponent(entry)}` } });
    if (e || !data?.properties?.action_link) return { ok: false, message: `La invitación quedó registrada, pero no pude generar el acceso (${e?.message ?? "sin link"}).` };
    link = data.properties.action_link;
  }
  const provider = configuredEmailProvider();
  if (!provider) return { ok: true, message: profile ? `Listo: ya está en ${missionName}.` : "La invitación quedó registrada, pero el mail no está configurado en este entorno." };
  const mail = invitationEmail({ inviter: o.inviterName, mission: missionName, purpose: mission.objective, link, existing: !!profile });
  const sent = await provider.send({ to: email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `mision-${o.campaignId}-${email}-${Date.now()}` });
  if (!sent.ok) return { ok: true, message: `La invitación quedó registrada, pero el mail no salió (${sent.error}).` };
  return { ok: true, message: profile ? `Listo: ya está en ${missionName} y le avisé por mail.` : `Le mandé la invitación a ${email}.` };
}
