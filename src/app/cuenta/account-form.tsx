"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialActionState } from "@/server/action-result";
import { updateAccount } from "./actions";

export function AccountForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(updateAccount, initialActionState);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="display_name">Nombre visible</Label>
        <Input id="display_name" name="display_name" defaultValue={displayName} required />
        {state.errors?.display_name && <p className="text-sm text-destructive">{state.errors.display_name}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Nueva contraseña (opcional)</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" />
        {state.errors?.password && <p className="text-sm text-destructive">{state.errors.password}</p>}
      </div>
      {state.message && <p className={state.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{state.message}</p>}
      <Button type="submit" disabled={pending}>Guardar</Button>
    </form>
  );
}
