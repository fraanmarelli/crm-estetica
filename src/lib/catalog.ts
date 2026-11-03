import { createClient } from "@/lib/supabase/server";
import type { Professional, Treatment } from "@/lib/types";

// Catálogo de la marca (con el insumo que usa cada tratamiento) y profesionales de la sucursal.
export async function loadCatalog(orgId: string, branchId: string) {
  const supabase = await createClient();
  const [{ data: treatments }, { data: professionals }] = await Promise.all([
    supabase
      .from("treatments")
      .select("id, name, category, recall_days, unit_label, supply:supplies(name, unit)")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("professionals")
      .select("id, full_name, branch_id")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .or(`branch_id.is.null,branch_id.eq.${branchId}`)
      .order("full_name"),
  ]);
  return {
    treatments: (treatments ?? []) as unknown as Treatment[],
    professionals: (professionals ?? []) as Professional[],
  };
}
