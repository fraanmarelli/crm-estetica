import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import type { PaymentAccount, Professional, Promotion, Treatment } from "@/lib/types";

// Catálogo de la marca (con el insumo que usa cada tratamiento), profesionales, cuentas de cobro
// y promos vigentes (de la red y de la sucursal) para cargar un turno.
export async function loadCatalog(orgId: string, branchId: string) {
  const supabase = await createClient();
  const today = todayISO();
  const [{ data: treatments }, { data: professionals }, { data: accounts }, { data: promotions }] = await Promise.all([
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
    supabase
      .from("payment_accounts")
      .select("id, name, currency")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("promotions")
      .select("id, name, price, branch_id, valid_until, is_active, items:promotion_items(treatment_id, zone, sort_order)")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .or(`branch_id.is.null,branch_id.eq.${branchId}`)
      .order("name"),
  ]);
  return {
    treatments: (treatments ?? []) as unknown as Treatment[],
    professionals: (professionals ?? []) as Professional[],
    accounts: (accounts ?? []) as PaymentAccount[],
    // Vigentes: sin vencimiento o que vencen hoy o después; un combo sin tratamientos no se ofrece
    promotions: ((promotions ?? []) as Promotion[]).filter(
      (p) => p.items.length > 0 && (!p.valid_until || p.valid_until >= today),
    ),
  };
}
