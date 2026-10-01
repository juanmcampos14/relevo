import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { processCapture } from "./process";
import { approveCapture } from "./promote";
import { assessFinding } from "@/server/findings/assess";

// En la calle nadie espera a que el Brain estructure: la captura queda guardada al instante y se procesa en
// background. RELEVO guarda solo lo seguro (misma regla que "Aprobar propuesta"); lo ambiguo, los posibles
// duplicados y lo que depende de una decisión quedan pendientes para cuando importen.

type Db = SupabaseClient<Database>;

export async function structureCapture(db: Db, opts: { workspaceId: string; settings: unknown; userId: string; captureId: string; focus?: string }) {
  const res = await processCapture(db, { workspaceId: opts.workspaceId, settings: opts.settings, userId: opts.userId, captureId: opts.captureId, focus: opts.focus });
  if (!res.ok) return { ok: false as const, message: res.message };
  const approved = await approveCapture(db, { workspaceId: opts.workspaceId, settings: opts.settings, userId: opts.userId, captureId: opts.captureId });
  for (const findingId of new Set(approved.affectedFindings)) await assessFinding(db, { workspaceId: opts.workspaceId, settings: opts.settings, userId: opts.userId, findingId });
  return { ok: true as const, accepted: approved.accepted, pending: approved.pending.length };
}

/** Programa la estructuración después de responder (en un request); fuera de uno (scripts), corre en línea. */
export async function structureLater(db: Db, opts: Parameters<typeof structureCapture>[1]): Promise<void> {
  const run = async () => { await structureCapture(db, opts).catch((e) => console.error("captura en background", opts.captureId, (e as Error).message)); };
  try {
    after(run);
  } catch {
    await run();
  }
}
