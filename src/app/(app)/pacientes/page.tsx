import Link from "next/link";
import { Suspense } from "react";
import { LiveSearch } from "@/components/live-search";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fullName } from "@/lib/format";
import { applyPatientSearch } from "@/lib/patient-search";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireBranchContext();
  const { q = "" } = await searchParams;
  const term = q.trim();
  const supabase = await createClient();

  let query = supabase
    .from("patients")
    .select("id, first_name, last_name, phone, dni, created_at, self_registered_at, home_branch:branches(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (term) query = applyPatientSearch(query, term);

  const { data } = await query;
  const patients = (data ?? []) as unknown as {
    id: string;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    dni: string | null;
    created_at: string;
    self_registered_at: string | null;
    home_branch: { name: string } | null;
  }[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Pacientes</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/pacientes/registro" className="btn">Registro con QR</Link>
          <Link href="/pacientes/nuevo" className="btn btn-primary">Nueva paciente</Link>
        </div>
      </div>

      <Suspense>
        <LiveSearch placeholder="Buscá por nombre, apellido, celular o DNI" label="Buscar paciente" />
      </Suspense>

      <div className="card overflow-x-auto p-0">
        {patients.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            {term ? "Sin resultados. Si es nueva, cargala con «Nueva paciente»." : "Todavía no hay pacientes."}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>DNI</th>
                <th>Sucursal</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/pacientes/${p.id}`} className="link">{fullName(p)}</Link>
                    {p.self_registered_at && <span className="badge badge-blue ml-2">Se registró sola</span>}
                  </td>
                  <td className="text-muted">{p.phone ?? "—"}</td>
                  <td className="text-muted">{p.dni ?? "—"}</td>
                  <td className="text-muted">{p.home_branch?.name ?? "—"}</td>
                  <td className="text-muted">{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!term && patients.length === 50 && (
        <p className="text-xs text-muted">Se muestran las últimas 50. Usá el buscador para encontrar al resto.</p>
      )}
    </div>
  );
}
