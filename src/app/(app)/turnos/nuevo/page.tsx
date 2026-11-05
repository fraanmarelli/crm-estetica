import Link from "next/link";
import { Suspense } from "react";
import { LiveSearch } from "@/components/live-search";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { loadCatalog } from "@/lib/catalog";
import { fmtDate, fullName, isoToLocalInput, todayISO } from "@/lib/format";
import { applyPatientSearch } from "@/lib/patient-search";
import { AppointmentForm } from "@/components/appointment-form";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ paciente?: string; fecha?: string; q?: string; vista?: string }>;
}) {
  const ctx = await requireBranchContext();
  const { paciente, fecha, q = "", vista } = await searchParams;
  const week = vista === "semana";
  const day = fecha && ISO_DATE.test(fecha) ? fecha : null;
  const supabase = await createClient();

  // ------------------------------------------------------------------
  // Paso 1: elegir paciente
  // ------------------------------------------------------------------
  if (!paciente) {
    const term = q.trim();
    let results: { id: string; first_name: string; last_name: string | null; phone: string | null }[] = [];
    if (term.length >= 2) {
      const { data } = await applyPatientSearch(
        supabase.from("patients").select("id, first_name, last_name, phone"),
        term,
      )
        .order("first_name")
        .limit(20);
      results = data ?? [];
    }
    const newParams = `turno=1${day ? `&fecha=${day}` : ""}${week ? "&vista=semana" : ""}`;
    const withDate = (extra: string) =>
      `/turnos/nuevo?${extra}${day ? `&fecha=${day}` : ""}${week ? "&vista=semana" : ""}`;

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="page-head">
          <div>
            <h1>Nuevo turno</h1>
            <p className="page-sub">
              {day ? `Para el ${fmtDate(day)} en ${ctx.currentBranch.name}. ` : ""}Buscá a la paciente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/pacientes/registro?${newParams}`} className="btn">Que se registre ella</Link>
            <Link href={`/pacientes/nuevo?${newParams}`} className="btn">Cargarla yo</Link>
          </div>
        </div>

        <Suspense>
          <LiveSearch placeholder="Nombre, apellido, celular o DNI" label="Buscar paciente" />
        </Suspense>

        {term.length >= 2 && (
          <div className="card p-0">
            {results.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                No hay coincidencias.{" "}
                <Link href={`/pacientes/nuevo?${newParams}`} className="link">Cargala como nueva</Link> o{" "}
                <Link href={`/pacientes/registro?${newParams}`} className="link">que se registre ella</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {results.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={withDate(`paciente=${p.id}`)}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-subtle"
                    >
                      <span className="font-semibold">{fullName(p)}</span>
                      <span className="text-sm text-muted">{p.phone ?? ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Paso 2: cargar el turno
  // ------------------------------------------------------------------
  const { data: brief } = await supabase.rpc("patient_brief", { p_patient: paciente });
  if (!brief?.length) {
    return <p className="alert-error">No se encontró la paciente.</p>;
  }

  const { treatments, professionals, accounts, promotions, lastLots } = await loadCatalog(ctx.org.id, ctx.currentBranch.id);
  // Hoy: la hora actual. Otro día: 10:00.
  const start = !day || day === todayISO() ? isoToLocalInput(null) : `${day}T10:00`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1>Nuevo turno · {brief[0].display_name}</h1>
        <p className="page-sub">Sucursal {ctx.currentBranch.name}</p>
      </div>
      <AppointmentForm
        patientId={paciente}
        treatments={treatments}
        professionals={professionals}
        accounts={accounts}
        promotions={promotions}
        lastLots={lastLots}
        canSeeCosts={ctx.canManageCurrentBranch}
        returnView={week ? "semana" : undefined}
        defaults={{
          scheduled_at: start,
          duration_minutes: "30",
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
