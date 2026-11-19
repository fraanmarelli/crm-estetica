"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

// «¿Olvidaste tu contraseña?»: Supabase manda un mail con un link de un solo uso.
// La respuesta es la misma exista o no el mail, para no revelar quién tiene cuenta.
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el email." };

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirmar?next=/nueva-contrasena`,
  });
  // Demasiados pedidos seguidos: es lo único que se avisa distinto
  if (error && /rate|limit|seconds/i.test(error.message)) {
    return { error: "Ya te mandamos un mail hace un momento. Esperá un minuto y revisá también el spam." };
  }
  return { ok: email };
}
