"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { initialActionState, type ActionState } from "@/server/action-result";

export function RefreshNewsButton({ action }: { action: (s: ActionState) => Promise<ActionState> }) {
  const [, run, pending] = useActionState(async (s: ActionState) => {
    const r = await action(s);
    if (r.ok) toast.success(r.message ?? "Actualizado");
    else if (r.message) toast.error(r.message);
    return r;
  }, initialActionState);
  return (
    <form action={run}>
      <button disabled={pending} className="inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50">
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
        {pending ? "Actualizando…" : "Actualizar"}
      </button>
    </form>
  );
}
