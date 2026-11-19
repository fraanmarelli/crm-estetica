"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContactContext, requireManagerContext } from "@/lib/context";
import type { ActionState } from "@/lib/types";
import {
  ArcaError,
  CBTE_FACTURA_C,
  CBTE_NOTA_CREDITO_C,
  CONCEPTS,
  DOC_TYPES,
  arDate,
  isValidCuit,
  linesTotal,
  onlyDigits,
  validateInvoice,
  type DocKey,
  type InvoiceLine,
} from "@/lib/arca/core";
import { createKeyAndCsr, readCertificate } from "@/lib/arca/crypto";
import { emitInvoice, recoverInvoice, testConnection, type ArcaConnection } from "@/lib/arca/arca";

const CONN_COLUMNS =
  "id, organization_id, branch_id, holder_id, environment, cuit, business_name, address, iibb, activity_start, point_of_sale, status";

// Quién está usando la app, para dejarlo en la factura
async function whoAmI() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  const name = (u?.user_metadata?.full_name as string | undefined)?.trim() || u?.email || "Equipo";
  return { id: u?.id ?? "", name };
}

// Antes de usar el service role: el permiso real en la base (no el de «Ver como»)
async function canOperate(branchId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_operate_branch", { p_branch: branchId });
  return data === true;
}
async function canManage(branchId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_branch_admin", { p_branch: branchId });
  return data === true;
}

function arcaMessage(e: unknown): string {
  if (e instanceof ArcaError) return e.message;
  return "Algo falló hablando con ARCA. Probá de nuevo en unos minutos.";
}

// ======================= Conectar un titular (Ajustes → Factura electrónica) =======================

export async function startArcaConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  if (!(await canManage(ctx.currentBranch.id))) return { error: "Solo el franquiciado o la marca conectan ARCA." };
  const holderId = String(formData.get("holder_id") ?? "");
  const cuit = onlyDigits(String(formData.get("cuit") ?? ""));
  const businessName = String(formData.get("business_name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const iibb = String(formData.get("iibb") ?? "").trim() || null;
  const activityStart = String(formData.get("activity_start") ?? "").trim() || null;
  const pos = Number(formData.get("point_of_sale"));
  const environment = formData.get("environment") === "prod" ? "prod" : "test";
  const values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));

  if (!isValidCuit(cuit)) return { error: "El CUIT no es válido (son 11 números).", values };
  if (!businessName) return { error: "Falta el nombre o razón social como figura en ARCA.", values };
  if (!address) return { error: "Falta el domicilio comercial (va impreso en la factura).", values };
  if (!Number.isInteger(pos) || pos < 1 || pos > 99998)
    return { error: "El punto de venta es un número (el que creaste como «Web Services» en ARCA).", values };
  if (activityStart && !/^\d{4}-\d{2}-\d{2}$/.test(activityStart)) return { error: "La fecha de inicio de actividades no es válida.", values };

  const admin = createAdminClient();
  const { data: holder } = await admin
    .from("account_holders")
    .select("id, branch_id, organization_id")
    .eq("id", holderId)
    .maybeSingle();
  if (!holder || holder.branch_id !== ctx.currentBranch.id) return { error: "Ese titular no es de esta sucursal.", values };

  const { data: existing } = await admin
    .from("arca_connections")
    .select("id, environment, cuit")
    .eq("holder_id", holderId)
    .maybeSingle();
  // Mismo CUIT y mismo ambiente: solo se actualizan los datos, el certificado sigue valiendo
  const keepCert = existing && existing.environment === environment && existing.cuit === cuit;

  const row = {
    organization_id: holder.organization_id,
    branch_id: holder.branch_id,
    holder_id: holderId,
    environment,
    cuit,
    business_name: businessName,
    address,
    iibb,
    activity_start: activityStart,
    point_of_sale: pos,
    updated_at: new Date().toISOString(),
    ...(keepCert ? {} : { status: "needs_cert", cert_expires_at: null, last_error: null, last_checked_at: null }),
  };
  const { data: conn, error } = existing
    ? await admin.from("arca_connections").update(row).eq("id", existing.id).select("id").single()
    : await admin.from("arca_connections").insert(row).select("id").single();
  if (error || !conn) return { error: `No se pudo guardar: ${error?.message ?? "error"}`, values };

  if (!keepCert) {
    const alias = `crm-${ctx.currentBranch.name}-${cuit}`
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .toLowerCase()
      .slice(0, 40);
    const { privateKeyPem, csrPem } = createKeyAndCsr({ cuit, businessName, alias });
    const { error: secErr } = await admin.from("arca_secrets").upsert({
      connection_id: conn.id,
      private_key: privateKeyPem,
      csr: csrPem,
      certificate: null,
      token: null,
      sign: null,
      token_expires_at: null,
      updated_at: new Date().toISOString(),
    });
    if (secErr) return { error: `No se pudo crear el pedido de certificado: ${secErr.message}`, values };
  }
  revalidatePath("/ajustes");
  return { ok: keepCert ? "Datos guardados." : "Listo. Ahora descargá el pedido de certificado y seguí los pasos." };
}

