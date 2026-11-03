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
};

export function canManageBranch(ctx: Pick<AppContext, "isNetwork" | "memberships">, branchId: string): boolean {
  return (
    ctx.isNetwork ||
    ctx.memberships.some((m) => m.branch_id === branchId && m.role === "branch_admin")
  );
}

// Una sola consulta por request, aunque varios componentes la pidan.
export const getContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, branch_id, role")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) return null;

  // v1: una organización por usuario. Multi-organización = elegir org por cookie.
  const orgId = memberships[0].organization_id as string;
  const own = (memberships as Membership[]).filter((m) => m.organization_id === orgId);

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, currency, loyalty_points_per_1000, settings")
    .eq("id", orgId)
    .single();
  if (!org) return null;

  const isNetwork = own.some((m) => m.role === "network_owner" || m.role === "network_admin");

  let branchQuery = supabase
    .from("branches")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (!isNetwork) {
    const ids = own.map((m) => m.branch_id).filter((id): id is string => Boolean(id));
    branchQuery = branchQuery.in("id", ids);
  }
  const { data: branches } = await branchQuery;
  const list = (branches ?? []) as Branch[];

  const cookieStore = await cookies();
  const wanted = cookieStore.get(BRANCH_COOKIE)?.value;
  const currentBranch = list.find((b) => b.id === wanted) ?? list[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    org: org as Organization,
    memberships: own,
    isNetwork,
    roles: own.map((m) => m.role),
    branches: list,
    currentBranch,
    canManageCurrentBranch: currentBranch
      ? canManageBranch({ isNetwork, memberships: own }, currentBranch.id)
      : false,
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

export async function requireNetworkContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx || !ctx.isNetwork) redirect("/");
  return ctx;
}
