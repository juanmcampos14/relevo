"use client";

import { useState } from "react";
import { assetKind, assetOperation, companyKind, verificationStatus } from "@/domain/catalogs";
import { FieldError } from "@/components/app/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField, type Option } from "@/components/app/fields";

export type EntityDefaults = Partial<Record<string, string | number | boolean | null>>;

const opts = (c: { values: readonly string[]; label: (v: string) => string }) => c.values.map((v) => ({ value: v, label: c.label(v) }));

/** Fuente: elegir una existente o cargar una URL/nota nueva sin salir del formulario. */
export function SourcePicker({ sources, prefix = "", label = "Fuente", defaultValue }: { sources: Option[]; prefix?: string; label?: string; defaultValue?: string | null }) {
  const [mode, setMode] = useState<"existing" | "new">(defaultValue || sources.length ? "existing" : "new");
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">{label}</legend>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setMode(mode === "existing" ? "new" : "existing")}>
          {mode === "existing" ? "Cargar fuente nueva" : "Elegir fuente existente"}
        </button>
      </div>
      {mode === "existing" ? (
        <SelectField name={`${prefix}source_id`} label="Fuente registrada" options={sources} placeholder="— Sin fuente —" defaultValue={defaultValue ?? ""} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name={`${prefix}new_source_url`} label="URL" type="url" placeholder="https://" />
            <TextField name={`${prefix}new_source_title`} label="Título o referencia" hint="Si no hay URL: quién lo dijo / qué se observó." />
          </div>
          <FieldError name={`${prefix}source_id`} />
        </>
      )}
    </fieldset>
  );
}

function PlaceFields({ d }: { d: EntityDefaults }) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="text-sm font-medium">Ubicación</legend>
      <TextField name="address_text" label="Dirección" defaultValue={(d.address_text as string) ?? ""} placeholder="Calle y número, o ruta y km" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="locality" label="Localidad" defaultValue={(d.locality as string) ?? "Añelo"} />
        <TextField name="province" label="Provincia" defaultValue={(d.province as string) ?? "Neuquén"} />
      </div>
      <CheckboxField
        name="address_verified"
        label="Dirección verificada"
        defaultChecked={d.address_status === "verificada"}
        hint="Solo si la comprobaste en una fuente (se usa la fuente del registro). Sin verificar, Maps abre igual pero con aviso."
      />
      <FieldError name="location_source_id" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="latitude" label="Latitud (opcional)" inputMode="decimal" defaultValue={d.latitude != null ? String(d.latitude) : ""} />
        <TextField name="longitude" label="Longitud (opcional)" inputMode="decimal" defaultValue={d.longitude != null ? String(d.longitude) : ""} />
      </div>
    </fieldset>
  );
}

/** Campos de empresa / establecimiento / activo. Los nombres coinciden con los esquemas zod. */
export function EntityFields({
  kind,
  sources,
  companies,
  d = {},
}: {
  kind: "company" | "establishment" | "asset";
  sources: Option[];
  companies: Option[];
  d?: EntityDefaults;
}) {
  const str = (k: string) => (d[k] as string | null | undefined) ?? "";
  return (
    <div className="space-y-4">
      {kind === "company" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="trade_name" label="Nombre comercial" defaultValue={str("trade_name")} />
            <TextField name="legal_name" label="Razón social" defaultValue={str("legal_name")} />
            <SelectField name="kind" label="Rol" options={opts(companyKind)} defaultValue={str("kind") || "otro"} />
            <TextField name="locality" label="Localidad" defaultValue={str("locality") || "Añelo"} />
          </div>
          <TextField name="website" label="Sitio web" type="url" placeholder="https://" defaultValue={str("website")} />
        </>
      )}
      {kind === "establishment" && (
        <>
          <TextField name="name" label="Nombre del establecimiento" defaultValue={str("name")} />
          <SelectField name="company_id" label="Empresa (si se conoce)" options={companies} placeholder="— Sin empresa —" defaultValue={str("company_id")} />
          <PlaceFields d={d} />
        </>
      )}
      {kind === "asset" && (
        <>
          <TextField name="title" label="Título" defaultValue={str("title")} placeholder="Ej.: Lote 20x40 sobre ruta 7" />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField name="kind" label="Tipo de activo" options={opts(assetKind)} defaultValue={str("kind") || "terreno"} />
            <SelectField name="operation" label="Operación" options={opts(assetOperation)} defaultValue={str("operation") || "desconocida"} />
            <TextField name="surface_m2" label="Superficie (m²)" inputMode="decimal" defaultValue={d.surface_m2 != null ? String(d.surface_m2) : ""} />
          </div>
          <PlaceFields d={d} />
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="text-sm font-medium">Precio publicado (opcional)</legend>
            <p className="text-xs text-muted-foreground">Solo si figura en una fuente. Monto, moneda, fecha y fuente van juntos.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField name="price_amount" label="Monto" inputMode="decimal" defaultValue={d.price_amount != null ? String(d.price_amount) : ""} />
              <SelectField name="price_currency" label="Moneda" options={[{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }]} placeholder="—" defaultValue={str("price_currency")} />
              <TextField name="price_observed_on" label="Fecha del dato" type="date" defaultValue={str("price_observed_on")} />
            </div>
            <SourcePicker sources={sources} prefix="price_" label="Fuente del precio" defaultValue={str("price_source_id") || null} />
          </fieldset>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="verification_status" label="Estado de verificación" options={opts(verificationStatus)} defaultValue={str("verification_status") || "hipotesis"} />
      </div>
      <SourcePicker sources={sources} defaultValue={str("source_id") || null} />
      <TextAreaField name="notes" label="Notas" rows={2} defaultValue={str("notes")} />
      <CheckboxField name="is_demo" label="Es un registro DEMO (ficticio)" defaultChecked={!!d.is_demo} />
    </div>
  );
}
