"use client";

import { useState } from "react";
import { findingKind, verificationStatus } from "@/domain/catalogs";
import type { ActionState } from "@/server/action-result";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { SelectField, TextAreaField, type Option } from "@/components/app/fields";
import { SourcePicker } from "@/components/explorar/entity-fields";

const opts = (c: { values: readonly string[]; label: (v: string) => string }) => c.values.map((v) => ({ value: v, label: c.label(v) }));

/**
 * Alta de hallazgo. Desde una visita, la fuente por defecto es la propia visita.
 * Desde la bandeja, se carga como research externo con URL.
 */
export function FindingForm({
  action,
  sources,
  entities,
  visitId,
  defaultEntity,
  campaignId,
  origin = "manual",
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  sources: Option[];
  entities?: Option[];
  visitId?: string;
  defaultEntity?: string;
  campaignId?: string;
  origin?: "manual" | "research_externo";
}) {
  const [round, setRound] = useState(0);
  const [dedupKey] = useState(() => crypto.randomUUID());
  const [sourceMode, setSourceMode] = useState<"visit" | "other">(visitId ? "visit" : "other");
  return (
    <ActionForm key={round} action={action} onSuccess={() => setRound((r) => r + 1)} className="max-w-2xl">
      <input type="hidden" name="dedup_key" value={`${dedupKey}:${round}`} />
      <input type="hidden" name="origin" value={origin} />
      {visitId && <input type="hidden" name="visit_id" value={visitId} />}
      {campaignId && <input type="hidden" name="campaign_id" value={campaignId} />}
      <input type="hidden" name="source_mode" value={sourceMode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="kind" label="Tipo" options={opts(findingKind)} defaultValue={origin === "research_externo" ? "senal_de_mercado" : "necesidad"} />
        <SelectField
          name="verification_status"
          label="Verificación"
          options={opts(verificationStatus)}
          defaultValue={origin === "research_externo" ? "fuente_publica_sin_verificar" : visitId ? "declarado_por_contacto" : "hipotesis"}
        />
      </div>
      <TextAreaField name="statement" label="Hallazgo" rows={3} placeholder="Una afirmación concreta. Ej.: El encargado dice que tercerizan la lavandería en Neuquén y no están conformes." />
      <TextAreaField name="evidence" label="Evidencia / cita (opcional)" rows={2} placeholder="Cita textual, dato observado o fragmento de la fuente." />
      <TextAreaField name="analysis" label="Análisis (opcional)" rows={2} placeholder="Por qué importa y qué habría que verificar. Es interpretación, no hecho." />
      {entities && entities.length > 0 && (
        <SelectField name="entity" label="Registro relacionado (opcional)" options={entities} placeholder="— Ninguno —" defaultValue={defaultEntity ?? ""} />
      )}
      {defaultEntity && !entities?.length && <input type="hidden" name="entity" value={defaultEntity} />}
      {visitId && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sourceMode === "visit"} onChange={(e) => setSourceMode(e.target.checked ? "visit" : "other")} className="size-4 accent-[var(--primary)]" />
          La fuente es esta visita
        </label>
      )}
      {sourceMode === "other" && <SourcePicker sources={sources} />}
      <SubmitButton>Registrar hallazgo</SubmitButton>
      <p className="text-xs text-muted-foreground">Queda pendiente de revisión. Aprobarlo no crea oportunidades ni tareas por sí solo.</p>
    </ActionForm>
  );
}
