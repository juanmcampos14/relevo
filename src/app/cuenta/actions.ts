"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/server/context";
import type { ActionState } from "@/server/action-result";

export async function updateAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  const parsed = z
    .object({
      display_name: z.string().trim().min(1, "Poné tu nombre"),
      password: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined))
        .pipe(z.string().min(10, "Mínimo 10 caracteres").optional()),
    })
    .safeParse({ display_name: fd.get("display_name"), password: fd.get("password") || undefined });
  if (!parsed.success) {
    return { errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name })
    .eq("user_id", user.id);
  if (error) return { message: "No se pudo guardar el nombre." };
  if (parsed.data.password) {
    const { error: pwError } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (pwError) return { message: "No se pudo cambiar la contraseña." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Guardado." };
}
