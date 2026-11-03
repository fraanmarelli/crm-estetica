import { createClient } from "@/lib/supabase/server";
import type { Professional, Treatment } from "@/lib/types";

export async function loadCatalog(orgId: string, branchId: string) {
  const supabase = await createClient();
  const [{ data: treatments }, { data: professionals }] = await Promise.all([
    supabase
      .from("treatments")
      .select("id, name, category, recall_days, default_price, unit_label")
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
    treatments: (treatments ?? []) as Treatment[],
    professionals: (professionals ?? []) as Professional[],
  };
}
