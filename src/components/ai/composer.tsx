"use client";

import { useActionState, useRef, startTransition } from "react";
import { initialActionState, type ActionState } from "@/server/action-result";

export function Composer({
  action,
  scopes,
  defaultScope,
  disabledReason,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  scopes: { value: string; label: string }[];
  defaultScope?: string;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
        e.currentTarget.querySelector("textarea")!.value = "";
      }}
      className="space-y-2 rounded-lg border bg-background p-3"
    >
      <textarea
        name="text"
        rows={3}
        required
        disabled={!!disabledReason || pending}
        placeholder={disabledReason ?? "Preguntá sobre campañas, visitas, hallazgos u oportunidades. Ej.: ¿Qué aprendimos de gastronomía y qué falta validar?"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ref.current?.requestSubmit();
        }}
        className="w-full resize-y rounded-md border-0 bg-transparent p-1 text-sm outline-none"
        aria-label="Pregunta para RELEVO AI"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {scopes.length > 1 ? (
          <select name="scope" defaultValue={defaultScope ?? ""} aria-label="Alcance" className="h-9 rounded-md border bg-background px-2 text-sm">
            {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : (
          <input type="hidden" name="scope" value={defaultScope ?? ""} />
        )}
        <button disabled={!!disabledReason || pending} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/85 disabled:opacity-50">
          {pending ? "Consultando registros…" : "Preguntar"}
        </button>
      </div>
      {pending && <p className="text-xs text-muted-foreground">Puede tardar hasta un minuto: RELEVO AI consulta la base antes de responder.</p>}
      {state.message && !state.ok && <p role="alert" className="text-sm text-destructive">{state.message}</p>}
      {state.errors?.text && <p className="text-sm text-destructive">{state.errors.text}</p>}
    </form>
  );
}
