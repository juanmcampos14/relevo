"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PromoteState } from "@/app/w/[slug]/hallazgos/actions";

// Promover una hipótesis: si no tiene evidencia suficiente, RELEVO avisa y pide confirmación (con motivo
// opcional). No bloquea: la decisión es de la persona y queda en la historia.
export function PromoteMaturity({ action, label }: { action: (s: PromoteState, fd: FormData) => Promise<PromoteState>; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (!state.ok && state.message) toast.error(state.message);
  }, [state]);
  if (state.confirm && !state.ok && !cancelled) {
    return (
      <form action={formAction} className="w-full max-w-xl space-y-2 rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alertdialog" aria-label="Confirmar promoción">
        <p className="font-medium">{state.confirm}</p>
        <input type="hidden" name="confirm" value="1" />
        <textarea name="reason" rows={2} placeholder="Motivo (opcional): por qué la promovés igual" className="w-full rounded-lg border bg-background px-3 py-2 text-foreground" />
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setCancelled(true)}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Promoviendo…" : "Promover igualmente"}</Button>
        </div>
      </form>
    );
  }
  return (
    <form action={formAction} onSubmit={() => setCancelled(false)}>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "…" : label}</Button>
    </form>
  );
}
