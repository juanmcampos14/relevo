"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/server/action-result";
import { sendMagicLink, signInWithPassword } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, initialActionState);
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, initialActionState);
  const state = mode === "password" ? pwState : linkState;

  return (
    <form action={mode === "password" ? pwAction : linkAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {mode === "password" && (
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      )}
      {state.message && (
        <p role="status" className={state.ok ? "text-sm text-primary" : "text-sm text-destructive"}>
          {state.message}
        </p>
      )}
      <Button type="submit" className="h-10 w-full" disabled={pwPending || linkPending}>
        {mode === "password" ? "Entrar" : "Enviarme un enlace"}
      </Button>
      <button
        type="button"
        className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setMode(mode === "password" ? "link" : "password")}
      >
        {mode === "password" ? "Prefiero entrar con un enlace por email" : "Entrar con contraseña"}
      </button>
    </form>
  );
}
