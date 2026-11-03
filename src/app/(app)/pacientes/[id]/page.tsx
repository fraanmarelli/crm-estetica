import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fmtDateTime, fmtMoney, fullName, STATUS_CLASS, STATUS_LABEL } from "@/lib/format";
import type { AppointmentStatus, Patient } from "@/lib/types";
import { PatientEditForm } from "./patient-edit-form";
import { PointsForm } from "./points-form";

type Appt = {
  id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  amount_paid: number | null;
  payment_method: string | null;
  notes: string | null;
  branch: { name: string } | null;
  professional: { full_name: string } | null;
  items: { zone: string | null; treatment: { name: string } | null }[];
};

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBranchContext();
  const { id } = await params;
  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("patients")
    .select("*, home_branch:branches(name)")
    .eq("id", id)
    .maybeSingle();

  if (!patient) {
    // Puede existir en otra sucursal sin acceso a la ficha completa
    const { data: brief } = await supabase.rpc("patient_brief", { p_patient: id });
    if (!brief?.length) notFound();
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>{brief[0].display_name}</h1>
        <p className="text-sm text-muted">
          Es paciente de otra sucursal. Al darle un turno en {ctx.currentBranch.name} vas a ver su ficha.
        </p>
        <Link href={`/turnos/nuevo?paciente=${id}`} className="btn btn-primary">Darle un turno</Link>
      </div>
    );
  }

  const [{ data: appts }, { data: balance }, { data: moves }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, scheduled_at, status, amount_paid, payment_method, notes, branch:branches(name), professional:professionals(full_name), items:appointment_items(zone, treatment:treatments(name))",
      )
      .eq("patient_id", id)
      .order("scheduled_at", { ascending: false }),
    supabase.from("patient_loyalty_balance").select("balance").eq("patient_id", id).maybeSingle(),
    supabase
      .from("loyalty_transactions")
      .select("id, points, reason, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const history = (appts ?? []) as unknown as Appt[];
  const p = patient as Patient & { home_branch: { name: string } | null };
  const totalSpent = history
    .filter((a) => a.status === "completed")
    .reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1>{fullName(p)}</h1>
          <p className="page-sub">
            {p.phone ?? "Sin teléfono"} · Sucursal de origen: {p.home_branch?.name ?? "—"} · Alta {fmtDate(p.created_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {p.marketing_opt_out_at ? (
              <span className="badge badge-red">No contactar</span>
            ) : p.consent_marketing_at ? (
              <span className="badge badge-green">Acepta recordatorios</span>
            ) : (
              <span className="badge badge-amber">Sin consentimiento de recordatorios</span>
            )}
          </div>
        </div>
        <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-primary">Nuevo turno</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2>Historial ({history.length}) · {fmtMoney(totalSpent, ctx.org.currency)}</h2>
          <div className="card overflow-x-auto p-0">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted">Sin turnos todavía.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tratamiento</th>
                    <th>Sucursal</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(a.scheduled_at)}</td>
                      <td>
                        {a.items
                          .map((i) => [i.treatment?.name, i.zone].filter(Boolean).join(" - "))
                          .join(", ") || "—"}
                        {a.professional && (
                          <span className="block text-xs text-muted">{a.professional.full_name}</span>
                        )}
                      </td>
                      <td className="text-muted">{a.branch?.name ?? "—"}</td>
                      <td className="whitespace-nowrap">{fmtMoney(a.amount_paid, ctx.org.currency)}</td>
                      <td>
                        <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
                      </td>
                      <td>
                        <Link href={`/turnos/${a.id}`} className="btn btn-sm">Abrir</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="passport">
            <p className="text-sm opacity-80">Pasaporte de Belleza</p>
            <p className="gold-text mt-1 font-display text-5xl leading-none num">{balance?.balance ?? 0}</p>
            <p className="text-sm opacity-80">Beauty Millas disponibles</p>
            {moves && moves.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {moves.slice(0, 4).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 opacity-90">
                    <span className="truncate">
                      {fmtDate(m.created_at)} · {m.reason}
                    </span>
                    <span className="num font-semibold">{m.points > 0 ? `+${m.points}` : m.points}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="passport-stub">
              <div className="rounded-xl bg-surface p-3 text-ink">
                <PointsForm patientId={p.id} />
              </div>
            </div>
          </section>

          <section className="card space-y-3">
            <h2>Datos</h2>
            <PatientEditForm patient={p} />
          </section>
        </aside>
      </div>
    </div>
  );
}
