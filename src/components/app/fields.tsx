"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "./action-form";

type Base = { name: string; label: string; hint?: ReactNode; className?: string };

export function TextField({
  name,
  label,
  hint,
  className,
  ...props
}: Base & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="h-10" {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  className,
  ...props
}: Base & Omit<React.ComponentProps<typeof Textarea>, "name">) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export type Option = { value: string; label: string };

export function SelectField({
  name,
  label,
  hint,
  className,
  options,
  placeholder,
  ...props
}: Base & { options: Option[]; placeholder?: string } & Omit<React.ComponentProps<"select">, "name">) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        className="h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function CheckboxField({ name, label, hint, className, ...props }: Base & Omit<React.ComponentProps<"input">, "name" | "type">) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={name} className="size-4 accent-[var(--primary)]" {...props} />
        {label}
      </label>
      {hint && <p className="pl-6 text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

export function CheckboxGroup({ name, label, options, defaultValues = [] }: { name: string; label: string; options: Option[]; defaultValues?: string[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay opciones todavía.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="size-4 accent-[var(--primary)]" />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <FieldError name={name} />
    </fieldset>
  );
}
