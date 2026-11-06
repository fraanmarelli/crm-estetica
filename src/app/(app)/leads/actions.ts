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

type LeadPageRow = { id: string; page_id: string; page_name: string | null; organization_id: string; branch_id: string };
type ImportResult = { found: number; added: number; forms: number; error: string | null };

const ACCESS_HINT =
  "Si en Meta ves leads, revisá en business.facebook.com → Configuración → Integraciones → Acceso a clientes potenciales que la app «CRM Estética» (o tu usuario) tenga acceso a esta página.";

// Trae los leads de los últimos 30 días y guarda los que falten (no duplica: único por id de Meta)
async function importRecentLeads(page: LeadPageRow, token: string): Promise<ImportResult> {
  const admin = createAdminClient();
  let found: Awaited<ReturnType<typeof recentLeads>>;
  try {
    found = await recentLeads(page.page_id, token, 30);
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 300) : "Error al leer los formularios";
    // Queda a la vista y la revisión automática vuelve a intentar los últimos 30 días
    await admin.from("lead_pages").update({ last_error: error, last_synced_at: null }).eq("id", page.id);
    return { found: 0, added: 0, forms: 0, error };
  }
  let added = 0;
  for (let i = 0; i < found.leads.length; i += 200) {
    const batch = found.leads.slice(i, i + 200).map((l) => ({
      ...l,
      organization_id: page.organization_id,
      branch_id: page.branch_id,
    }));
    const { data, error } = await admin
      .from("leads")
      .upsert(batch, { onConflict: "organization_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      const msg = `No se pudieron guardar los leads: ${error.message}`.slice(0, 300);
      await admin.from("lead_pages").update({ last_error: msg }).eq("id", page.id);
      return { found: found.leads.length, added, forms: found.forms, error: msg };
    }
    added += data?.length ?? 0;
  }
  await admin.from("lead_pages").update({ last_error: null }).eq("id", page.id);
  return { found: found.leads.length, added, forms: found.forms, error: null };
}

function importMessage(r: ImportResult): { ok?: string; error?: string } {
  if (r.error) return { error: `Meta no dejó leer los formularios: ${r.error}` };
  if (r.forms === 0) return { error: `Meta no muestra ningún formulario de esta página. ${ACCESS_HINT}` };
  if (r.found === 0) {
    return { error: `Se revisaron ${r.forms} formularios y Meta no devolvió leads de los últimos 30 días. ${ACCESS_HINT}` };
  }
  return {
    ok: `${r.added} ${r.added === 1 ? "lead nuevo" : "leads nuevos"} (${r.found} de los últimos 30 días en ${r.forms} ${r.forms === 1 ? "formulario" : "formularios"}).`,
  };
}

const leadsUrl = (m: { ok?: string; error?: string }) =>
  m.error ? `/leads?error=${encodeURIComponent(m.error)}` : `/leads?ok=${encodeURIComponent(m.ok ?? "")}`;

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

  let saved: LeadPageRow;
  try {
    await subscribePage(page.id, page.access_token);
    const { data, error } = await admin
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
      .select("id, page_id, page_name, organization_id, branch_id")
      .single();
    if (error) throw new Error(error.message);
    saved = data as LeadPageRow;
    const { error: secretErr } = await admin
      .from("lead_page_secrets")
      .upsert({ lead_page_id: saved.id, page_token: page.access_token, updated_at: new Date().toISOString() });
    if (secretErr) throw new Error(secretErr.message);
  } catch (err) {
    await admin.from("lead_oauth_pending").delete().eq("id", pendingId);
    redirect(`/leads?error=${encodeURIComponent(`No se pudo conectar: ${err instanceof Error ? err.message : "error"}`)}`);
  }
  await admin.from("lead_oauth_pending").delete().eq("id", pendingId);

  const result = await importRecentLeads(saved, page.access_token);
  revalidatePath("/leads");
  revalidatePath("/");
  const m = importMessage(result);
  redirect(leadsUrl(m.ok ? { ok: `Página «${page.name}» conectada. ${m.ok}` } : m));
}

export type LeadPageState = { error?: string } | null;

// Página conectada de la sucursal, verificando el permiso en código antes de usar el service role
async function managedLeadPage(id: string) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("lead_pages")
    .select("id, page_id, page_name, organization_id, branch_id")
    .eq("id", id)
    .maybeSingle();
  if (!page || !canManageBranch(ctx, page.branch_id)) return null;
  return page as LeadPageRow;
}

// «Volver a importar»: busca de nuevo los últimos 30 días con el token guardado (sin pasar por Facebook)
export async function reimportLeads(_prev: LeadPageState, formData: FormData): Promise<LeadPageState> {
  const page = await managedLeadPage(str(formData, "id"));
  if (!page) return { error: "Solo el franquiciado o la marca pueden importar leads." };
  const admin = createAdminClient();
  const { data: secret } = await admin.from("lead_page_secrets").select("page_token").eq("lead_page_id", page.id).maybeSingle();
  if (!secret?.page_token) return { error: "Falta el permiso de la página. Desconectala y volvé a conectarla." };
  const result = await importRecentLeads(page, secret.page_token);
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(leadsUrl(importMessage(result)));
}

export async function disconnectLeadPage(_prev: LeadPageState, formData: FormData): Promise<LeadPageState> {
  const page = await managedLeadPage(str(formData, "id"));
  if (!page) return { error: "Solo el franquiciado o la marca pueden desconectar la página." };
  const admin = createAdminClient();
  const { data: secret } = await admin.from("lead_page_secrets").select("page_token").eq("lead_page_id", page.id).maybeSingle();
  if (secret?.page_token) await unsubscribePage(page.page_id, secret.page_token);
  const { error } = await admin.from("lead_pages").delete().eq("id", page.id);
  if (error) return { error: `No se pudo desconectar: ${error.message}` };
  revalidatePath("/leads");
  redirect(`/leads?ok=${encodeURIComponent(`Página «${page.page_name ?? ""}» desconectada. Los leads que ya estaban quedan en la lista.`)}`);
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

// Se le escribió por WhatsApp (primera vez o de nuevo): queda quién, cuándo y cuántas veces
export async function markLeadContacted(id: string) {
  await requireBranchContext();
  const supabase = await createClient();
  // RLS: solo leads de una sucursal a la que tiene acceso
  await supabase.rpc("mark_lead_contacted", { p_lead: id });
  revalidatePath("/leads");
  revalidatePath("/");
}

// «Deshacer»: se abrió WhatsApp pero no se mandó el mensaje
export async function undoLeadContacted(id: string) {
  await requireBranchContext();
  const supabase = await createClient();
  await supabase.rpc("undo_lead_contacted", { p_lead: id });
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
