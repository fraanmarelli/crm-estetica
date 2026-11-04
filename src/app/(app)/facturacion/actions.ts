"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const money = (v: string) => {
  if (v === "") return null;
  const n = Number(v.replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

function readHolder(formData: FormData) {
  const name = str(formData, "name");
  const cuit = str(formData, "cuit").replace(/[^\d]/g, "");
  const limit = money(str(formData, "annual_limit"));
  const pct = Math.trunc(Number(str(formData, "alert_pct") || "80"));
  if (!name) return { error: "Poné el nombre del titular." } as const;
  if (cuit && cuit.length !== 11) return { error: "El CUIT tiene 11 números." } as const;
  if (limit !== null && (Number.isNaN(limit) || limit <= 0)) return { error: "El tope tiene que ser un monto mayor a 0." } as const;
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) return { error: "El aviso es un porcentaje entre 1 y 100." } as const;
  return { name, cuit: cuit || null, annual_limit: limit, alert_pct: pct } as const;
}

// Titulares (RLS: solo franquiciado de la sucursal o la marca)
export async function createHolder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const h = readHolder(formData);
  if ("error" in h) return { error: h.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("account_holders")
    .insert({ organization_id: ctx.org.id, branch_id: ctx.currentBranch.id, ...h });
  if (error) {
    if (error.code === "23505") return { error: `Ya hay un titular llamado «${h.name}».` };
    return { error: `No se pudo guardar: ${error.message}` };
  }
  revalidatePath("/facturacion");
  revalidatePath("/");
  return { ok: `Titular «${h.name}» agregado. Ahora asignale sus cuentas.` };
}

export async function updateHolder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const h = readHolder(formData);
  if ("error" in h) return { error: h.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("account_holders")
    .update(h)
    .eq("id", str(formData, "id"))
    .eq("branch_id", ctx.currentBranch.id);
  if (error) {
    if (error.code === "23505") return { error: `Ya hay un titular llamado «${h.name}».` };
    return { error: `No se pudo guardar: ${error.message}` };
  }
  revalidatePath("/facturacion");
  revalidatePath("/");
  return { ok: "Guardado." };
}

export async function deleteHolder(formData: FormData) {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  // Sus cuentas quedan sin titular (no se borra ningún cobro)
  await supabase.from("account_holders").delete().eq("id", str(formData, "id")).eq("branch_id", ctx.currentBranch.id);
  revalidatePath("/facturacion");
  revalidatePath("/");
}

// Qué titular tiene cada cuenta
export async function assignHolders(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  let rows: { account_id: string; holder_id: string }[] = [];
  try {
    rows = JSON.parse(str(formData, "rows") || "[]");
  } catch {
    return { error: "No se pudieron leer los datos." };
  }
  const supabase = await createClient();
  for (const r of rows) {
    const { error } = await supabase
      .from("payment_accounts")
      .update({ holder_id: r.holder_id || null })
      .eq("id", r.account_id)
      .eq("branch_id", ctx.currentBranch.id);
    if (error) return { error: `No se pudo guardar: ${error.message}` };
  }
  revalidatePath("/facturacion");
  revalidatePath("/");
  return { ok: "Titulares de las cuentas guardados." };
}
