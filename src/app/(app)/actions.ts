"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BRANCH_COOKIE, VIEW_AS_COOKIE, getContext, requireBranchContext, requireManagerContext } from "@/lib/context";
import { TZ, localInputToISO } from "@/lib/format";
import type {
  ActionState,
  AppointmentItemInput,
  AppointmentStatus,
  PaymentInput,
  RecallOutcome,
} from "@/lib/types";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v === "" ? null : v);
const valuesOf = (fd: FormData): Record<string, string> => {
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  });
  return out;
};
const qtyOrNull = (v: string) => {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const numOrNull = (v: string) => {
  if (v === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------
// Sucursal activa
// ---------------------------------------------------------------------
export async function setBranch(formData: FormData) {
  const ctx = await getContext();
  const id = str(formData, "branch_id");
  if (ctx && ctx.branches.some((b) => b.id === id)) {
    const cookieStore = await cookies();
    cookieStore.set(BRANCH_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    // La profesional elegida en «Ver como» es de la otra sucursal: se vuelve a la vista de la marca
    if (ctx.viewAs?.role === "professional") cookieStore.delete(VIEW_AS_COOKIE);
  }
  revalidatePath("/", "layout");
}

// «Ver como» (solo la marca): cambia cómo se arma la app, no el usuario ni sus permisos en la base
export async function setViewAs(formData: FormData) {
  const ctx = await getContext();
  if (!ctx?.realIsNetwork || !ctx.currentBranch) redirect("/");
  const value = str(formData, "view_as");
  const cookieStore = await cookies();
  if (value === "branch_admin" || value === "reception") {
    cookieStore.set(VIEW_AS_COOKIE, value, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  } else if (value.startsWith("professional:")) {
    const supabase = await createClient();
    const { data: pro } = await supabase
      .from("professionals")
      .select("id, branch_id")
      .eq("id", value.slice("professional:".length))
      .maybeSingle();
    if (!pro || (pro.branch_id && pro.branch_id !== ctx.currentBranch.id)) redirect("/");
    cookieStore.set(VIEW_AS_COOKIE, `professional:${pro.id}`, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
    });
  } else {
    cookieStore.delete(VIEW_AS_COOKIE);
  }
  revalidatePath("/", "layout");
  // La pantalla actual puede no existir para ese rol: se arranca desde Hoy
  redirect("/");
}

// ---------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------
export type PatientActionState =
  | (ActionState & { duplicates?: { id: string; display_name: string; home_branch: string | null }[] })
  | null;

export async function createPatient(_prev: PatientActionState, formData: FormData): Promise<PatientActionState> {
  const ctx = await requireBranchContext();
  const supabase = await createClient();

  const firstName = str(formData, "first_name");
  const phone = str(formData, "phone");
  const dni = str(formData, "dni");

  if (!firstName) return { error: "El nombre es obligatorio.", values: valuesOf(formData) };
  if (!phone) return { error: "El teléfono es obligatorio: es lo que permite el recall.", values: valuesOf(formData) };
  if (!str(formData, "source")) {
    return { error: "Elegí cómo nos conoció: es lo que permite medir la publicidad.", values: valuesOf(formData) };
  }
  // Carga rápida (para dar un turno sin tenerla presente): queda con la ficha incompleta,
  // sin consentimiento, hasta que ella la complete con su link o en el local
  const quick = str(formData, "quick") === "1";
  if (!quick && formData.get("consent_data") !== "on") {
    return { error: "Falta el consentimiento de la paciente para registrar sus datos.", values: valuesOf(formData) };
  }

  if (formData.get("force") !== "1") {
    const { data: dupes } = await supabase.rpc("find_patients", {
      p_org: ctx.org.id,
      p_phone: phone,
      p_dni: orNull(dni),
    });
    if (dupes && dupes.length > 0) {
      return {
        error: "Ya existe una paciente con ese teléfono o DNI en la red.",
        duplicates: dupes,
        values: valuesOf(formData),
      };
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("patients")
    .insert({
      organization_id: ctx.org.id,
      home_branch_id: ctx.currentBranch.id,
      first_name: firstName,
      last_name: orNull(str(formData, "last_name")),
      phone,
      email: orNull(str(formData, "email")),
      dni: orNull(dni),
      birth_date: orNull(str(formData, "birth_date")),
      address: orNull(str(formData, "address")),
      source: orNull(str(formData, "source")),
      notes: orNull(str(formData, "notes")),
      consent_data_at: quick ? null : now,
      consent_marketing_at: !quick && formData.get("consent_marketing") === "on" ? now : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("phone")) return { error: "El teléfono no es válido.", values: valuesOf(formData) };
    return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };
  }

  // Si venía de un lead de Meta: queda vinculado y como "sacó turno" (RLS: leads de sus sucursales)
  const leadId = str(formData, "lead_id");
  if (leadId) {
    await supabase.from("leads").update({ patient_id: data.id, status: "booked" }).eq("id", leadId);
    revalidatePath("/leads");
  }

  // Si venía de "Nuevo turno", sigue directo a cargarle el turno
  if (str(formData, "next_turno") === "1") {
    const fecha = str(formData, "next_fecha");
    const vista = str(formData, "next_vista") === "semana" ? "&vista=semana" : "";
    redirect(`/turnos/nuevo?paciente=${data.id}${/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `&fecha=${fecha}` : ""}${vista}`);
  }
  redirect(`/pacientes/${data.id}?listo=paciente`);
}

export async function updatePatient(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireBranchContext();
  const supabase = await createClient();
  const id = str(formData, "id");
  const firstName = str(formData, "first_name");
  if (!firstName) return { error: "El nombre es obligatorio.", values: valuesOf(formData) };

  const { data: current } = await supabase
    .from("patients")
    .select("consent_data_at, consent_marketing_at, marketing_opt_out_at")
    .eq("id", id)
    .single();

  const wantsMarketing = formData.get("consent_marketing") === "on";
  const wantsOptOut = formData.get("opt_out") === "on";
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("patients")
    .update({
      first_name: firstName,
      last_name: orNull(str(formData, "last_name")),
      phone: orNull(str(formData, "phone")),
      email: orNull(str(formData, "email")),
      dni: orNull(str(formData, "dni")),
      birth_date: orNull(str(formData, "birth_date")),
      address: orNull(str(formData, "address")),
      source: orNull(str(formData, "source")),
      notes: orNull(str(formData, "notes")),
      consent_marketing_at: wantsMarketing ? (current?.consent_marketing_at ?? now) : null,
      marketing_opt_out_at: wantsOptOut ? (current?.marketing_opt_out_at ?? now) : null,
      // Completar la ficha a mano: el consentimiento de datos se registra una vez y no se borra desde acá
      ...(current?.consent_data_at ? {} : formData.get("consent_data") === "on" ? { consent_data_at: now } : {}),
    })
    .eq("id", id);

  if (error) return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };
  revalidatePath(`/pacientes/${id}`);
  revalidatePath("/");
  if (!current?.consent_data_at && formData.get("consent_data") === "on") {
    const back = str(formData, "back");
    if (back.startsWith("/")) redirect(`${back}${back.includes("?") ? "&" : "?"}listo=ficha`);
    return { ok: "Ficha completa." };
  }
  return { ok: "Datos guardados." };
}

// ---------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------
export async function saveAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireBranchContext();
  const supabase = await createClient();

  const id = str(formData, "id");
  const patientId = str(formData, "patient_id");
  const scheduledAt = localInputToISO(str(formData, "scheduled_at"));
  const status = str(formData, "status") as AppointmentStatus;

  if (!patientId) return { error: "Falta la paciente." };
  if (!scheduledAt) return { error: "Fecha y hora inválidas." };
  if (!["scheduled", "completed", "no_show", "cancelled"].includes(status)) {
    return { error: "Estado inválido." };
  }

  let items: AppointmentItemInput[] = [];
  let payments: PaymentInput[] = [];
  try {
    items = JSON.parse(str(formData, "items") || "[]");
    payments = JSON.parse(str(formData, "payments") || "[]");
  } catch {
    return { error: "No se pudieron leer los tratamientos o el cobro." };
  }
  items = items.filter((i) => i.treatment_id);
  payments = payments.filter((p) => p.account_id || p.amount);
  // Si todavía no se atendió, solo se guarda la seña
  if (status !== "completed") payments = payments.filter((p) => p.is_deposit);

  for (const p of payments) {
    const amount = numOrNull(p.amount ?? "");
    if (!p.account_id || amount === null || amount <= 0) {
      return {
        error: p.is_deposit
          ? "La seña necesita la cuenta y un monto mayor a 0 (o destildá «Reservó pagando una seña»)."
          : "Cada parte del cobro necesita la cuenta y un monto mayor a 0.",
      };
    }
    if (p.exchange_rate && (numOrNull(p.exchange_rate) ?? 0) <= 0) {
      return { error: "La cotización del dólar no es válida." };
    }
  }

  if (status === "completed") {
    if (items.length === 0) return { error: "Para marcarlo como realizado cargá al menos un tratamiento." };
    if (items.some((i) => numOrNull(i.price ?? "") === null)) {
      return { error: "Escribí el precio cobrado de cada tratamiento (con la promo o el descuento aplicado)." };
    }
    if (payments.length === 0) return { error: "Cargá cómo pagó (al menos una cuenta y su monto)." };
  }

  // Se guarda primero sin marcar como realizado, después tratamientos y cobros, y al final
  // el estado: así las integraciones (planilla, Klaviyo) reciben el turno completo una sola vez.
  const duration = Math.trunc(Number(str(formData, "duration_minutes") || "30"));
  if (!Number.isFinite(duration) || duration < 5 || duration > 600) return { error: "Duración inválida." };

  const fields = {
    patient_id: patientId,
    professional_id: orNull(str(formData, "professional_id")),
    scheduled_at: scheduledAt,
    duration_minutes: duration,
    notes: orNull(str(formData, "notes")),
  };

  let appointmentId = id;
  if (id) {
    const { error } = await supabase.from("appointments").update(fields).eq("id", id);
    if (error) return { error: `No se pudo guardar el turno: ${error.message}` };
  } else {
    const { data, error } = await supabase
      .from("appointments")
      .insert({ ...fields, status: "scheduled", organization_id: ctx.org.id, branch_id: ctx.currentBranch.id })
      .select("id")
      .single();
    if (error) return { error: `No se pudo crear el turno: ${error.message}` };
    appointmentId = data.id;
  }

  const { data: appt } = await supabase
    .from("appointments")
    .select("organization_id, branch_id")
    .eq("id", appointmentId)
    .single();
  if (!appt) return { error: "No se encontró el turno." };

  const { error: delItemsErr } = await supabase.from("appointment_items").delete().eq("appointment_id", appointmentId);
  if (delItemsErr) return { error: `No se pudieron actualizar los tratamientos: ${delItemsErr.message}` };
  if (items.length > 0) {
    const { error } = await supabase.from("appointment_items").insert(
      items.map((i) => ({
        appointment_id: appointmentId,
        treatment_id: i.treatment_id,
        zone: orNull(i.zone ?? ""),
        // Cantidad de insumo: acepta 0,5 o 0.5 (acá el punto es decimal, no de miles)
        quantity: qtyOrNull(i.quantity ?? ""),
        price: numOrNull(i.price ?? ""),
        // La base verifica que la promo sea de la red o de esta sucursal
        promotion_id: orNull(i.promotion_id ?? ""),
        lot_code: orNull(String(i.lot_code ?? "").trim().toUpperCase().slice(0, 60)),
      })),
    );
    if (error) {
      if (error.message.includes("promo")) return { error: "Una de las promos no corresponde a esta sucursal." };
      return { error: `No se pudieron guardar los tratamientos: ${error.message}` };
    }
  }

  const { error: delPayErr } = await supabase.from("appointment_payments").delete().eq("appointment_id", appointmentId);
  if (delPayErr) return { error: `No se pudo actualizar el cobro: ${delPayErr.message}` };
  if (payments.length > 0) {
    const { error } = await supabase.from("appointment_payments").insert(
      payments.map((p) => ({
        organization_id: appt.organization_id,
        branch_id: appt.branch_id,
        appointment_id: appointmentId,
        account_id: p.account_id,
        amount: numOrNull(p.amount),
        exchange_rate: numOrNull(p.exchange_rate ?? ""),
        is_deposit: Boolean(p.is_deposit),
      })),
    );
    if (error) return { error: `No se pudo guardar el cobro: ${error.message}` };
  }

  const { error: statusErr } = await supabase.from("appointments").update({ status }).eq("id", appointmentId);
  if (statusErr) return { error: `No se pudo actualizar el estado: ${statusErr.message}` };

  // Nota de la sesión (historia clínica): solo profesional, franquiciado o marca; la base lo verifica (RLS)
  if (status === "completed" && formData.has("clinical_note")) {
    const body = str(formData, "clinical_note").slice(0, 4000);
    const { error } = body
      ? await supabase
          .from("clinical_notes")
          // Sucursal, paciente y organización los completa la base a partir del turno
          .upsert(
            { appointment_id: appointmentId, body, organization_id: ctx.org.id, branch_id: ctx.currentBranch.id, patient_id: patientId },
            { onConflict: "appointment_id" },
          )
      : ctx.canManageCurrentBranch
        ? await supabase.from("clinical_notes").delete().eq("appointment_id", appointmentId)
        : { error: null };
    if (error) return { error: `Se guardó el turno, pero no la nota de la sesión: ${error.message}` };
  }

  // Comisión manual (solo marca/franquiciado; la base lo vuelve a verificar)
  if (status === "completed" && formData.has("commission")) {
    const raw = str(formData, "commission");
    const amount = raw === "" ? null : numOrNull(raw);
    if (raw !== "" && (amount === null || amount < 0)) return { error: "La comisión no es un monto válido." };
    const { data: current } = await supabase.rpc("appointment_commission", { p_appointment: appointmentId });
    const wasManual = Boolean(current?.[0]?.commission_manual);
    if (amount !== null || wasManual) {
      const { error } = await supabase.rpc("set_commission", { p_appointment: appointmentId, p_amount: amount });
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/");
  revalidatePath(`/pacientes/${patientId}`);
  // Vuelve a la agenda, en el día del turno
  const day = new Date(scheduledAt).toLocaleDateString("en-CA", { timeZone: TZ });
  const view = str(formData, "return_view") === "semana" ? "&vista=semana" : "";
  redirect(`/?fecha=${day}${view}&listo=${status === "completed" ? "cobro" : "turno"}&ultimo=${appointmentId}`);
}

export async function setAppointmentStatus(formData: FormData) {
  await requireBranchContext();
  const supabase = await createClient();
  const id = str(formData, "id");
  const status = str(formData, "status") as AppointmentStatus;
  if (!["scheduled", "no_show", "cancelled"].includes(status)) return;

  await supabase.from("appointments").update({ status }).eq("id", id);
  revalidatePath("/");
}

// ---------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------
export async function logRecall(formData: FormData) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const outcome = str(formData, "outcome") as RecallOutcome;
  const patientId = str(formData, "patient_id");

  await supabase.from("recall_contacts").insert({
    organization_id: ctx.org.id,
    branch_id: ctx.currentBranch.id,
    patient_id: patientId,
    treatment_id: orNull(str(formData, "treatment_id")),
    outcome,
    notes: orNull(str(formData, "notes")),
  });

  revalidatePath("/recall");
  if (outcome === "booked") redirect(`/turnos/nuevo?paciente=${patientId}`);
}

// ---------------------------------------------------------------------
// Beauty Millas
// ---------------------------------------------------------------------
export async function adjustPoints(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const patientId = str(formData, "patient_id");
  const points = Math.trunc(Number(str(formData, "points")));
  const mode = str(formData, "mode");
  const reason = str(formData, "reason");

  if (!Number.isFinite(points) || points <= 0) return { error: "Ingresá una cantidad mayor a 0." };
  if (!reason) return { error: "Indicá el motivo." };

  if (mode === "redeem") {
    const { data } = await supabase
      .from("patient_loyalty_balance")
      .select("balance")
      .eq("patient_id", patientId)
      .maybeSingle();
    if ((data?.balance ?? 0) < points) return { error: "No tiene millas suficientes." };
  }

  const { error } = await supabase.from("loyalty_transactions").insert({
    organization_id: ctx.org.id,
    patient_id: patientId,
    branch_id: ctx.currentBranch.id,
    points: mode === "redeem" ? -points : points,
    reason,
  });
  if (error) return { error: `No se pudo registrar: ${error.message}` };

  revalidatePath(`/pacientes/${patientId}`);
  return { ok: mode === "redeem" ? "Canje registrado." : "Millas sumadas." };
}

// ---------------------------------------------------------------------
// Integraciones (marca: cualquier sucursal o toda la red; franquiciado: la suya)
// ---------------------------------------------------------------------
export async function createIntegration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const type = str(formData, "type");
  const secret = str(formData, "secret");
  const branchId = ctx.isNetwork ? orNull(str(formData, "branch_id")) : ctx.currentBranch.id;

  if (branchId && !ctx.branches.some((b) => b.id === branchId)) return { error: "Sucursal inválida." };

  let config: Record<string, string> = {};
  let events = ["appointment.completed", "appointment.updated"];
  let name = str(formData, "name");

  if (type === "google_sheets" || type === "google_calendar") {
    const url = str(formData, "url");
    if (!url.startsWith("https://script.google.com/")) {
      return { error: "La URL tiene que ser la de la aplicación web de Apps Script.", values: valuesOf(formData) };
    }
    if (secret.length < 12) return { error: "El token tiene que tener al menos 12 caracteres.", values: valuesOf(formData) };
    config = { url };
    if (type === "google_calendar") {
      events = ["appointment.saved", "appointment.deleted"];
      name = name || "Google Calendar";
    } else {
      name = name || "Google Sheets";
    }
  } else if (type === "klaviyo") {
    if (!/^pk_[A-Za-z0-9_]{10,}$/.test(secret)) {
      return {
        error: "La clave privada de Klaviyo empieza con pk_. La sacás de Klaviyo → Settings → API keys.",
        values: valuesOf(formData),
      };
    }
    const listId = str(formData, "list_id");
    config = listId ? { list_id: listId } : {};
    events = ["appointment.completed"];
    name = name || "Klaviyo";
  } else {
    return { error: "Tipo de integración inválido." };
  }

  const { data: created, error } = await supabase
    .from("integrations")
    .insert({
      organization_id: ctx.org.id,
      branch_id: branchId,
      type,
      name,
      config,
      secret,
      events,
    })
    .select("id")
    .single();
  if (error) return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };

  // El calendario arranca con los turnos de hoy en adelante
  let synced = 0;
  if (type === "google_calendar") {
    const { data: count } = await supabase.rpc("resync_integration", { p_integration: created.id });
    synced = Number(count ?? 0);
  }

  revalidatePath("/ajustes");
  const OK_MESSAGE: Record<string, string> = {
    klaviyo: "Klaviyo conectado. Cada tratamiento realizado se envía como evento «Tratamiento realizado».",
    google_sheets: "Planilla conectada. Los próximos turnos realizados se copian solos.",
    google_calendar: `Calendario conectado. ${synced} ${synced === 1 ? "turno" : "turnos"} de hoy en adelante se están cargando; los nuevos y los cambios se pasan solos.`,
  };
  return { ok: OK_MESSAGE[type] };
}

export async function toggleIntegration(formData: FormData) {
  await requireManagerContext();
  const supabase = await createClient();
  // RLS: marca o franquiciado de esa sucursal
  await supabase
    .from("integrations")
    .update({ is_active: str(formData, "active") === "1" })
    .eq("id", str(formData, "id"));
  revalidatePath("/ajustes");
}

// ---------------------------------------------------------------------
// Ficha incompleta: link personal (7 días, un uso) para que la paciente complete sus datos
// ---------------------------------------------------------------------
export async function createIntakeLink(formData: FormData) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const patientId = str(formData, "patient_id");
  // RLS: solo si la paciente es visible para este usuario
  const { data: patient } = await supabase
    .from("patients")
    .select("id, consent_data_at")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient || patient.consent_data_at) return;

  const { randomBytes } = await import("node:crypto");
  await supabase.from("patient_intakes").insert({
    organization_id: ctx.org.id,
    branch_id: ctx.currentBranch.id,
    patient_id: patient.id,
    token: randomBytes(18).toString("base64url"),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  revalidatePath(`/pacientes/${patient.id}/completar`);
  // Desde el aviso del cobro: va directo a la pantalla con el QR y vuelve al cobro al terminar
  const volver = str(formData, "volver");
  if (volver.startsWith("/") && !volver.startsWith("//")) {
    redirect(`/pacientes/${patient.id}/completar?volver=${encodeURIComponent(volver)}`);
  }
}