export async function uploadArcaCertificate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  if (!(await canManage(ctx.currentBranch.id))) return { error: "Solo el franquiciado o la marca conectan ARCA." };
  const connectionId = String(formData.get("connection_id") ?? "");
  const file = formData.get("certificate_file");
  let pem = String(formData.get("certificate_text") ?? "").trim();
  if (!pem && file instanceof File && file.size > 0) {
    if (file.size > 20_000) return { error: "Ese archivo es muy grande para ser un certificado (.crt)." };
    pem = (await file.text()).trim();
  }
  if (!pem) return { error: "Elegí el archivo .crt que te dio ARCA (o pegá su contenido)." };

  const admin = createAdminClient();
  const { data: conn } = await admin.from("arca_connections").select(CONN_COLUMNS).eq("id", connectionId).maybeSingle();
  if (!conn || conn.branch_id !== ctx.currentBranch.id) return { error: "Esa conexión no es de esta sucursal." };
  const { data: sec } = await admin.from("arca_secrets").select("private_key").eq("connection_id", connectionId).maybeSingle();
  if (!sec) return { error: "Primero generá el pedido de certificado." };

  let info;
  try {
    info = readCertificate(pem, sec.private_key);
  } catch {
    return { error: "Eso no parece un certificado. Subí el archivo .crt que descargaste de ARCA." };
  }
  if (!info.matchesKey)
    return {
      error:
        "Este certificado no es del último pedido que generó el CRM. Subí en ARCA el pedido (.csr) que descargaste de acá y usá el certificado que te devuelve.",
    };
  if (info.cuit && info.cuit !== conn.cuit) return { error: `El certificado es del CUIT ${info.cuit}, no de ${conn.cuit}.` };
  if (info.notAfter.getTime() < Date.now()) return { error: "Ese certificado ya venció. Pedí uno nuevo en ARCA." };

  await admin
    .from("arca_secrets")
    .update({ certificate: pem, token: null, sign: null, token_expires_at: null, updated_at: new Date().toISOString() })
    .eq("connection_id", connectionId);
  await admin.from("arca_connections").update({ cert_expires_at: info.notAfter.toISOString() }).eq("id", connectionId);

  const res = await runTest(conn as ArcaConnection);
  revalidatePath("/ajustes");
  return res;
}

async function runTest(conn: ArcaConnection): Promise<ActionState> {
  const admin = createAdminClient();
  try {
    const { lastNumber } = await testConnection(admin, conn);
    await admin
      .from("arca_connections")
      .update({ status: "ready", last_error: null, last_checked_at: new Date().toISOString() })
      .eq("id", conn.id);
    return {
      ok: `Conectado con ARCA. ${lastNumber === 0 ? "Todavía no hay facturas en ese punto de venta." : `La última Factura C de ese punto de venta es la ${lastNumber}.`}`,
    };
  } catch (e) {
    const msg = arcaMessage(e);
    await admin
      .from("arca_connections")
      .update({ status: "error", last_error: msg, last_checked_at: new Date().toISOString() })
      .eq("id", conn.id);
    return { error: msg };
  }
}

