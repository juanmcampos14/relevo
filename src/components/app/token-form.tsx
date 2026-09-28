"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import type { TokenState } from "@/app/w/[slug]/integraciones/actions";

export function TokenForm({ action }: { action: (s: TokenState, fd: FormData) => Promise<TokenState> }) {
  const [state, formAction, pending] = useActionState(action, {} as TokenState);
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Nombre</span>
          <input name="name" defaultValue="Morning Brief" className="block h-10 w-56 rounded-lg border px-2.5" />
        </label>
        <button disabled={pending} className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85 disabled:opacity-50">
          Crear token
        </button>
      </form>
      {state.errors?.name && <p className="text-sm text-destructive">{state.errors.name}</p>}
      {state.message && <p className="text-sm text-destructive">{state.message}</p>}
      {state.token && (
        <div className="space-y-2 rounded-md border border-amber-400 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Copialo ahora: no se vuelve a mostrar.</p>
          <code className="block overflow-x-auto rounded bg-background p-2 text-xs">{state.token}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(state.token!).then(() => toast.success("Token copiado"))}
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted"
          >
            Copiar
          </button>
        </div>
      )}
    </div>
  );
}
