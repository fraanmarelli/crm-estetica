"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

// Crea una promo. La marca elige toda la red o la sucursal activa; el franquiciado, solo la suya.
// La base vuelve a verificar quién puede crear qué (RLS).
export async function createPromotion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const name = str(formData, "name");
  const price = Number(str(formData, "price").replace(/\./g, "").replace(",", "."));
  const validUntil = str(formData, "valid_until");
  const scope = str(formData, "scope");
  const values: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  });

  let items: { treatment_id: string; zone: string }[] = [];
  try {
    items = JSON.parse(str(formData, "items") || "[]");
  } catch {
    return { error: "No se pudieron leer los tratamientos.", values };
  }
  items = items.filter((i) => i.treatment_id);

  if (!name) return { error: "Poné un nombre para la promo.", values };
  if (!Number.isFinite(price) || price <= 0) return { error: "El precio tiene que ser un monto mayor a 0.", values };
  if (items.length === 0) return { error: "Elegí al menos un tratamiento.", values };
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { error: "La fecha de vencimiento no es válida.", values };

  const branchId = ctx.isNetwork && scope === "network" ? null : ctx.currentBranch.id;
  const supabase = await createClient();
  const { data: promo, error } = await supabase
    .from("promotions")
    .insert({
      organization_id: ctx.org.id,
      branch_id: branchId,
      name,
      price,
      valid_until: validUntil || null,
    })
    .select("id")
    .single();
  if (error) return { error: `No se pudo crear la promo: ${error.message}`, values };

  const { error: itemsError } = await supabase.from("promotion_items").insert(
    items.map((i, index) => ({
      organization_id: ctx.org.id,
      promotion_id: promo.id,
      treatment_id: i.treatment_id,
      zone: i.zone?.trim() || null,
      sort_order: index,
    })),
  );
  if (itemsError) {
    await supabase.from("promotions").delete().eq("id", promo.id);
    return { error: `No se pudieron guardar los tratamientos: ${itemsError.message}`, values };
  }

  revalidatePath("/promos");
  return { ok: `Promo «${name}» creada. Ya aparece al cargar un turno.` };
}

export async function togglePromotion(formData: FormData) {
  await requireManagerContext();
  const supabase = await createClient();
  // RLS: la de la red solo la toca la marca; la de una sucursal, su franquiciado o la marca
  await supabase
    .from("promotions")
    .update({ is_active: str(formData, "active") === "1" })
    .eq("id", str(formData, "id"));
  revalidatePath("/promos");
}