export async function testArcaConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  if (!(await canManage(ctx.currentBranch.id))) return { error: "Solo el franquiciado o la marca conectan ARCA." };
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("arca_connections")
    .select(CONN_COLUMNS)
    .eq("id", String(formData.get("connection_id") ?? ""))
    .maybeSingle();
  if (!conn || conn.branch_id !== ctx.currentBranch.id) return { error: "Esa conexión no es de esta sucursal." };
  const res = await runTest(conn as ArcaConnection);
  revalidatePath("/ajustes");
  return res;
}

export async function disconnectArca(formData: FormData) {
  const ctx = await requireManagerContext();
  if (!(await canManage(ctx.currentBranch.id))) return;
  const admin = createAdminClient();
  const id = String(formData.get("connection_id") ?? "");
  const { data: conn } = await admin.from("arca_connections").select("branch_id").eq("id", id).maybeSingle();
  if (!conn || conn.branch_id !== ctx.currentBranch.id) return;
  // Las facturas emitidas quedan (connection_id pasa a null); se borra la clave y el certificado
  await admin.from("arca_connections").delete().eq("id", id);
  revalidatePath("/ajustes");
}

// ======================= Emitir =======================

export async function issueInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireContactContext();
  const values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  if (!(await canOperate(ctx.currentBranch.id))) return { error: "No tenés permiso para facturar en esta sucursal.", values };

  let lines: InvoiceLine[] = [];
  try {
    lines = (JSON.parse(String(formData.get("lines") ?? "[]")) as InvoiceLine[]).map((l) => ({
      description: String(l.description ?? "").trim().slice(0, 200),
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
    }));
  } catch {
    return { error: "No se pudieron leer las líneas de la factura.", values };
  }
  const docKey = (String(formData.get("doc_type") ?? "ninguno") as DocKey) in DOC_TYPES
    ? (String(formData.get("doc_type")) as DocKey)
    : "ninguno";
  const docNumber = onlyDigits(String(formData.get("doc_number") ?? ""));
  const ivaCondition = Number(formData.get("iva_condition") ?? 5);
  const concept = formData.get("concept") === "servicios" ? CONCEPTS.servicios : CONCEPTS.productos;
  const receiverName = String(formData.get("receiver_name") ?? "").trim().slice(0, 120) || null;
  const invalid = validateInvoice({ lines, docType: docKey, docNumber, ivaCondition });
  if (invalid) return { error: invalid, values };
  if (lines.length > 15) return { error: "Hasta 15 líneas por factura.", values };

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("arca_connections")
    .select(CONN_COLUMNS)
    .eq("id", String(formData.get("connection_id") ?? ""))
    .maybeSingle();
  if (!conn || conn.branch_id !== ctx.currentBranch.id) return { error: "Elegí quién factura.", values };
  if (conn.status !== "ready")
    return { error: "Ese titular todavía no está conectado con ARCA (Ajustes → Factura electrónica).", values };

  // Factura de un turno: tiene que ser de esta sucursal y estar atendido
  const appointmentId = String(formData.get("appointment_id") ?? "") || null;
  let patientId: string | null = null;
  let serviceDay: string | undefined;
  const today = arDate();
  if (appointmentId) {
    const { data: appt } = await admin
      .from("appointments")
      .select("id, branch_id, patient_id, status, scheduled_at")
      .eq("id", appointmentId)
      .maybeSingle();
    if (!appt || appt.branch_id !== ctx.currentBranch.id) return { error: "Ese turno no es de esta sucursal.", values };
    if (appt.status !== "completed") return { error: "Solo se factura un turno atendido.", values };
    patientId = appt.patient_id;
    const day = arDate(new Date(appt.scheduled_at));
    serviceDay = day <= today ? day : today;
  }

  const me = await whoAmI();
  let result;
  try {
    result = await emitInvoice(admin, conn as ArcaConnection, {
      cbteTipo: CBTE_FACTURA_C,
      date: today,
      concept,
      docType: DOC_TYPES[docKey],
      docNumber,
      docNumberRaw: docNumber,
      total: linesTotal(lines),
      ivaCondition,
      serviceFrom: serviceDay,
      serviceTo: serviceDay,
      paymentDue: today,
      appointmentId,
      patientId,
      receiverName,
      lines,
      cancelsInvoiceId: null,
      createdBy: me.id,
      createdByName: me.name,
    });
  } catch (e) {
    return { error: arcaMessage(e), values };
  }
  revalidatePath("/facturacion");
  if (appointmentId) revalidatePath(`/turnos/${appointmentId}`);
  redirect(`/facturas/${result.id}?emitida=1`);
}

