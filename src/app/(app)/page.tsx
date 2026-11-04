import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";
import {
  TZ,
  dayRange,
  fillTemplate,
  fmtMoney,
  fmtTime,
  fullName,
  STATUS_CLASS,
  STATUS_LABEL,
  todayISO,
  whatsappLink,
} from "@/lib/format";
import { Kpi } from "@/components/kpi";
import { IconWhatsApp } from "@/components/icons";
import { MonthCalendar, monthGrid, type DayCount } from "@/components/month-calendar";
import { setAppointmentStatus } from "./actions";
import type { AppointmentStatus } from "@/lib/types";

type Row = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  amount_paid: number | null;
  patient: { id: string; first_name: string; last_name: string | null; phone: string | null; notes: string | null } | null;
  professional: { full_name: string } | null;
  items: { zone: string | null; treatment: { name: string } | null }[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_REMINDER =
  "Hola {nombre}! Te recordamos tu turno en {sucursal} el {dia} a las {hora}. ¿Nos confirmás si venís?";
const DEFAULT_BIRTHDAY = "¡Feliz cumpleaños, {nombre}! Te saluda todo el equipo de {sucursal}.";

const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

function longDate(isoDate: string, withYear = false) {
  const d = new Date(`${isoDate}T12:00:00-03:00`);
  const text = d.toLocaleDateString("es-AR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00-03:00`);
  return d.toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
}

function durationLabel(m: number) {
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const ctx = await getContext();
  if (!ctx?.currentBranch) {
    return <p className="text-sm text-muted">No tenés sucursales asignadas.</p>;
  }

  const { fecha } = await searchParams;
  const today = todayISO();
  const day = fecha && ISO_DATE.test(fecha) ? fecha : today;
  const month = day.slice(0, 7);
  const grid = monthGrid(month);
  const gridStart = dayRange(grid[0]).start;
  const gridEnd = dayRange(grid[grid.length - 1]).end;
  const { start, end } = dayRange(day);
  const branchId = ctx.currentBranch.id;
  const supabase = await createClient();

  const [{ data: monthAppts }, { data: dayAppts }, { data: due }, { data: birthdays }, { data: pastPending }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("scheduled_at, status")
        .eq("branch_id", branchId)
        .gte("scheduled_at", gridStart)
        .lt("scheduled_at", gridEnd)
        .neq("status", "cancelled")
        .limit(3000),
      supabase
        .from("appointments")
        .select(
          "id, scheduled_at, duration_minutes, status, amount_paid, patient:patients(id, first_name, last_name, phone, notes), professional:professionals(full_name), items:appointment_items(zone, treatment:treatments(name))",
        )
        .eq("branch_id", branchId)
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .order("scheduled_at"),
      supabase.from("recall_due_by_branch").select("due_count").eq("branch_id", branchId).maybeSingle(),
      supabase.rpc("birthdays_on", { p_branch: branchId, p_date: day }),
      supabase
        .from("appointments")
        .select("scheduled_at")
        .eq("branch_id", branchId)
        .eq("status", "scheduled")
        .lt("scheduled_at", dayRange(today).start)
        .order("scheduled_at", { ascending: false })
        .limit(200),
    ]);

  // Turnos por día para el calendario
  const counts: Record<string, DayCount> = {};
  for (const a of monthAppts ?? []) {
    const k = localDay(a.scheduled_at);
    const c = (counts[k] ??= { total: 0, done: 0, pending: 0, noShow: 0 });
    c.total++;
    if (a.status === "completed") c.done++;
    else if (a.status === "scheduled") c.pending++;
    else if (a.status === "no_show") c.noShow++;
  }

  const rows = (dayAppts ?? []) as unknown as Row[];
  const active = rows.filter((r) => r.status !== "cancelled");
  const done = rows.filter((r) => r.status === "completed");
  const pending = rows.filter((r) => r.status === "scheduled");
  const noShows = rows.filter((r) => r.status === "no_show");
  const revenue = done.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
  const dueCount = due?.due_count ?? 0;

  // Primera visita a la sucursal
  const patientIds = [...new Set(rows.map((r) => r.patient?.id).filter((x): x is string => Boolean(x)))];
  const returning = new Set<string>();
  if (patientIds.length) {
    const { data: prior } = await supabase
      .from("appointments")
      .select("patient_id")
      .eq("branch_id", branchId)
      .eq("status", "completed")
      .in("patient_id", patientIds)
      .lt("scheduled_at", start)
      .limit(1000);
    for (const p of prior ?? []) returning.add(p.patient_id as string);
  }
  const firstVisits = active.filter((r) => r.patient && !returning.has(r.patient.id));

  const pastDays = [...new Set((pastPending ?? []).map((a) => localDay(a.scheduled_at)))];
  const pastCount = pastPending?.length ?? 0;
  const bdays = (birthdays ?? []) as { id: string; first_name: string; last_name: string | null; phone: string | null; age: number }[];

  const branchLabel = `${ctx.org.name} ${ctx.currentBranch.name}`;
  const reminderTpl = (ctx.org.settings.reminder_message as string | undefined) || DEFAULT_REMINDER;
  const birthdayTpl = (ctx.org.settings.birthday_message as string | undefined) || DEFAULT_BIRTHDAY;
  const canRemind = day >= today;

  const notices: React.ReactNode[] = [];
  if (bdays.length) {
    notices.push(
      <li key="bday" className="space-y-1">
        <p className="font-semibold">
          {bdays.length === 1 ? "Cumple años una paciente" : `Cumplen años ${bdays.length} pacientes`}
        </p>
        <ul className="flex flex-wrap gap-2">
          {bdays.map((b) => (
            <li key={b.id} className="flex items-center gap-1.5 rounded-full bg-surface py-0.5 pl-3 pr-1 text-sm">
              <Link href={`/pacientes/${b.id}`} className="hover:text-brand">
                {fullName(b)} <span className="text-muted">({b.age})</span>
              </Link>
              {b.phone && day === today && (
                <a
                  href={whatsappLink(b.phone, fillTemplate(birthdayTpl, { nombre: b.first_name, sucursal: branchLabel }))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                >
                  Saludar
                </a>
              )}
            </li>
          ))}
        </ul>
      </li>,
    );
  }
  if (firstVisits.length) {
    notices.push(
      <li key="first">
        <span className="font-semibold">
          {firstVisits.length === 1 ? "1 paciente viene por primera vez" : `${firstVisits.length} pacientes vienen por primera vez`}
        </span>
        <span className="text-muted">: conviene confirmar datos y consentimiento.</span>
      </li>,
    );
  }
  if (pastCount && day === today) {
    notices.push(
      <li key="past">
        <span className="font-semibold">
          {pastCount === 1 ? "Hay 1 turno de días anteriores sin registrar" : `Hay ${pastCount} turnos de días anteriores sin registrar`}
        </span>
        <span className="text-muted">. Marcalos como realizados o «No vino»: </span>
        {pastDays.slice(0, 4).map((d, i) => (
          <span key={d}>
            {i > 0 && ", "}
            <Link href={`/?fecha=${d}`} className="link" scroll={false}>
              {shortDate(d)}
            </Link>
          </span>
        ))}
      </li>,
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p className="page-sub">{ctx.currentBranch.name}</p>
        </div>
        <Link href={`/turnos/nuevo?fecha=${day}`} className="btn btn-primary">Nuevo turno</Link>
      </div>

      <MonthCalendar month={month} selected={day} today={today} counts={counts} />

      <section className="space-y-4" aria-label="Turnos del día">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-2xl font-normal">{longDate(day, day.slice(0, 4) !== today.slice(0, 4))}</h2>
          {day === today && <span className="badge badge-amber">Hoy</span>}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="Turnos"
            value={String(active.length)}
            hint={
              active.length === 0
                ? "Sin turnos"
                : [
                    pending.length && `${pending.length} por atender`,
                    done.length && `${done.length} realizados`,
                    noShows.length && `${noShows.length} no vinieron`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
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

        {notices.length > 0 && (
          <div className="card border-warn-line bg-warn-soft">
            <h3 className="mb-2 text-sm font-semibold text-warn">Para tener en cuenta</h3>
            <ul className="space-y-3 text-sm">{notices}</ul>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="card text-sm text-muted">
            No hay turnos este día.{" "}
            <Link href={`/turnos/nuevo?fecha=${day}`} className="link">Agendar un turno</Link>
          </div>
        ) : (
          <ol className="card divide-y divide-line p-0">
            {rows.map((r) => {
              const p = r.patient;
              const time = fmtTime(r.scheduled_at);
              const reminder =
                p?.phone && r.status === "scheduled" && canRemind
                  ? whatsappLink(
                      p.phone,
                      fillTemplate(reminderTpl, {
                        nombre: p.first_name,
                        sucursal: branchLabel,
                        dia: shortDate(day),
                        hora: time,
                      }),
                    )
                  : null;
              return (
                <li
                  key={r.id}
                  className={`grid grid-cols-[4.5rem_1fr] gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[4.5rem_1fr_auto] sm:items-center ${
                    r.status === "cancelled" ? "opacity-50" : ""
                  }`}
                >
                  <div>
                    <span className="block font-display text-xl leading-tight text-brand num">{time}</span>
                    <span className="text-xs text-muted">{durationLabel(r.duration_minutes)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {p ? (
                        <Link href={`/pacientes/${p.id}`} className="font-semibold hover:text-brand">
                          {fullName(p)}
                        </Link>
                      ) : (
                        <span className="font-semibold">Paciente</span>
                      )}
                      {p && !returning.has(p.id) && r.status !== "cancelled" && (
                        <span className="badge badge-amber">Primera vez</span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted">
                      {r.items
                        .map((i) => [i.treatment?.name, i.zone].filter(Boolean).join(" - "))
                        .join(", ") || "Sin tratamiento cargado"}
                      {r.professional ? ` con ${r.professional.full_name}` : ""}
                    </p>
                    {p?.notes && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink">
                        <span className="font-semibold">Nota:</span> {p.notes}
                      </p>
                    )}
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
                    <span className={STATUS_CLASS[r.status]}>{STATUS_LABEL[r.status]}</span>
                    {reminder && (
                      <a
                        href={reminder}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm"
                        aria-label={`Recordar turno a ${p ? fullName(p) : "la paciente"} por WhatsApp`}
                      >
                        <IconWhatsApp className="h-4 w-4" />
                        Recordar
                      </a>
                    )}
                    <Link
                      href={`/turnos/${r.id}`}
                      className={`btn btn-sm ${r.status === "scheduled" && day <= today ? "btn-primary" : ""}`}
                    >
                      {r.status === "scheduled" && day <= today ? "Registrar" : "Editar"}
                    </Link>
                    {r.status === "scheduled" && day <= today && (
                      <form action={setAppointmentStatus}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value="no_show" />
                        <button className="btn btn-sm">No vino</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
