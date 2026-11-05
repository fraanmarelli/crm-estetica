"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireNetworkContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";

// Nueva sucursal (solo la marca; RLS lo vuelve a verificar). Arranca con cuentas de cobro genéricas.
export async function createBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireNetworkContext();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) return { error: "Poné el nombre de la sucursal (ej. la ciudad o el barrio)." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .insert({ organization_id: ctx.org.id, name, address: address || null });
  if (error) {
    if (error.code === "23505") return { error: `Ya hay una sucursal llamada «${name}».` };
    return { error: `No se pudo crear: ${error.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: `Sucursal «${name}» creada. Ahora invitá a su franquiciado/a.` };
}