// Anular = Nota de Crédito C por el total, asociada a la factura
export async function cancelInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  if (!(await canManage(ctx.currentBranch.id))) return { error: "Solo el franquiciado o la marca anulan facturas." };
  if (formData.get("confirm") !== "on") return { error: "Marcá la casilla para confirmar." };
  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select(
      "id, branch_id, connection_id, appointment_id, patient_id, cbte_tipo, point_of_sale, number, status, issue_date, concept, service_from, service_to, doc_type, doc_number, iva_condition, receiver_name, total, lines, cuit",
    )
    .eq("id", String(formData.get("invoice_id") ?? ""))
    .maybeSingle();
  if (!inv || inv.branch_id !== ctx.currentBranch.id) return { error: "Esa factura no es de esta sucursal." };
  if (inv.cbte_tipo !== CBTE_FACTURA_C || inv.status !== "issued") return { error: "Solo se anula una factura emitida." };
  if (!inv.connection_id) return { error: "El titular de esta factura ya no está conectado con ARCA." };
  const { data: conn } = await admin.from("arca_connections").select(CONN_COLUMNS).eq("id", inv.connection_id).maybeSingle();
  if (!conn || conn.status !== "ready") return { error: "Ese titular no está conectado con ARCA ahora. Probá la conexión en Ajustes." };

  const me = await whoAmI();
  const today = arDate();
  let result;
  try {
    result = await emitInvoice(admin, conn as ArcaConnection, {
      cbteTipo: CBTE_NOTA_CREDITO_C,
      date: today,
      concept: inv.concept,
      docType: inv.doc_type,
      docNumber: inv.doc_number ?? "",
      docNumberRaw: inv.doc_number ?? "",
      total: Number(inv.total),
      ivaCondition: inv.iva_condition,
      serviceFrom: inv.service_from ?? undefined,
      serviceTo: inv.service_to ?? undefined,
      paymentDue: today,
      associated: {
        cbteTipo: CBTE_FACTURA_C,
        pointOfSale: inv.point_of_sale,
        number: Number(inv.number),
        cuit: inv.cuit,
        date: inv.issue_date,
      },
      appointmentId: inv.appointment_id,
      patientId: inv.patient_id,
      receiverName: inv.receiver_name,
      lines: inv.lines as InvoiceLine[],
      cancelsInvoiceId: inv.id,
      createdBy: me.id,
      createdByName: me.name,
    });
  } catch (e) {
    return { error: arcaMessage(e) };
  }
  revalidatePath("/facturacion");
  redirect(`/facturas/${result.id}?emitida=1`);
}

// Una «por confirmar» (se cortó la conexión): se le pregunta a ARCA si salió
export async function recheckInvoice(formData: FormData) {
  const ctx = await requireContactContext();
  if (!(await canOperate(ctx.currentBranch.id))) return;
  const admin = createAdminClient();
  const id = String(formData.get("invoice_id") ?? "");
  const { data: inv } = await admin.from("invoices").select("id, branch_id, connection_id, status").eq("id", id).maybeSingle();
  if (!inv || inv.branch_id !== ctx.currentBranch.id || inv.status !== "pending" || !inv.connection_id) return;
  const { data: conn } = await admin.from("arca_connections").select(CONN_COLUMNS).eq("id", inv.connection_id).maybeSingle();
  if (!conn) return;
  await recoverInvoice(admin, conn as ArcaConnection, inv.id).catch(() => null);
  revalidatePath(`/facturas/${id}`);
  revalidatePath("/facturacion");
}
