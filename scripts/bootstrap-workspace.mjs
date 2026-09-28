#!/usr/bin/env node
// Crea un workspace con su owner en un proyecto Supabase real (staging/prod).
// Idempotente: si el workspace o el usuario ya existen, los reutiliza.
//
// Uso:
//   node --env-file=.env.production.local scripts/bootstrap-workspace.mjs \
//     --name "Daicou" --slug daicou --owner tano@ejemplo.com --owner-name "Tano" \
//     [--campaign "Añelo — Discovery 2026"] [--verticals "Gastronomía,Fitness,..."] [--no-approve]
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (nunca commitear).
// El owner recibe un email de invitación de Supabase Auth. No crea datos de negocio.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values: a } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    owner: { type: "string" },
    "owner-name": { type: "string" },
    campaign: { type: "string" },
    verticals: { type: "string" },
    "site-url": { type: "string" },
    // El owner no aprueba decisiones del negocio (p. ej. socio técnico).
    "no-approve": { type: "boolean", default: false },
  },
});
if (!a.name || !a.slug || !a.owner) {
  console.error("Faltan --name, --slug u --owner");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const siteUrl = a["site-url"] ?? process.env.NEXT_PUBLIC_SITE_URL;
if (!url || !key || !siteUrl) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o NEXT_PUBLIC_SITE_URL");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

const email = a.owner.toLowerCase();

// 1) Usuario owner (invitación por email si no existe).
let userId;
const invited = await db.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${siteUrl}/auth/callback?next=/cuenta`,
  data: a["owner-name"] ? { display_name: a["owner-name"] } : undefined,
});
if (invited.error) {
  const list = must(await db.auth.admin.listUsers({ perPage: 1000 }), "listar usuarios");
  const found = list.users.find((u) => u.email?.toLowerCase() === email);
  if (!found) throw new Error(`invitar owner: ${invited.error.message}`);
  userId = found.id;
  console.log(`· owner ya existía: ${email}`);
} else {
  userId = invited.data.user.id;
  console.log(`✓ invitación enviada a ${email}`);
}

// 2) Workspace + membresía owner con capacidad de aprobar.
let ws = must(await db.from("workspaces").select("id").eq("slug", a.slug).maybeSingle(), "buscar workspace");
if (!ws) {
  ws = must(await db.from("workspaces").insert({ name: a.name, slug: a.slug, created_by: userId }).select("id").single(), "crear workspace");
  console.log(`✓ workspace ${a.name} (${a.slug})`);
} else {
  console.log(`· workspace ${a.slug} ya existía`);
}
must(
  await db
    .from("memberships")
    .upsert({ workspace_id: ws.id, user_id: userId, role: "owner", can_approve_decisions: !a["no-approve"] }, { onConflict: "workspace_id,user_id" }),
  "membresía owner",
);
console.log(a["no-approve"] ? "✓ owner (sin capacidad de aprobar decisiones)" : "✓ owner con capacidad de aprobar");

// 3) Estructura opcional: campaña y verticales (sin datos de negocio).
if (a.campaign) {
  let camp = must(await db.from("campaigns").select("id").eq("workspace_id", ws.id).eq("name", a.campaign).maybeSingle(), "buscar campaña");
  if (!camp) {
    camp = must(
      await db
        .from("campaigns")
        .insert({ workspace_id: ws.id, name: a.campaign, status: "activa", owner_id: userId, created_by: userId })
        .select("id")
        .single(),
      "crear campaña",
    );
    console.log(`✓ campaña ${a.campaign}`);
  }
  const names = (a.verticals ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    let v = must(await db.from("verticals").select("id").eq("workspace_id", ws.id).eq("name", name).maybeSingle(), "buscar vertical");
    if (!v) v = must(await db.from("verticals").insert({ workspace_id: ws.id, name, created_by: userId }).select("id").single(), "crear vertical");
    must(
      await db.from("campaign_verticals").upsert({ workspace_id: ws.id, campaign_id: camp.id, vertical_id: v.id }, { onConflict: "campaign_id,vertical_id" }),
      "vincular vertical",
    );
  }
  if (names.length) console.log(`✓ ${names.length} verticales`);
}
console.log("Listo.");
