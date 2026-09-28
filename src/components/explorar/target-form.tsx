"use client";

import { useState } from "react";
import { entityKind, targetStatus } from "@/domain/catalogs";
import type { ActionState } from "@/server/action-result";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup, SelectField, TextField, type Option } from "@/components/app/fields";
import { EntityFields } from "./entity-fields";

export function TargetForm({
  action,
  verticals,
  sources,
  companies,
  existing,
  defaultVerticalId,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  verticals: Option[];
  sources: Option[];
  companies: Option[];
  existing: Option[];
  defaultVerticalId?: string;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [kind, setKind] = useState<"company" | "establishment" | "asset">("establishment");
  const [formKey, setFormKey] = useState(0);

  return (
    <ActionForm key={formKey} action={action} onSuccess={() => setFormKey((k) => k + 1)} className="max-w-2xl">
      <div className="flex gap-2">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md border px-3 py-1.5 text-sm ${mode === m ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground"}`}
          >
            {m === "new" ? "Registro nuevo" : "Ya cargado"}
          </button>
        ))}
      </div>

      {mode === "existing" ? (
        <SelectField name="existing" label="Empresa, establecimiento o activo" options={existing} placeholder="— Elegir —" />
      ) : (
        <>
          <SelectField
            name="kind"
            label="Tipo"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            options={entityKind.values.map((v) => ({ value: v, label: entityKind.label(v) }))}
            hint="Establecimiento: un lugar físico que opera. Activo: inmueble, terreno, local o fondo de comercio."
          />
          <EntityFields key={kind} kind={kind} sources={sources} companies={companies} />
        </>
      )}

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="text-sm font-medium">En esta campaña</legend>
        <CheckboxGroup name="vertical_ids" label="Verticales" options={verticals} defaultValues={defaultVerticalId ? [defaultVerticalId] : []} />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField name="status" label="Estado" options={targetStatus.values.map((v) => ({ value: v, label: targetStatus.label(v) }))} defaultValue="identificado" />
          <SelectField name="priority" label="Prioridad" options={[{ value: "1", label: "Alta" }, { value: "2", label: "Media" }, { value: "3", label: "Baja" }]} defaultValue="2" />
          <TextField name="next_action_due" label="Próxima acción (fecha)" type="date" />
        </div>
        <TextField name="next_action" label="Próxima acción" placeholder="Ej.: pasar a conocer al encargado" />
        <TextField name="discard_reason" label="Motivo de descarte" hint="Solo si el estado es Descartado." />
      </fieldset>
      <SubmitButton>Agregar objetivo</SubmitButton>
    </ActionForm>
  );
}
