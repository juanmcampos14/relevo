"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Invitaciones con la plantilla por defecto de Supabase: la sesión llega en el
// fragmento de la URL (#access_token=…), que solo el navegador puede leer.
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      const nextParam = query.get("next") ?? "/";
      const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (!accessToken || !refreshToken) {
        setError(hash.get("error_description") ?? "El enlace no es válido o venció.");
        return;
      }
      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (sessionError) {
        setError("No se pudo iniciar la sesión. Pedí un enlace nuevo.");
        return;
      }
      await supabase.rpc("accept_pending_invitations");
      // Limpia los tokens de la barra de direcciones antes de seguir.
      window.history.replaceState(null, "", window.location.pathname);
      window.location.replace(next);
    }
    void run();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      {error ? (
        <>
          <p className="text-sm text-destructive">{error}</p>
          <a href="/login" className="mt-4 text-sm text-primary underline">Ir a entrar</a>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Entrando…</p>
      )}
    </main>
  );
}
