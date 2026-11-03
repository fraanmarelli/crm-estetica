import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { loadCatalog } from "@/lib/catalog";
import { isoToLocalInput } from "@/lib/format";
import { AppointmentForm } from "@/components/appointment-form";

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ paciente?: string }>;
}) {
  const ctx = await requireBranchContext();
  const { paciente } = await searchParams;

  if (!paciente) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>Nuevo turno</h1>
        <p className="text-sm text-muted">Primero buscá o cargá a la paciente.</p>
        <Link href="/pacientes" className="btn btn-primary">Ir a pacientes</Link>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: brief } = await supabase.rpc("patient_brief", { p_patient: paciente });
  if (!brief?.length) {
    return <p className="alert-error">No se encontró la paciente.</p>;
  }

  const { treatments, professionals, accounts } = await loadCatalog(ctx.org.id, ctx.currentBranch.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1>Nuevo turno · {brief[0].display_name}</h1>
        <p className="text-sm text-muted">Sucursal {ctx.currentBranch.name}</p>
      </div>
      <AppointmentForm
        patientId={paciente}
        treatments={treatments}
        professionals={professionals}
        accounts={accounts}
        canSeeCosts={ctx.canManageCurrentBranch}
        defaults={{
          scheduled_at: isoToLocalInput(null),
          status: "scheduled",
          professional_id: "",
          notes: "",
          items: [],
          payments: [],
          commission: "",
        }}
      />
    </div>
  );
}
