"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/server/action-result";

// Enlace de revisión: se muestra una sola vez (solo se guarda su hash). Generar otro invalida el anterior.
export function PreviewLink({ action }: { action: () => Promise<ActionState & { link?: string }> }) {
  const [state, run, pending] = useActionState(async () => action(), null as (ActionState & { link?: string }) | null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <form action={run} className="space-y-2">
      <Button type="submit" variant="outline" className="h-9" disabled={pending}>{pending ? "Generando…" : "Generar enlace de revisión"}</Button>
      {state?.link && (
        <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Copialo ahora: no se vuelve a mostrar.</p>
          <p className="break-all font-mono text-xs">{origin}{state.link}</p>
          <p className="text-xs text-muted-foreground">Agregá <span className="font-mono">&amp;modo=prueba</span> para que la respuesta cuente como prueba.</p>
        </div>
      )}
      {state && !state.ok && state.message && <p className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
