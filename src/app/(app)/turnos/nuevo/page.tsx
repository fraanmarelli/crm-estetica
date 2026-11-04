import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { loadCatalog } from "@/lib/catalog";
import { fmtDate, fullName, isoToLocalInput, todayISO } from "@/lib/format";
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
    const term = q.replace(/[,()%*\\]/g, " ").trim();
    let results: { id: string; first_name: string; last_name: string | null; phone: string | null }[] = [];
    if (term.length >= 2) {
      const digits = term.replace(/\D/g, "");
      const filters = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`];
      if (digits.length >= 4) filters.push(`phone.ilike.%${digits}%`, `dni.ilike.%${digits}%`);
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, phone")
        .or(filters.join(","))
        .order("first_name")
        .limit(20);
      results = data ?? [];
    }
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
          <Link href="/pacientes/nuevo" className="btn">Paciente nueva</Link>
        </div>

        <form className="flex gap-2">
          {day && <input type="hidden" name="fecha" value={day} />}
          {week && <input type="hidden" name="vista" value="semana" />}
          <label htmlFor="buscar-paciente" className="sr-only">Buscar paciente</label>
          <input
            id="buscar-paciente"
            name="q"
            defaultValue={q}
            placeholder="Nombre, celular o DNI"
            className="input"
            autoFocus
          />
          <button className="btn">Buscar</button>
        </form>

        {term.length >= 2 && (
          <div className="card p-0">
            {results.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                No hay coincidencias. <Link href="/pacientes/nuevo" className="link">Cargala como nueva</Link>
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

  const { treatments, professionals, accounts } = await loadCatalog(ctx.org.id, ctx.currentBranch.id);
  // Hoy: la hora actual. Otro día: 10:00.
  const start = !day || day === todayISO() ? isoToLocalInput(null) : `${day}T10:00`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1>Nuevo turno · {brief[0].display_name}</h1>
        <p className="page-sub">Sucursal {ctx.currentBranch.name}</p>
      </div>
      <AppointmentForm
        patientId={paciente}
        treatments={treatments}
        professionals={professionals}
        accounts={accounts}
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
