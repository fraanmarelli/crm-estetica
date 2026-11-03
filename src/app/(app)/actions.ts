"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BRANCH_COOKIE, getContext, requireBranchContext, requireManagerContext } from "@/lib/context";
import { localInputToISO } from "@/lib/format";
import type {
  ActionState,
  AppointmentItemInput,
  AppointmentStatus,
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
  }
  revalidatePath("/", "layout");
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
  if (formData.get("consent_data") !== "on") {
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
      source: orNull(str(formData, "source")),
      notes: orNull(str(formData, "notes")),
      consent_data_at: now,
      consent_marketing_at: formData.get("consent_marketing") === "on" ? now : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("phone")) return { error: "El teléfono no es válido.", values: valuesOf(formData) };
    return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };
  }

  redirect(`/pacientes/${data.id}`);
}

export async function updatePatient(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireBranchContext();
  const supabase = await createClient();
  const id = str(formData, "id");
  const firstName = str(formData, "first_name");
  if (!firstName) return { error: "El nombre es obligatorio.", values: valuesOf(formData) };

  const { data: current } = await supabase
    .from("patients")
    .select("consent_marketing_at, marketing_opt_out_at")
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
      source: orNull(str(formData, "source")),
      notes: orNull(str(formData, "notes")),
      consent_marketing_at: wantsMarketing ? (current?.consent_marketing_at ?? now) : null,
      marketing_opt_out_at: wantsOptOut ? (current?.marketing_opt_out_at ?? now) : null,
    })
    .eq("id", id);

  if (error) return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };
  revalidatePath(`/pacientes/${id}`);
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
  try {
    items = JSON.parse(str(formData, "items") || "[]");
  } catch {
    return { error: "No se pudieron leer los tratamientos." };
  }
  items = items.filter((i) => i.treatment_id);
  if (status === "completed" && items.length === 0) {
    return { error: "Para marcarlo como realizado cargá al menos un tratamiento." };
  }
  if (status === "completed" && items.some((i) => numOrNull(i.price ?? "") === null)) {
    return { error: "Escribí el precio cobrado de cada tratamiento (con la promo o el descuento aplicado)." };
  }

  const fields = {
    patient_id: patientId,
    professional_id: orNull(str(formData, "professional_id")),
    scheduled_at: scheduledAt,
    status,
    amount_paid: numOrNull(str(formData, "amount_paid")),
    payment_method: orNull(str(formData, "payment_method")),
    notes: orNull(str(formData, "notes")),
  };

  let appointmentId = id;

  if (id) {
    const { error } = await supabase.from("appointments").update(fields).eq("id", id);
    if (error) return { error: `No se pudo guardar el turno: ${error.message}` };
    const { error: delErr } = await supabase.from("appointment_items").delete().eq("appointment_id", id);
    if (delErr) return { error: `No se pudieron actualizar los tratamientos: ${delErr.message}` };
  } else {
    const { data, error } = await supabase
      .from("appointments")
      .insert({ ...fields, organization_id: ctx.org.id, branch_id: ctx.currentBranch.id })
      .select("id")
      .single();
    if (error) return { error: `No se pudo crear el turno: ${error.message}` };
    appointmentId = data.id;
  }

  if (items.length > 0) {
    const { error } = await supabase.from("appointment_items").insert(
      items.map((i) => ({
        appointment_id: appointmentId,
        treatment_id: i.treatment_id,
        zone: orNull(i.zone ?? ""),
        quantity: numOrNull(i.quantity ?? ""),
        price: numOrNull(i.price ?? ""),
      })),
    );
    if (error) return { error: `Turno guardado, pero fallaron los tratamientos: ${error.message}` };
  }

  revalidatePath("/");
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}`);
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

  if (type === "google_sheets") {
    const url = str(formData, "url");
    if (!url.startsWith("https://script.google.com/")) {
      return { error: "La URL tiene que ser la de la aplicación web de Apps Script.", values: valuesOf(formData) };
    }
    if (secret.length < 12) return { error: "El token tiene que tener al menos 12 caracteres.", values: valuesOf(formData) };
    config = { url };
    name = name || "Google Sheets";
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

  const { error } = await supabase.from("integrations").insert({
    organization_id: ctx.org.id,
    branch_id: branchId,
    type,
    name,
    config,
    secret,
    events,
  });
  if (error) return { error: `No se pudo guardar: ${error.message}`, values: valuesOf(formData) };

  revalidatePath("/ajustes");
  return {
    ok:
      type === "klaviyo"
        ? "Klaviyo conectado. Cada tratamiento realizado se envía como evento «Tratamiento realizado»."
        : "Planilla conectada. Los próximos turnos realizados se copian solos.",
  };
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
