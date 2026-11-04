"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type RegisterState = { error?: string; done?: string; values?: Record<string, string> } | null;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v === "" ? null : v);
const MAX_PER_MINUTE = 10;

// Formulario público: el token de la sucursal es la única credencial. Solo crea pacientes.
export async function registerPatient(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const token = str(formData, "token");
  const values: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string" && k !== "token" && !k.startsWith("$")) values[k] = v;
  });

  const firstName = str(formData, "first_name");
  const phone = str(formData, "phone");
  const source = str(formData, "source");
  const email = str(formData, "email");
  const birth = str(formData, "birth_date");
  const dni = str(formData, "dni").replace(/\D/g, "");

  if (!firstName) return { error: "Completá tu nombre.", values };
  if (phone.replace(/\D/g, "").length < 8) return { error: "Completá tu celular con característica.", values };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el email.", values };
  if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return { error: "Revisá la fecha de nacimiento.", values };
  if (!source) return { error: "Contanos cómo nos conociste.", values };
  if (formData.get("consent_data") !== "on") {
    return { error: "Para registrarte necesitamos tu autorización para guardar tus datos.", values };
  }

  const admin = createAdminClient();
  const { data: branch } = await admin
    .from("branches")
    .select("id, organization_id")
    .eq("intake_token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch) return { error: "Este link ya no funciona. Pedile el nuevo a recepción." };

  // Freno contra abuso: tope de registros por minuto por sucursal
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("home_branch_id", branch.id)
    .gte("self_registered_at", since);
  if ((count ?? 0) >= MAX_PER_MINUTE) {
    return { error: "Hay muchos registros en este momento. Probá de nuevo en un minuto.", values };
  }

  try {
    // ¿Ya existe en la red? Entonces no se duplica ni se modifica
    const { data: normalized } = await admin.rpc("normalize_phone", { p: phone });
    const filters = [`phone.eq.${normalized}`];
    if (dni.length >= 6) filters.push(`dni.eq.${dni}`);
    const { data: existing } = await admin
      .from("patients")
      .select("id")
      .eq("organization_id", branch.organization_id)
      .or(filters.join(","))
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const now = new Date().toISOString();
      const { error } = await admin.from("patients").insert({
        organization_id: branch.organization_id,
        home_branch_id: branch.id,
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
        self_registered_at: now,
      });
      if (error) throw new Error(error.message);
    }

    // Mismo mensaje exista o no: el link no sirve para averiguar quién es paciente
    return { done: firstName };
  } catch {
    return { error: "No pudimos guardar tus datos. Probá de nuevo o avisá en recepción.", values };
  }
}
