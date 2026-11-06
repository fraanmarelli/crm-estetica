import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Branch, Membership, Organization, Role } from "@/lib/types";

export const BRANCH_COOKIE = "crm_branch_id";

export type AppContext = {
  userId: string;
  email: string;
  org: Organization;
  memberships: Membership[];
  isNetwork: boolean;
  roles: Role[];
  branches: Branch[];
  currentBranch: Branch | null;
  // Marca o franquiciado de la sucursal activa: ve marketing y configura
  canManageCurrentBranch: boolean;
  // Marca, franquiciado o recepción: trabaja Contactar (leads y recall). Profesionales no.
  canContactCurrentBranch: boolean;
};

export function canManageBranch(ctx: Pick<AppContext, "isNetwork" | "memberships">, branchId: string): boolean {
  return (
    ctx.isNetwork ||
    ctx.memberships.some((m) => m.branch_id === branchId && m.role === "branch_admin")
  );
}

// Se calcula una vez por request aunque lo pidan el layout y la página.
// Todo en una sola vuelta a la base: permisos + organización y sucursales en paralelo.
export const getContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) redirect("/login");
  const userId = claims.sub;

  const [{ data: memberships }, { data: allBranches }, cookieStore] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "organization_id, branch_id, role, organization:organizations(id, name, slug, timezone, currency, loyalty_points_per_1000, settings)",
      )
      .eq("user_id", userId),
    // RLS devuelve solo las sucursales de las organizaciones del usuario
    supabase.from("branches").select("id, name, organization_id").eq("is_active", true).order("name"),
    cookies(),
  ]);

  if (!memberships || memberships.length === 0) return null;

  // v1: una organización por usuario. Multi-organización = elegir org por cookie.
  const first = memberships[0] as unknown as Membership & { organization: Organization | null };
  const org = first.organization;
  if (!org) return null;

  const own = (memberships as unknown as Membership[])
    .filter((m) => m.organization_id === org.id)
    .map(({ organization_id, branch_id, role }) => ({ organization_id, branch_id, role }));
  const isNetwork = own.some((m) => m.role === "network_owner" || m.role === "network_admin");
  const allowed = new Set(own.map((m) => m.branch_id).filter(Boolean));

  const list = ((allBranches ?? []) as (Branch & { organization_id: string })[])
    .filter((b) => b.organization_id === org.id && (isNetwork || allowed.has(b.id)))
    .map(({ id, name }) => ({ id, name }));

  const wanted = cookieStore.get(BRANCH_COOKIE)?.value;
  const currentBranch = list.find((b) => b.id === wanted) ?? list[0] ?? null;

  const canManageCurrentBranch = currentBranch
    ? canManageBranch({ isNetwork, memberships: own }, currentBranch.id)
    : false;

  return {
    userId,
    email: typeof claims.email === "string" ? claims.email : "",
    org,
    memberships: own,
    isNetwork,
    roles: own.map((m) => m.role),
    branches: list,
    currentBranch,
    canManageCurrentBranch,
    canContactCurrentBranch:
      canManageCurrentBranch ||
      (!!currentBranch && own.some((m) => m.branch_id === currentBranch.id && m.role === "reception")),
  };
});

// Para páginas que necesitan sí o sí una sucursal elegida.
export async function requireBranchContext(): Promise<AppContext & { currentBranch: Branch }> {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  if (!ctx.currentBranch) redirect("/");
  return ctx as AppContext & { currentBranch: Branch };
}

export async function requireManagerContext(): Promise<AppContext & { currentBranch: Branch }> {
  const ctx = await requireBranchContext();
  if (!ctx.canManageCurrentBranch) redirect("/");
  return ctx;
}

// Contactar (leads y recall): marca, franquiciado y recepción
export async function requireContactContext(): Promise<AppContext & { currentBranch: Branch }> {
  const ctx = await requireBranchContext();
  if (!ctx.canContactCurrentBranch) redirect("/");
  return ctx;
}

export async function requireNetworkContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx || !ctx.isNetwork) redirect("/");
  return ctx;
}
