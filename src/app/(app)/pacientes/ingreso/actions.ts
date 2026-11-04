"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";

// Recepción genera un link de un solo uso (vence en 60 minutos)
export async function createIntake(formData: FormData) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();
  const token = randomBytes(24).toString("base64url");

  const { data, error } = await supabase
    .from("patient_intakes")
    .insert({ organization_id: ctx.org.id, branch_id: ctx.currentBranch.id, token })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo generar la ficha: ${error.message}`);

  const keep = new URLSearchParams();
  for (const k of ["turno", "fecha", "vista"]) {
    const v = String(formData.get(k) ?? "");
    if (v) keep.set(k, v);
  }
  keep.set("id", data.id);
  redirect(`/pacientes/ingreso?${keep}`);
}
