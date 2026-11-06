"use server";

import { revalidatePath } from "next/cache";
import { requireManagerContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";

// Marcar un cambio de recepción como revisado (o todos los de la sucursal). La base verifica que sea
// franquiciado o marca (RLS).
export async function markChangeReviewed(formData: FormData) {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const query = supabase
    .from("change_alerts")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: ctx.userId })
    .eq("branch_id", ctx.currentBranch.id)
    .is("reviewed_at", null);
  await (id === "all" ? query : query.eq("id", id));
  revalidatePath("/cambios");
  revalidatePath("/");
}
