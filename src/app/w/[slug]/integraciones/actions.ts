"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { hashToken, ingestPayloadSchema } from "@/domain/ingest";
import { ingestFindings } from "@/server/ingest";

export type TokenState = ActionState & { token?: string };

export async function createIngestToken(slug: string, _: TokenState, fd: FormData): Promise<TokenState> {
  const ctx = await getWorkspaceContext(slug);
  const name = z.string().trim().min(1).max(80).safeParse(fd.get("name"));
  if (!name.success) return { errors: { name: "Poné un nombre (ej.: Morning Brief)" } };
  const token = `rlv_${randomBytes(24).toString("base64url")}`;
  const supabase = await createClient();
  const { error } = await supabase.from("ingest_tokens").insert({
    workspace_id: ctx.workspace.id,
    name: name.data,
    token_hash: hashToken(token),
    token_hint: token.slice(-4),
    created_by: ctx.user.id,
  });
  if (error) return { message: error.code === "42501" ? "Solo owner o admin pueden crear tokens." : dbErrorMessage(error) };
  revalidatePath(`/w/${slug}/integraciones`);
  // Única vez que se muestra: en la base queda solo el hash.
  return { ok: true, token };
}

export async function revokeIngestToken(slug: string, tokenId: string): Promise<void> {
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  await supabase.from("ingest_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).is("revoked_at", null);
  revalidatePath(`/w/${slug}/integraciones`);
}

export async function importBatch(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  let body: unknown;
  try {
    body = JSON.parse(String(fd.get("json") ?? ""));
  } catch {
    return { errors: { json: "No es JSON válido" } };
  }
  const payload = ingestPayloadSchema.safeParse(Array.isArray(body) ? { items: body } : body);
  if (!payload.success) return { errors: { json: payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
  // Importación manual: con la sesión del usuario (RLS), sin token.
  const supabase = await createClient();
  const r = await ingestFindings(supabase, ctx.workspace.id, payload.data.items, { sourceSystem: payload.data.source_system });
  revalidatePath(`/w/${slug}`, "layout");
  const rejected = r.rejected.length ? ` · ${r.rejected.length} rechazados (${r.rejected.map((x) => `#${x.index + 1}: ${x.error}`).join(" | ")})` : "";
  return {
    ok: r.rejected.length === 0 || r.created > 0,
    message: `${r.created} hallazgos nuevos · ${r.duplicates} ya existían${rejected}. Quedan pendientes de revisión.`,
  };
}
