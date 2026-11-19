"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURE_KEYS, requireNetworkContext } from "@/lib/context";
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

// Funciones de una sede (solo la marca; RLS de branches lo vuelve a verificar)
export async function setBranchFeatures(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireNetworkContext();
  const branchId = String(formData.get("branch_id") ?? "");
  const branch = ctx.branches.find((b) => b.id === branchId);
  if (!branch) return { error: "No se encontró la sucursal." };

  const disabled = FEATURE_KEYS.filter((k) => formData.get(`on_${k}`) !== "on");
  const supabase = await createClient();
  const { data: before } = await supabase.from("branches").select("disabled_features").eq("id", branchId).single();
  const { error } = await supabase.from("branches").update({ disabled_features: disabled }).eq("id", branchId);
  if (error) return { error: `No se pudo guardar: ${error.message}` };

  // Mercado Pago recién apagado: los cobros que esperaban verificación dejan de esperarla
  // (permiso verificado arriba: solo la marca llega acá; los chequeos los escribe solo el servidor)
  const wasOn = !((before?.disabled_features as string[] | null) ?? []).includes("mp");
  if (wasOn && disabled.includes("mp")) {
    await createAdminClient().from("transfer_checks").delete().eq("branch_id", branchId).eq("status", "pending");
  }

  revalidatePath("/", "layout");
  return {
    ok: disabled.length
      ? `Guardado. En ${branch.name} quedaron apagadas: ${disabled.length} ${disabled.length === 1 ? "función" : "funciones"}.`
      : `Guardado. ${branch.name} tiene todas las funciones prendidas.`,
  };
}
