import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";
import { dayRange, fmtMoney, fmtTime, fullName, STATUS_CLASS, STATUS_LABEL, TZ, todayISO } from "@/lib/format";
import { Kpi } from "@/components/kpi";
import { setAppointmentStatus } from "./actions";
import type { AppointmentStatus } from "@/lib/types";

type Row = {
  id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  amount_paid: number | null;
  patient: { id: string; first_name: string; last_name: string | null } | null;
  professional: { full_name: string } | null;
  items: { treatment: { name: string } | null }[];
};

function longDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00-03:00`);
  const text = d.toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shiftDay(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const ctx = await getContext();
  if (!ctx?.currentBranch) {
    return <p className="text-sm text-muted">No tenés sucursales asignadas.</p>;
  }

  const { fecha } = await searchParams;
  const today = todayISO();
  const day = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;
  const { start, end } = dayRange(day);
  const supabase = await createClient();

  const [{ data: appointments }, { data: due }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, scheduled_at, status, amount_paid, patient:patients(id, first_name, last_name), professional:professionals(full_name), items:appointment_items(treatment:treatments(name))",
      )
      .eq("branch_id", ctx.currentBranch.id)
      .gte("scheduled_at", start)
      .lt("scheduled_at", end)
      .order("scheduled_at"),
    supabase
      .from("recall_due_by_branch")
      .select("due_count")
      .eq("branch_id", ctx.currentBranch.id)
      .maybeSingle(),
  ]);

  const rows = (appointments ?? []) as unknown as Row[];
  const done = rows.filter((r) => r.status === "completed");
  const pending = rows.filter((r) => r.status === "scheduled");
  const revenue = done.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
  const dueCount = due?.due_count ?? 0;

  return (
    <div className="space-y-8">
      <div className="page-head">
        <div>
          <h1>{day === today ? "Hoy" : longDate(day)}</h1>
          <p className="page-sub">
            {day === today ? `${longDate(day)} en ${ctx.currentBranch.name}` : ctx.currentBranch.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/?fecha=${shiftDay(day, -1)}`} className="btn btn-sm" aria-label="Día anterior">
            ‹
          </Link>
          {day !== today && (
            <Link href="/" className="btn btn-sm">Volver a hoy</Link>
          )}
          <Link href={`/?fecha=${shiftDay(day, 1)}`} className="btn btn-sm" aria-label="Día siguiente">
            ›
          </Link>
          <Link href="/pacientes" className="btn btn-primary">Nuevo turno</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Turnos"
          value={String(rows.length)}
          hint={pending.length ? `${pending.length} por atender` : "Todos atendidos"}
        />
        <Kpi label="Cobrado" value={fmtMoney(revenue, ctx.org.currency)} hint={`${done.length} realizados`} />
        <Kpi
          label="Para recontactar"
          value={String(dueCount)}
          hint={dueCount ? "Pacientes a las que les toca volver" : "Recall al día"}
          accent={dueCount > 0}
          href="/recall"
        />
      </div>

      <section className="space-y-3">
        <h2>Agenda</h2>
        {rows.length === 0 ? (
          <div className="card text-sm text-muted">
            No hay turnos cargados para este día.{" "}
            <Link href="/pacientes" className="link">Cargar un turno</Link>
          </div>
        ) : (
          <ol className="card divide-y divide-line p-0">
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[4.25rem_1fr] gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[4.25rem_1fr_auto] sm:items-center">
                <span className="font-display text-xl leading-tight num">{fmtTime(r.scheduled_at)}</span>
                <div className="min-w-0">
                  {r.patient ? (
                    <Link href={`/pacientes/${r.patient.id}`} className="font-semibold hover:text-brand">
                      {fullName(r.patient)}
                    </Link>
                  ) : (
                    <span className="font-semibold">Paciente</span>
                  )}
                  <p className="truncate text-sm text-muted">
                    {r.items.map((i) => i.treatment?.name).filter(Boolean).join(", ") || "Sin tratamiento cargado"}
                    {r.professional ? ` con ${r.professional.full_name}` : ""}
                  </p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
                  <span className={STATUS_CLASS[r.status]}>{STATUS_LABEL[r.status]}</span>
                  <Link href={`/turnos/${r.id}`} className={`btn btn-sm ${r.status === "scheduled" ? "btn-primary" : ""}`}>
                    {r.status === "scheduled" ? "Registrar" : "Editar"}
                  </Link>
                  {r.status === "scheduled" && (
                    <form action={setAppointmentStatus}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="no_show" />
                      <button className="btn btn-sm">No vino</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
