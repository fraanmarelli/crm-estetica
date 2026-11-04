"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type IntakeState = { error?: string; done?: string; values?: Record<string, string> } | null;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v === "" ? null : v);

// Formulario público: el token es la única credencial. Todo se valida acá.
export async function submitIntake(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const token = str(formData, "token");
  const values: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string" && k !== "token" && !k.startsWith("$")) values[k] = v;
  });

  const firstName = str(formData, "first_name");
  const phone = str(formData, "phone");
  const source = str(formData, "source");
  if (!firstName) return { error: "Completá tu nombre.", values };
  if (phone.replace(/\D/g, "").length < 8) return { error: "Completá tu celular con característica.", values };
  if (!source) return { error: "Contanos cómo nos conociste.", values };
  if (formData.get("consent_data") !== "on") {
    return { error: "Para registrarte necesitamos tu autorización para guardar tus datos.", values };
  }
  const email = str(formData, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el email.", values };
  const birth = str(formData, "birth_date");
  if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return { error: "Revisá la fecha de nacimiento.", values };

  const admin = createAdminClient();

  // Reclamar el link (un solo uso) antes de guardar
  const now = new Date().toISOString();
  const { data: intake } = await admin
    .from("patient_intakes")
    .update({ used_at: now })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, organization_id, branch_id, created_by")
    .maybeSingle();
  if (!intake) {
    return { error: "Este link ya se usó o venció. Pedile uno nuevo a recepción." };
  }

  try {
    // ¿Ya existe en la red? (mismo celular o DNI)
    const { data: normalized } = await admin.rpc("normalize_phone", { p: phone });
    const dni = str(formData, "dni").replace(/\D/g, "");
    const filters = [`phone.eq.${normalized}`];
    if (dni.length >= 6) filters.push(`dni.eq.${dni}`);
    const { data: existing } = await admin
      .from("patients")
      .select("id, first_name")
      .eq("organization_id", intake.organization_id)
      .or(filters.join(","))
      .limit(1)
      .maybeSingle();

    let patientId = existing?.id as string | undefined;
    if (!patientId) {
      const { data: created, error } = await admin
        .from("patients")
        .insert({
          organization_id: intake.organization_id,
          home_branch_id: intake.branch_id,
          first_name: firstName,
          last_name: orNull(str(formData, "last_name")),
          phone,
          email: orNull(email),
          dni: orNull(dni),
          birth_date: orNull(birth),
          address: orNull(str(formData, "address")),
          source,
          consent_data_at: now,
          consent_marketing_at: formData.get("consent_marketing") === "on" ? now : null,
          created_by: intake.created_by,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      patientId = created.id;
    }

    await admin
      .from("patient_intakes")
      .update({ patient_id: patientId, already_existed: Boolean(existing) })
      .eq("id", intake.id);

    return { done: firstName };
  } catch {
    // Liberar el link para que pueda reintentar
    await admin.from("patient_intakes").update({ used_at: null }).eq("id", intake.id);
    return { error: "No pudimos guardar tus datos. Probá de nuevo o avisá en recepción.", values };
  }
}
