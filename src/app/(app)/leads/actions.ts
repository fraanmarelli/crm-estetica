"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageBranch, getContext, requireBranchContext } from "@/lib/context";
import { recentLeads, subscribePage, unsubscribePage } from "@/lib/meta-leads";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// Elegir la página de Facebook de la sucursal: se guarda, se suscribe al webhook y se traen los últimos 30 días
export async function finalizeLeadPage(formData: FormData) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const pendingId = str(formData, "pending_id");
  const pageId = str(formData, "page_id");
  const admin = createAdminClient();

  const { data: pending } = await admin
    .from("lead_oauth_pending")
    .select("id, organization_id, branch_id, pages")
    .eq("id", pendingId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  // Permiso verificado en código antes de seguir con el service role
  if (!pending || !canManageBranch(ctx, pending.branch_id)) {
    redirect(`/leads?error=${encodeURIComponent("La conexión venció. Volvé a intentarlo.")}`);
  }
  const page = (pending.pages as { id: string; name: string; access_token: string }[]).find((p) => p.id === pageId);
  if (!page) redirect(`/leads?error=${encodeURIComponent("Elegí una de las páginas de la lista.")}`);

  let imported = 0;
  try {
    await subscribePage(page.id, page.access_token);
    const { data: saved, error } = await admin
      .from("lead_pages")
      .upsert(
        {
          organization_id: pending.organization_id,
          branch_id: pending.branch_id,
          page_id: page.id,
          page_name: page.name,
          connected_by: ctx.userId,
          last_error: null,
          // La revisión cada 5 minutos sigue desde acá (lo anterior lo trae la importación de abajo)
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "page_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await admin
      .from("lead_page_secrets")
      .upsert({ lead_page_id: saved.id, page_token: page.access_token, updated_at: new Date().toISOString() });

    // Los formularios de los últimos 30 días, para no perder los que ya llegaron
    const recent = await recentLeads(page.id, page.access_token, 30).catch(() => []);
    for (let i = 0; i < recent.length; i += 200) {
      const batch = recent.slice(i, i + 200).map((l) => ({
        ...l,
        organization_id: pending.organization_id,
        branch_id: pending.branch_id,
      }));
      const { error: insErr } = await admin
        .from("leads")
        .upsert(batch, { onConflict: "organization_id,external_id", ignoreDuplicates: true });
      if (!insErr) imported += batch.length;
    }
  } catch (err) {
    redirect(`/leads?error=${encodeURIComponent(`Meta respondió: ${err instanceof Error ? err.message : "error"}`)}`);
  } finally {
    await admin.from("lead_oauth_pending").delete().eq("id", pendingId);
  }
  revalidatePath("/leads");
  redirect(`/leads?ok=${encodeURIComponent(`Página «${page.name}» conectada. ${imported} leads de los últimos 30 días importados.`)}`);
}

export async function disconnectLeadPage(formData: FormData) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("lead_pages")
    .select("id, page_id, branch_id")
    .eq("id", str(formData, "id"))
    .maybeSingle();
  if (!page || !canManageBranch(ctx, page.branch_id)) return;
  const admin = createAdminClient();
  const { data: secret } = await admin.from("lead_page_secrets").select("page_token").eq("lead_page_id", page.id).maybeSingle();
  if (secret?.page_token) await unsubscribePage(page.page_id, secret.page_token);
  await admin.from("lead_pages").delete().eq("id", page.id);
  revalidatePath("/leads");
}

const STATUSES = ["new", "contacted", "booked", "lost"];

export async function setLeadStatus(formData: FormData) {
  await requireBranchContext();
  const status = str(formData, "status");
  if (!STATUSES.includes(status)) return;
  const supabase = await createClient();
  // RLS: leads de una sucursal a la que tiene acceso
  await supabase
    .from("leads")
    .update({ status, ...(status === "contacted" ? { contacted_at: new Date().toISOString() } : {}) })
    .eq("id", str(formData, "id"));
  revalidatePath("/leads");
  revalidatePath("/");
}

// Se le escribió por WhatsApp: queda como contactado (si estaba nuevo)
export async function markLeadContacted(id: string) {
  await requireBranchContext();
  const supabase = await createClient();
  await supabase
    .from("leads")
    .update({ status: "contacted", contacted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "new");
  revalidatePath("/leads");
  revalidatePath("/");
}

// Darle turno: si ya es paciente va directo al turno; si no, a la carga rápida con sus datos
export async function bookLead(formData: FormData) {
  await requireBranchContext();
  const id = str(formData, "id");
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("id, patient_id").eq("id", id).maybeSingle();
  if (!lead) return;
  if (lead.patient_id) {
    await supabase.from("leads").update({ status: "booked" }).eq("id", id);
    revalidatePath("/leads");
    redirect(`/turnos/nuevo?paciente=${lead.patient_id}`);
  }
  redirect(`/pacientes/nuevo?turno=1&lead=${id}`);
}
