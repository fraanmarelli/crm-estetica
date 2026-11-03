import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente con permisos totales. SOLO para el servidor y siempre después de
// verificar en código que el usuario tiene permiso para lo que se va a hacer.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
