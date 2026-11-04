"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type IntakeState = { error?: string; done?: string; values?: Record<string, string> } | null;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// Formulario público para completar la ficha de UNA paciente. El token personal (un uso,
// vence a los 7 días) es la única credencial; recién validado se usa el service role.
export async function completeIntake(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const token = str(formData, "token");
  const values: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string" && k !== "token" && !k.startsWith("$")) values[k] = v;
  });

  const firstName = str(formData, "first_name");
  const email = str(formData, "email");
  const birth = str(formData, "birth_date");
  const dni = str(formData, "dni").replace(/\D/g, "");

  if (!firstName) return { error: "Completá tu nombre.", values };
  if (dni && (dni.length < 7 || dni.length > 8)) return { error: "Revisá el DNI: son 7 u 8 números.", values };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el email.", values };
  if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return { error: "Revisá la fecha de nacimiento.", values };
  if (formData.get("consent_data") !== "on") {
    return { error: "Para completar tu ficha necesitamos tu autorización para guardar tus datos.", values };
  }

  const admin = createAdminClient();
  const { data: intake } = await admin
    .from("patient_intakes")
    .select("id, patient_id")
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .not("patient_id", "is", null)
    .maybeSingle();
  if (!intake) return { error: "Este link ya se usó o venció. Pedile uno nuevo a recepción." };

  try {
    const { data: patient } = await admin
      .from("patients")
      .select("consent_data_at, consent_marketing_at")
      .eq("id", intake.patient_id)
      .single();
    const now = new Date().toISOString();
    // Solo se completan datos: lo que deja vacío no borra lo que ya estaba
    const patch: Record<string, string | null> = { first_name: firstName };
    const lastName = str(formData, "last_name");
    const address = str(formData, "address");
    if (lastName) patch.last_name = lastName;
    if (dni) patch.dni = dni;
    if (email) patch.email = email;
    if (birth) patch.birth_date = birth;
    if (address) patch.address = address;
    if (!patient?.consent_data_at) patch.consent_data_at = now;
    if (formData.get("consent_marketing") === "on" && !patient?.consent_marketing_at) patch.consent_marketing_at = now;

    const { error } = await admin.from("patients").update(patch).eq("id", intake.patient_id);
    if (error) throw new Error(error.message);
    await admin.from("patient_intakes").update({ used_at: now }).eq("id", intake.id);
    return { done: firstName };
  } catch {
    return { error: "No pudimos guardar tus datos. Probá de nuevo o avisá en recepción.", values };
  }
}
