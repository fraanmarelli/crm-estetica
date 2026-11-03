"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireNetworkContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";

const parseMoney = (v: unknown): number | null | "invalid" => {
  const s = String(v ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
};

// Solo la marca edita insumos y costos (RLS lo garantiza también)
export async function saveSupplyCosts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireNetworkContext();
  let rows: { id: string; unit_cost: string; unit: string }[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los costos." };
  }

  const supabase = await createClient();
  for (const r of rows) {
    const cost = parseMoney(r.unit_cost);
    if (cost === "invalid") return { error: "Hay un costo que no es un número válido." };
    const { error } = await supabase
      .from("supplies")
      .update({ unit_cost: cost, unit: r.unit.trim() || "unidad" })
      .eq("id", r.id);
    if (error) return { error: `No se pudo guardar: ${error.message}` };
  }

  revalidatePath("/insumos");
  return { ok: "Costos guardados. Se aplican a los turnos que se registren desde ahora." };
}

export async function createSupply(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireNetworkContext();
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || "unidad";
  const cost = parseMoney(formData.get("unit_cost"));
  if (!name) return { error: "Poné el nombre del insumo." };
  if (cost === "invalid") return { error: "El costo no es un número válido." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("supplies")
    .insert({ organization_id: ctx.org.id, name, unit, unit_cost: cost });
  if (error) {
    if (error.code === "23505") return { error: "Ya existe un insumo con ese nombre." };
    return { error: `No se pudo crear: ${error.message}` };
  }
  revalidatePath("/insumos");
  return { ok: "Insumo agregado." };
}

export async function setTreatmentSupply(formData: FormData) {
  await requireNetworkContext();
  const supabase = await createClient();
  const supplyId = String(formData.get("supply_id") ?? "");
  await supabase
    .from("treatments")
    .update({ supply_id: supplyId || null })
    .eq("id", String(formData.get("treatment_id") ?? ""));
  revalidatePath("/insumos");
}
