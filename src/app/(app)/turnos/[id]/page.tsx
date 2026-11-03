import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { loadCatalog } from "@/lib/catalog";
import { fullName, isoToLocalInput } from "@/lib/format";
import { AppointmentForm } from "@/components/appointment-form";
import type { AppointmentStatus } from "@/lib/types";

type Appt = {
  id: string;
  branch_id: string;
  patient_id: string;
  professional_id: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
  amount_paid: number | null;
  payment_method: string | null;
  notes: string | null;
  patient: { first_name: string; last_name: string | null } | null;
  branch: { name: string } | null;
  items: { treatment_id: string; zone: string | null; quantity: number | null; price: number | null }[];
};

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBranchContext();
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("appointments")
    .select(
      "id, branch_id, patient_id, professional_id, scheduled_at, status, amount_paid, payment_method, notes, patient:patients(first_name, last_name), branch:branches(name), items:appointment_items(treatment_id, zone, quantity, price)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const appt = data as unknown as Appt;

  if (appt.branch_id !== ctx.currentBranch.id) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>Turno de otra sucursal</h1>
        <p className="text-sm text-muted">
          Este turno es de {appt.branch?.name}. Cambiá de sucursal arriba para editarlo.
        </p>
        <Link href={`/pacientes/${appt.patient_id}`} className="btn">Volver a la paciente</Link>
      </div>
    );
  }

  const { treatments, professionals } = await loadCatalog(ctx.org.id, ctx.currentBranch.id);
  const s = (v: number | string | null) => (v === null ? "" : String(v));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1>Turno · {appt.patient ? fullName(appt.patient) : "Paciente"}</h1>
        <p className="text-sm text-muted">
          Para registrarlo como realizado, cambiá el estado a «Realizado» y cargá lo que se hizo y lo cobrado.
        </p>
      </div>
      <AppointmentForm
        patientId={appt.patient_id}
        treatments={treatments}
        professionals={professionals}
        defaults={{
          id: appt.id,
          scheduled_at: isoToLocalInput(appt.scheduled_at),
          status: appt.status === "scheduled" ? "completed" : appt.status,
          professional_id: appt.professional_id ?? "",
          amount_paid: s(appt.amount_paid),
          payment_method: appt.payment_method ?? "",
          notes: appt.notes ?? "",
          items: appt.items.map((i) => ({
            treatment_id: i.treatment_id,
            zone: i.zone ?? "",
            quantity: s(i.quantity),
            price: s(i.price),
          })),
        }}
      />
    </div>
  );
}
