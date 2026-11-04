import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { DayList, shortDate, type DayRow } from "@/components/day-list";
import { loadTransferChecks } from "@/components/transfer-status";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/context";
import {
  TZ,
  dayRange,
  fillTemplate,
  fmtMoney,
  fullName,
  todayISO,
  whatsappLink,
} from "@/lib/format";
import { Kpi } from "@/components/kpi";
import { MonthCalendar, monthGrid, type DayCount } from "@/components/month-calendar";
import { WeekCalendar, weekDays, type WeekAppt } from "@/components/week-calendar";

type Row = DayRow;

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

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; vista?: string }>;
}) {
  const ctx = await getContext();
  if (!ctx?.currentBranch) {
    return <p className="text-sm text-muted">No tenés sucursales asignadas.</p>;
  }

  const { fecha, vista } = await searchParams;
  const view: "mes" | "semana" = vista === "semana" ? "semana" : "mes";
  const today = todayISO();
  const day = fecha && ISO_DATE.test(fecha) ? fecha : today;
  const month = day.slice(0, 7);
  const grid = view === "semana" ? weekDays(day) : monthGrid(month);
  const gridStart = dayRange(grid[0]).start;
  const gridEnd = dayRange(grid[grid.length - 1]).end;
  const { start, end } = dayRange(day);
  const branchId = ctx.currentBranch.id;
  const supabase = await createClient();

  const [
    { data: monthAppts },
    { data: dayAppts },
    { data: due },
    { data: birthdays },
    { data: pastPending },
    { data: holderData },
  ] = await Promise.all([
      // Mes: solo cuántos turnos hay por día. Semana: el detalle de cada turno.
      supabase
        .from("appointments")
        .select(
          view === "semana"
            ? "id, scheduled_at, duration_minutes, status, amount_paid, patient:patients(first_name, last_name), professional:professionals(full_name), items:appointment_items(treatment:treatments(name))"
            : "scheduled_at, status",
        )
        .eq("branch_id", branchId)
        .gte("scheduled_at", gridStart)
        .lt("scheduled_at", gridEnd)
        .neq("status", "cancelled")
        .order("scheduled_at")
        .limit(3000),
      supabase
        .from("appointments")
        .select(
          `id, scheduled_at, duration_minutes, status, amount_paid, amount_usd, patient:patients(id, first_name, last_name, phone, notes, consent_data_at), professional:professionals(full_name), items:appointment_items(zone, treatment:treatments(name))`,
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
      // Topes del monotributo: solo franquiciado (y marca)
      ctx.canManageCurrentBranch
        ? supabase.rpc("holder_status", { p_branch: branchId })
        : Promise.resolve({ data: null }),
    ]);

  // Turnos por día para el calendario
  const counts: Record<string, DayCount> = {};
  for (const a of (monthAppts ?? []) as unknown as { scheduled_at: string; status: string }[]) {
    const k = localDay(a.scheduled_at);
    const c = (counts[k] ??= { total: 0, done: 0, pending: 0, noShow: 0 });
    c.total++;
    if (a.status === "completed") c.done++;
    else if (a.status === "scheduled") c.pending++;
    else if (a.status === "no_show") c.noShow++;
  }

  const rows = (dayAppts ?? []) as unknown as Row[];
  // Verificación de transferencias aparte: si falla (ej. falta la migración) la agenda se ve igual
  const checksByAppt = await loadTransferChecks(supabase, rows.map((r) => r.id));
  for (const r of rows) r.checks = checksByAppt.get(r.id) ?? [];
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
  // Solo las que todavía no se atendieron (y con ficha completa: las incompletas ya tienen su aviso)
  const firstVisits = pending.filter((r) => r.patient && r.patient.consent_data_at && !returning.has(r.patient.id));

  const pastDays = [...new Set((pastPending ?? []).map((a) => localDay(a.scheduled_at)))];
  const pastCount = pastPending?.length ?? 0;
  const bdays = (birthdays ?? []) as { id: string; first_name: string; last_name: string | null; phone: string | null; age: number }[];

  const branchLabel = `${ctx.org.name} ${ctx.currentBranch.name}`;
  const reminderTpl = (ctx.org.settings.reminder_message as string | undefined) || DEFAULT_REMINDER;
  const birthdayTpl = (ctx.org.settings.birthday_message as string | undefined) || DEFAULT_BIRTHDAY;
  const canRemind = day >= today;
  const viewParam = view === "semana" ? "&vista=semana" : "";

  const billingAlerts = ((holderData ?? []) as {
    holder_id: string;
    name: string;
    annual_limit: number | null;
    last12_total: number;
    level: string;
  }[]).filter((h) => h.level === "warn" || h.level === "over");

  const waitingTransfer = rows.some((r) => r.checks?.some((c) => c.status === "pending"));

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
        <span className="text-muted">. Cobralos o marcalos «No vino»: </span>
        {pastDays.slice(0, 4).map((d, i) => (
          <span key={d}>
            {i > 0 && ", "}
            <Link href={`/?fecha=${d}${viewParam}`} className="link" scroll={false}>
              {shortDate(d)}
            </Link>
          </span>
        ))}
      </li>,
    );
  }


  // Un turno: hora grande y legible, paciente y qué se hace, y a la derecha el estado o las acciones
  return (
    <div className="space-y-6">
      {waitingTransfer && <AutoRefresh />}
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p className="page-sub">{ctx.currentBranch.name}</p>
        </div>
        <Link href={`/turnos/nuevo?fecha=${day}${viewParam}`} className="btn btn-primary">Nuevo turno</Link>
      </div>

      {billingAlerts.length > 0 && (
        <div className="space-y-2">
          {billingAlerts.map((h) => {
            const total = Number(h.last12_total);
            const limit = Number(h.annual_limit);
            const over = h.level === "over";
            return (
              <Link
                key={h.holder_id}
                href="/facturacion"
                className={`block rounded-xl border px-4 py-3 text-sm ${
                  over ? "border-bad-line bg-bad-soft text-bad" : "border-warn-line bg-warn-soft text-warn"
                }`}
              >
                <b>{h.name}</b>{" "}
                {over
                  ? `llegó al tope del monotributo: ${fmtMoney(total)} de ${fmtMoney(limit)} en los últimos 12 meses. Revisalo con tu contador.`
                  : `ya facturó el ${Math.floor((total / limit) * 100)}% de su tope: ${fmtMoney(total)} de ${fmtMoney(limit)} en 12 meses (le quedan ${fmtMoney(limit - total)}).`}{" "}
                <span className="underline underline-offset-2">Ver facturación</span>
              </Link>
            );
          })}
        </div>
      )}

      {view === "semana" ? (
        <WeekCalendar
          day={day}
          today={today}
          appts={(monthAppts ?? []) as unknown as WeekAppt[]}
          currency={ctx.org.currency}
        />
      ) : (
        <MonthCalendar month={month} selected={day} today={today} counts={counts} />
      )}

      <section className="space-y-4" aria-label="Turnos del día">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-2xl font-normal">{longDate(day, day.slice(0, 4) !== today.slice(0, 4))}</h2>
          {day === today && <span className="badge badge-amber">Hoy</span>}
        </div>

        <div className="kpi-row grid grid-cols-3 gap-2 sm:gap-3">
          <Kpi
            label="Turnos"
            value={String(active.length)}
            hint={
              active.length === 0
                ? "Sin turnos"
                : [
                    pending.length && `${pending.length} por atender`,
                    done.length && `${done.length} atendidas`,
                    noShows.length && `${noShows.length} no vinieron`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
          />
          <Kpi label="Cobrado" value={fmtMoney(revenue, ctx.org.currency)} hint={done.length === 1 ? "1 atendida" : `${done.length} atendidas`} />
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
            <Link href={`/turnos/nuevo?fecha=${day}${viewParam}`} className="link">Agendar un turno</Link>
          </div>
        ) : (
          <DayList
            rows={rows}
            returningIds={[...returning]}
            day={day}
            today={today}
            viewParam={viewParam}
            canRemind={canRemind}
            reminderTpl={reminderTpl}
            branchLabel={branchLabel}
            currency={ctx.org.currency}
          />
        )}
      </section>
    </div>
  );
}
