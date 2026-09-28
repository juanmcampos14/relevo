import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { canonicalUrl, dedupKey, ingestItemSchema } from "@/domain/ingest";

export type IngestReport = {
  received: number;
  created: number;
  duplicates: number;
  rejected: { index: number; error: string }[];
  finding_ids: string[];
};

/**
 * Crea hallazgos pendientes de revisión a partir de ítems externos.
 * Idempotente: una fuente por URL canónica y un hallazgo por (URL, afirmación).
 * `db` puede ser el cliente del usuario (RLS) o el de servicio para el endpoint
 * con token; en ambos casos workspace_id va explícito y las FK compuestas impiden
 * mezclar workspaces.
 */
export async function ingestFindings(
  db: SupabaseClient<Database>,
  workspaceId: string,
  rawItems: unknown[],
  origin: { sourceSystem: string; tokenId?: string | null },
): Promise<IngestReport> {
  const report: IngestReport = { received: rawItems.length, created: 0, duplicates: 0, rejected: [], finding_ids: [] };
  const sourceByUrl = new Map<string, string>();

  for (const [index, raw] of rawItems.entries()) {
    const parsed = ingestItemSchema.safeParse(raw);
    if (!parsed.success) {
      report.rejected.push({ index, error: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") });
      continue;
    }
    const item = parsed.data;
    const url = canonicalUrl(item.url);

    let sourceId = sourceByUrl.get(url);
    if (!sourceId) {
      const { data: existing } = await db.from("sources").select("id").eq("workspace_id", workspaceId).eq("url", url).maybeSingle();
      if (existing) {
        sourceId = existing.id;
      } else {
        const { data, error } = await db
          .from("sources")
          .insert({
            workspace_id: workspaceId,
            kind: "research_externo",
            title: item.title,
            url,
            publisher: item.publisher ?? null,
            published_at: item.published_at ? item.published_at.slice(0, 10) : null,
            reference: origin.sourceSystem,
          })
          .select("id")
          .single();
        if (error || !data) {
          report.rejected.push({ index, error: "No se pudo registrar la fuente" });
          continue;
        }
        sourceId = data.id;
      }
      sourceByUrl.set(url, sourceId);
    }

    const { data, error } = await db
      .from("findings")
      .insert({
        workspace_id: workspaceId,
        source_id: sourceId,
        kind: item.kind,
        statement: item.statement,
        evidence: item.evidence ?? null,
        analysis: item.analysis ?? null,
        origin: "research_externo",
        verification_status: "fuente_publica_sin_verificar",
        dedup_key: dedupKey(url, item.statement),
        ingest_token_id: origin.tokenId ?? null,
        ingest_meta: { source_system: origin.sourceSystem, topic: item.topic ?? null, entity_hint: item.entity_hint ?? null },
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      report.duplicates++;
    } else if (error || !data) {
      report.rejected.push({ index, error: "No se pudo registrar el hallazgo" });
    } else {
      report.created++;
      report.finding_ids.push(data.id);
    }
  }
  return report;
}
