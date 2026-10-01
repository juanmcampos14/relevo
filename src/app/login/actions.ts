"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import type { ActionState } from "@/server/action-result";

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

export async function signInWithPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1) })
    .safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { message: "Revisá email y contraseña." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { message: "Email o contraseña incorrectos." };
  await supabase.rpc("accept_pending_invitations");
  redirect(safeNext(fd.get("next")));
}

/**
 * El enlace mágico vuelve al MISMO dominio donde se pidió: el flujo PKCE guarda una cookie en ese dominio
 * y el canje falla si el enlace abre en otro (www.relevo.site vs. el dominio de Vercel).
 */
const ALLOWED_HOST = /^(www\.)?relevo\.site$|^relevo(-[a-z0-9]+)?-juan-campos\.vercel\.app$|^localhost(:\d+)?$/;
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!ALLOWED_HOST.test(host)) return publicEnv.NEXT_PUBLIC_SITE_URL;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function sendMagicLink(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.email().safeParse(fd.get("email"));
  if (!parsed.success) return { message: "Email inválido." };
  const supabase = await createClient();
  // shouldCreateUser: false → el alta es solo por invitación.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${await requestOrigin()}/auth/confirm` },
  });
  // El límite de envíos del proveedor no revela usuarios: se avisa para no dejar a nadie esperando.
  if (error && /rate limit/i.test(error.message)) return { message: "Se pidieron demasiados enlaces en poco tiempo. Esperá unos minutos o entrá con contraseña." };
  // Misma respuesta exista o no la cuenta (no revelar usuarios).
  return { ok: true, message: "Si el email tiene acceso, te llegará un enlace para entrar." };
}
