"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { initialActionState, type ActionState } from "@/server/action-result";

const ErrorsContext = createContext<Record<string, string>>({});
const PendingContext = createContext(false);

/**
 * Formulario que llama a una server action con useActionState.
 * Los campos leen sus errores del contexto; el mensaje general va a un toast.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    } else if (state.message) {
      toast.error(state.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ErrorsContext.Provider value={state.errors ?? {}}>
      <PendingContext.Provider value={pending}>
      {/* onSubmit en lugar de action={...}: React 19 vacía el formulario tras cada envío,
          y ante un error de validación no queremos perder lo cargado. */}
      <form
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
        className={cn("space-y-4", className)}
        noValidate
      >
        {state.message && !state.ok && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.message}</p>
        )}
        {children}
      </form>
      </PendingContext.Provider>
    </ErrorsContext.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const errors = useContext(ErrorsContext);
  if (!errors[name]) return null;
  return <p className="text-sm text-destructive">{errors[name]}</p>;
}

export function SubmitButton({ children, className, variant }: { children: ReactNode; className?: string; variant?: "default" | "outline" | "secondary" | "destructive" }) {
  const pending = useContext(PendingContext);
  return (
    <Button type="submit" disabled={pending} className={cn("h-10", className)} variant={variant}>
      {pending ? "Guardando…" : children}
    </Button>
  );
}
