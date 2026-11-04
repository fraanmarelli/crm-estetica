"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";

const pctOrNull = (v: unknown) => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

// ---------------- Profesionales ----------------
export async function saveProfessionals(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManagerContext();
  let rows: { id: string; full_name: string; commission_pct: string; is_active: boolean }[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los datos." };
  }
  const supabase = await createClient();
  for (const r of rows) {
    const pct = pctOrNull(r.commission_pct);
    if (pct === null) return { error: `La comisión de ${r.full_name} tiene que ser un porcentaje entre 0 y 100.` };
    if (!r.full_name.trim()) return { error: "Cada profesional necesita un nombre." };
    const { error } = await supabase
      .from("professionals")
      .update({ full_name: r.full_name.trim(), commission_pct: pct, is_active: r.is_active })
      .eq("id", r.id);
    if (error) return { error: `No se pudo guardar: ${error.message}` };
  }
  revalidatePath("/ajustes");
  return { ok: "Profesionales guardados. El nuevo porcentaje se aplica a los turnos que se registren desde ahora." };
}

export async function createProfessional(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const name = String(formData.get("full_name") ?? "").trim();
  const pct = pctOrNull(formData.get("commission_pct"));
  if (!name) return { error: "Poné el nombre del profesional." };
  if (pct === null) return { error: "La comisión tiene que ser un porcentaje entre 0 y 100." };

  const supabase = await createClient();
  const { error } = await supabase.from("professionals").insert({
    organization_id: ctx.org.id,
    branch_id: ctx.currentBranch.id,
    full_name: name,
    license_number: String(formData.get("license_number") ?? "").trim() || null,
    commission_pct: pct,
  });
  if (error) return { error: `No se pudo crear: ${error.message}` };
  revalidatePath("/ajustes");
  return { ok: "Profesional agregado." };
}

// ---------------- Cuentas de cobro ----------------
export async function saveAccounts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManagerContext();
  let rows: { id: string; name: string; currency: string; is_active: boolean }[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los datos." };
  }
  const supabase = await createClient();
  for (const r of rows) {
    if (!r.name.trim()) return { error: "Cada cuenta necesita un nombre." };
    const { error } = await supabase
      .from("payment_accounts")
      .update({ name: r.name.trim(), currency: r.currency === "USD" ? "USD" : "ARS", is_active: r.is_active })
      .eq("id", r.id);
    if (error) {
      if (error.code === "23505") return { error: `Ya hay otra cuenta llamada «${r.name}».` };
      return { error: `No se pudo guardar: ${error.message}` };
    }
  }
  revalidatePath("/ajustes");
  revalidatePath("/facturacion");
  return { ok: "Cuentas guardadas." };
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const name = String(formData.get("name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "ARS") === "USD" ? "USD" : "ARS";
  if (!name) return { error: "Poné el nombre de la cuenta." };

  const supabase = await createClient();
  const { error } = await supabase.from("payment_accounts").insert({
    organization_id: ctx.org.id,
    branch_id: ctx.currentBranch.id,
    name,
    currency,
    sort_order: 500,
  });
  if (error) {
    if (error.code === "23505") return { error: "Ya existe una cuenta con ese nombre." };
    return { error: `No se pudo crear: ${error.message}` };
  }
  revalidatePath("/ajustes");
  revalidatePath("/facturacion");
  return { ok: "Cuenta agregada. Su titular para el monotributo se elige en Facturación." };
}
