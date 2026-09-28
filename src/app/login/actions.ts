"use server";

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

export async function sendMagicLink(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.email().safeParse(fd.get("email"));
  if (!parsed.success) return { message: "Email inválido." };
  const supabase = await createClient();
  // shouldCreateUser: false → el alta es solo por invitación.
  await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm` },
  });
  // Misma respuesta exista o no la cuenta (no revelar usuarios).
  return { ok: true, message: "Si el email tiene acceso, te llegará un enlace para entrar." };
}
