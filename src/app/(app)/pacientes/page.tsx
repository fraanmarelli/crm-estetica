import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fullName } from "@/lib/format";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireBranchContext();
  const { q = "" } = await searchParams;
  const term = q.replace(/[,()%*\\]/g, " ").trim();
  const supabase = await createClient();

  let query = supabase
    .from("patients")
    .select("id, first_name, last_name, phone, dni, created_at, home_branch:branches(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (term) {
    const digits = term.replace(/\D/g, "");
    const filters = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`];
    if (digits.length >= 4) filters.push(`phone.ilike.%${digits}%`, `dni.ilike.%${digits}%`);
    query = query.or(filters.join(","));
  }

  const { data } = await query;
  const patients = (data ?? []) as unknown as {
    id: string;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    dni: string | null;
    created_at: string;
    home_branch: { name: string } | null;
  }[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Pacientes</h1>
        <Link href="/pacientes/nuevo" className="btn btn-primary">Nueva paciente</Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, teléfono o DNI"
          className="input"
          autoFocus
        />
        <button className="btn">Buscar</button>
      </form>

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
