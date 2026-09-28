import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { publicEnv } from "@/lib/env";
import { MAX_ITEMS } from "@/domain/ingest";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField } from "@/components/app/fields";
import { TokenForm } from "@/components/app/token-form";
import { createIngestToken, importBatch, revokeIngestToken } from "./actions";

export const metadata: Metadata = { title: "Integraciones" };

const EXAMPLE = `{
  "source_system": "morning-brief",
  "items": [
    {
      "url": "https://medio.example/nota",
      "title": "Título de la nota",
      "publisher": "Medio",
      "published_at": "2026-09-28",
      "statement": "Qué dice la fuente, en una afirmación concreta",
      "kind": "senal_de_mercado",
      "evidence": "Cita textual (opcional)",
      "analysis": "Por qué importa para RELEVO (opcional)",
      "topic": "inmuebles",
      "entity_hint": "Nombre de empresa o lugar mencionado (opcional)"
    }
  ]
}`;

export default async function IntegracionesPage({ params }: PageProps<"/w/[slug]/integraciones">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  const { data: tokens } = canManage
    ? await supabase.from("ingest_tokens").select("id, name, token_hint, created_at, last_used_at, revoked_at").order("created_at", { ascending: false })
    : { data: [] };
  const endpoint = `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ingest/findings`;

  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader
        title="Integraciones"
        subtitle="Research externo (Morning Brief) → hallazgos pendientes de revisión, con fuente, URL, fecha y evidencia. Nunca crea oportunidades."
      />

      <Section title="Importar un lote a mano">
        <p className="text-sm text-muted-foreground">
          Pegá el JSON que genera el Morning Brief (hasta {MAX_ITEMS} ítems). Si un ítem ya se importó (misma URL y misma afirmación), no se duplica.
        </p>
        {ctx.canEdit && (
          <ActionForm action={importBatch.bind(null, slug)}>
            <TextAreaField name="json" label="JSON" rows={10} placeholder={EXAMPLE} className="font-mono" />
            <SubmitButton>Importar</SubmitButton>
          </ActionForm>
        )}
      </Section>

      {canManage && (
        <Section title="Ingesta automática (API)">
          <div className="space-y-2 text-sm">
            <p>
              Endpoint: <code className="rounded bg-muted px-1">POST {endpoint}</code>
            </p>
            <p>
              Encabezado <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> y el mismo JSON de arriba. Responde cuántos se crearon, cuántos ya existían y cuáles se rechazaron.
            </p>
          </div>
          <TokenForm action={createIngestToken.bind(null, slug)} />
          {tokens?.length ? (
            <ul className="divide-y rounded-lg border">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <span className="font-medium">{t.name}</span> <span className="text-muted-foreground">…{t.token_hint}</span>
                    <div className="text-xs text-muted-foreground">
                      creado {formatDate(t.created_at)} · {t.last_used_at ? `último uso ${formatDate(t.last_used_at, true)}` : "sin uso"}
                    </div>
                  </div>
                  {t.revoked_at ? (
                    <Pill>Revocado</Pill>
                  ) : (
                    <form action={revokeIngestToken.bind(null, slug, t.id)}>
                      <button className="text-sm text-destructive hover:underline">Revocar</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      )}
    </div>
  );
}
