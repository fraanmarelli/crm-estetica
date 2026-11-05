"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AcceptState = { error?: string; done?: string } | null;

// Aceptar una invitación (página pública). El token es la credencial: se valida y recién
// ahí se usa el service role para crear el usuario y darle el acceso.
export async function acceptInvite(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const password2 = String(formData.get("password2") ?? "");

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("member_invites")
    .select("id, organization_id, branch_id, email, role, professional_id")
    .eq("token", token)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!invite) return { error: "Esta invitación ya se usó, venció o fue anulada. Pedí una nueva." };

  const { data: existingId } = await admin.rpc("auth_user_id_by_email", { p_email: invite.email });
  let userId = existingId as string | null;

  if (!userId) {
    if (password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres." };
    if (password !== password2) return { error: "Las contraseñas no coinciden." };
    const { data: created, error } = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) return { error: "No se pudo crear tu usuario. Probá de nuevo en un rato." };
    userId = created.user.id;
  }

  const { error: memberError } = await admin.from("memberships").upsert(
    { user_id: userId, organization_id: invite.organization_id, branch_id: invite.branch_id, role: invite.role },
    { onConflict: "user_id,organization_id,branch_id", ignoreDuplicates: true },
  );
  if (memberError) return { error: "No se pudo darte el acceso. Avisale a quien te invitó." };

  if (invite.professional_id) {
    await admin
      .from("professionals")
      .update({ user_id: userId })
      .eq("id", invite.professional_id)
      .eq("organization_id", invite.organization_id)
      .is("user_id", null);
  }
  await admin.from("member_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  if (existingId) {
    return { done: "Listo: ya tenés el acceso nuevo. Entrá con tu mail y tu contraseña de siempre." };
  }
  // Usuario nuevo: queda con la sesión iniciada y entra directo
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: invite.email, password });
  redirect("/");
}
