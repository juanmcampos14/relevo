import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Result = { id: string | null; error?: string };

/**
 * Permite elegir una fuente existente (`source_id`) o cargar una nueva en el mismo
 * formulario (`new_source_url` y/o `new_source_title`). Si la URL ya existe en el
 * workspace, reutiliza esa fuente en lugar de duplicarla.
 */
export async function resolveSource(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  fd: FormData,
  prefix = "",
): Promise<Result> {
  const existing = String(fd.get(`${prefix}source_id`) ?? "").trim();
  if (existing) return { id: existing };

  const url = String(fd.get(`${prefix}new_source_url`) ?? "").trim();
  const title = String(fd.get(`${prefix}new_source_title`) ?? "").trim();
  const isDemo = fd.get("is_demo") === "on";
  if (!url && !title) return { id: null };
  if (url && !/^https?:\/\//i.test(url)) return { id: null, error: "La URL de la fuente debe empezar con http:// o https://" };

  if (url) {
    const { data: found } = await supabase
      .from("sources")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("url", url)
      .maybeSingle();
    if (found) return { id: found.id };
  }
  const { data, error } = await supabase
    .from("sources")
    .insert({
      workspace_id: workspaceId,
      kind: url ? "url" : "observacion",
      title: title || url,
      url: url || null,
      reference: url ? null : title,
      is_demo: isDemo,
    })
    .select("id")
    .single();
  if (error) return { id: null, error: "No se pudo registrar la fuente." };
  return { id: data.id };
}

/** UUID provisorio para validar "tiene fuente" antes de crear la fuente real. */
export const PENDING_SOURCE = "00000000-0000-4000-8000-000000000000";

/**
 * Lee la fuente del formulario SIN escribir nada: devuelve el id existente, o
 * PENDING_SOURCE si se cargó una fuente nueva. Así la validación corre primero y
 * la fuente nueva solo se crea si el registro completo es válido.
 */
export function peekSource(fd: FormData, prefix = ""): { value: string; error?: string } {
  const existing = String(fd.get(`${prefix}source_id`) ?? "").trim();
  if (existing) return { value: existing };
  const url = String(fd.get(`${prefix}new_source_url`) ?? "").trim();
  const title = String(fd.get(`${prefix}new_source_title`) ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) return { value: "", error: "La URL de la fuente debe empezar con http:// o https://" };
  return { value: url || title ? PENDING_SOURCE : "" };
}

/** Reemplaza PENDING_SOURCE por la fuente real (creándola o reutilizándola por URL). */
export async function commitPendingSources<T extends Record<string, unknown>>(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  fd: FormData,
  row: T,
  fields: { key: keyof T; prefix: string }[],
): Promise<{ row: T; error?: string }> {
  const out = { ...row };
  const created = new Map<string, string | null>();
  for (const { key, prefix } of fields) {
    if (out[key] !== PENDING_SOURCE) continue;
    if (!created.has(prefix)) {
      const res = await resolveSource(supabase, workspaceId, fd, prefix);
      if (res.error) return { row, error: res.error };
      created.set(prefix, res.id);
    }
    (out as Record<string, unknown>)[key as string] = created.get(prefix);
  }
  return { row: out };
}
