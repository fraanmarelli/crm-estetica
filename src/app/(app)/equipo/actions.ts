"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

export type ResetLinkState = { error?: string; link?: string; email?: string } | null;

// «Link para nueva contraseña»: quien puede invitar ese rol genera un link de un solo uso (vence en 1 hora)
// y se lo manda por WhatsApp, como la invitación. No depende del mail de Supabase.
export async function createResetLink(_prev: ResetLinkState, formData: FormData): Promise<ResetLinkState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Iniciá sesión de nuevo." };
  const membershipId = str(formData, "membership_id");
  const branchId = str(formData, "branch_id") || null;

  // La base verifica que quien pide pueda ver este equipo; después, que pueda manejar ese rol
  const supabase = await createClient();
  const { data: members, error } = await supabase.rpc("team_members", { p_org: ctx.org.id, p_branch: branchId });
  if (error) return { error: "No tenés permiso para este equipo." };
  const member = ((members ?? []) as { membership_id: string; user_id: string; email: string; role: Role }[]).find(
    (m) => m.membership_id === membershipId,
  );
  if (!member) return { error: "No se encontró a esa persona en el equipo." };
  if (member.user_id === ctx.userId) return { error: "Para cambiar tu propia contraseña usá «¿Olvidaste tu contraseña?» en el ingreso." };
  const { data: allowed } = await supabase.rpc("can_manage_role", { p_org: ctx.org.id, p_branch: branchId, p_role: member.role });
  if (!allowed) return { error: "No podés generar el link para ese rol." };

  // Recién acá el service role: arma el link de recuperación sin mandar ningún mail
  const admin = createAdminClient();
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email: member.email });
  const hashed = linkData?.properties?.hashed_token;
  if (linkError || !hashed) return { error: "No se pudo generar el link. Probá de nuevo en un rato." };

  const link = `${await origin()}/auth/confirmar?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/nueva-contrasena`;
  return { link, email: member.email };
}
