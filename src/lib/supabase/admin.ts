import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Cliente privilegiado (salta RLS). Uso restringido a operaciones de Auth admin
 * (enviar invitaciones) DESPUÉS de verificar permisos con el cliente del usuario.
 * Nunca para leer o escribir datos de negocio.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY no configurada");
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
