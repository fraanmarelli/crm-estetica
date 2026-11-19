"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

// Contraseña nueva (después del link de recuperación, o desde la sesión iniciada)
export async function setNewPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const password2 = String(formData.get("password2") ?? "");
  if (password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  if (password !== password2) return { error: "Las contraseñas no coinciden." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "El link venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?»." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (/different|same/i.test(error.message)) return { error: "Elegí una contraseña distinta de la anterior." };
    if (/weak|short|characters/i.test(error.message)) return { error: "Elegí una contraseña más larga o con números y letras." };
    return { error: "No se pudo cambiar la contraseña. Probá de nuevo." };
  }
  redirect("/?listo=clave");
}
