"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";
import type { Role } from "@/lib/types";

export type InviteState = { error?: string; ok?: string; link?: string; email?: string } | null;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const NETWORK_ROLES: Role[] = ["network_owner", "network_admin"];
const ALL_ROLES: Role[] = ["network_owner", "network_admin", "branch_admin", "reception", "professional"];

async function origin() {
  const h = await headers();
  return (process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
}

// Genera una invitación (link personal). La base vuelve a verificar quién puede invitar qué rol.
export async function createInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Iniciá sesión de nuevo." };
  const email = str(formData, "email").toLowerCase();
  const role = str(formData, "role") as Role;
  const professionalId = str(formData, "professional_id");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el mail." };
  if (!ALL_ROLES.includes(role)) return { error: "Elegí el rol." };

  const isNetworkRole = NETWORK_ROLES.includes(role);
  const branchId = isNetworkRole ? null : str(formData, "branch_id") || ctx.currentBranch?.id || null;
  if (!isNetworkRole && (!branchId || !ctx.branches.some((b) => b.id === branchId))) {
    return { error: "Elegí la sucursal." };
  }
  if ((isNetworkRole || role === "branch_admin") && !ctx.isNetwork) {
    return { error: "Solo la marca puede dar acceso de franquiciado o de marca." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_invites")
    .insert({
      organization_id: ctx.org.id,
      branch_id: branchId,
      email,
      role,
      professional_id: role === "professional" && professionalId ? professionalId : null,
    })
    .select("token")
    .single();
  if (error) {
    return { error: error.message.includes("row-level security") ? "No tenés permiso para invitar con ese rol." : `No se pudo crear: ${error.message}` };
  }

  revalidatePath("/ajustes");
  revalidatePath("/marca");
  return { ok: "Invitación lista. Mandale este link (vence en 7 días y sirve una sola vez).", link: `${await origin()}/invitacion/${data.token}`, email };
}

export async function revokeInvite(formData: FormData) {
  const ctx = await getContext();
  if (!ctx) return;
  const supabase = await createClient();
  // RLS: solo quien puede invitar ese rol
  await supabase
    .from("member_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", str(formData, "id"))
    .is("accepted_at", null);
  revalidatePath("/ajustes");
  revalidatePath("/marca");
}

export type RemoveState = { error?: string } | null;

export async function removeMember(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Iniciá sesión de nuevo." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_membership", { p_membership: str(formData, "id") });
  if (error) return { error: error.message };
  revalidatePath("/ajustes");
  revalidatePath("/marca");
  return null;
}
