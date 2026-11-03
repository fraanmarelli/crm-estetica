"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageBranch, getContext } from "@/lib/context";
import { triggerMetaSync } from "@/lib/meta";

export async function finalizeAdConnection(formData: FormData) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");

  const pendingId = String(formData.get("pending_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const admin = createAdminClient();

  const { data: pending } = await admin
    .from("ad_oauth_pending")
    .select("branch_id")
    .eq("id", pendingId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!pending || !canManageBranch(ctx, pending.branch_id)) {
    redirect(`/marketing?error=${encodeURIComponent("La conexión venció. Volvé a intentarlo.")}`);
  }

  const { error } = await admin.rpc("finalize_ad_connection", {
    p_pending_id: pendingId,
    p_user: ctx.userId,
    p_account_id: accountId,
  });
  if (error) redirect(`/marketing?error=${encodeURIComponent(error.message)}`);

  await triggerMetaSync();
  revalidatePath("/marketing");
  redirect("/marketing?ok=conectado");
}

export async function disconnectAds(formData: FormData) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const id = String(formData.get("connection_id") ?? "");
  const supabase = await createClient();
  // RLS: solo la marca o el franquiciado de esa sucursal pueden borrarla
  await supabase.from("ad_connections").delete().eq("id", id);
  revalidatePath("/marketing");
}
