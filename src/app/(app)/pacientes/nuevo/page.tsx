import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireContactContext } from "@/lib/context";
import { NewPatientForm } from "./patient-form";

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ turno?: string; fecha?: string; vista?: string; lead?: string }>;
}) {
  const ctx = await requireContactContext();
  const sp = await searchParams;
  // Si viene de "Nuevo turno", al guardar sigue directo a darle el turno
  const next = {
    turno: sp.turno === "1" ? "1" : "",
    fecha: sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : "",
    vista: sp.vista === "semana" ? "semana" : "",
  };
  const query = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();

  // Viene de un lead de Meta: se precargan sus datos (RLS: solo leads de sus sucursales)
  let lead: { id: string; full_name: string | null; phone: string | null; email: string | null; platform: string | null } | null = null;
  if (sp.lead) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("leads")
      .select("id, full_name, phone, email, platform")
      .eq("id", sp.lead)
      .maybeSingle();
    lead = data;
  }
  const [firstName, ...rest] = (lead?.full_name ?? "").split(" ");
  const prefill = lead
    ? {
        first_name: firstName ?? "",
        last_name: rest.join(" "),
        phone: lead.phone ? `+${lead.phone}` : "",
        email: lead.email ?? "",
        source: lead.platform === "fb" ? "Facebook" : "Instagram",
      }
    : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="page-head">
        <div>
          <h1>Nueva paciente</h1>
          <p className="page-sub">
            Queda registrada en {ctx.currentBranch.name}.{next.turno ? " Al guardar seguís con su turno." : ""}
          </p>
        </div>
        <Link href={`/pacientes/registro${query ? `?${query}` : ""}`} className="btn">
          Que se registre ella
        </Link>
      </div>
      <NewPatientForm next={next} prefill={prefill} leadId={lead?.id} />
    </div>
  );
}
