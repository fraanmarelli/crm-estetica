import Link from "next/link";
import { AgendaViewToggle } from "@/components/agenda-view-toggle";
import { TZ, fmtMoney, fullName } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";

export type WeekAppt = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  amount_paid: number | null;
  patient: { first_name: string; last_name: string | null } | null;
  professional: { full_name: string } | null;
  items: { treatment: { name: string } | null }[];
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const PX_PER_MIN = 1; // 60 px por hora

const pad = (n: number) => String(n).padStart(2, "0");

// Lunes a domingo de la semana que contiene `day`
export function weekDays(day: string): string[] {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const offset = (date.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(Date.UTC(y, m - 1, d - offset + i));
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  });
}

export function shiftDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

function local(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    time: `${get("hour")}:${get("minute")}`,
  };
}

type Placed = WeekAppt & { start: number; end: number; time: string; lane: number; lanes: number };

// Ubica los turnos que se superponen uno al lado del otro
function placeDay(list: (WeekAppt & { start: number; end: number; time: string })[]): Placed[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const p of cluster) p.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const a of sorted) {
    if (cluster.length && a.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= a.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(a.end);
    } else {
      laneEnds[lane] = a.end;
    }
    cluster.push({ ...a, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, a.end);
  }
  if (cluster.length) flush();
  return out;
}

const BLOCK_CLASS: Record<AppointmentStatus, string> = {
  scheduled: "border-brand bg-brand-soft text-ink",
  completed: "border-ok bg-ok-soft text-ink",
  no_show: "border-bad bg-bad-soft text-ink",
  cancelled: "border-line bg-subtle text-muted",
};

function treatmentsOf(a: WeekAppt) {
  return a.items.map((i) => i.treatment?.name).filter(Boolean).join(", ") || "Sin tratamiento";
}

export function WeekCalendar({
  day,
  today,
  appts,
  currency,
}: {
  day: string;
  today: string;
  appts: WeekAppt[];
  currency: string;
}) {
  const days = weekDays(day);
  const active = appts.filter((a) => a.status !== "cancelled");

  const byDay = new Map<string, (WeekAppt & { start: number; end: number; time: string })[]>();
  for (const a of active) {
    const l = local(a.scheduled_at);
    const list = byDay.get(l.day) ?? [];
    list.push({ ...a, start: l.minutes, end: l.minutes + (a.duration_minutes || 30), time: l.time });
    byDay.set(l.day, list);
  }

  // Horario visible: 9 a 20 h, o más si hay turnos fuera de ese rango
  const all = [...byDay.values()].flat();
  const firstHour = Math.max(6, Math.min(9, ...all.map((a) => Math.floor(a.start / 60))));
  const lastHour = Math.min(24, Math.max(20, ...all.map((a) => Math.ceil(a.end / 60))));
  const gridStart = firstHour * 60;
  const height = (lastHour - firstHour) * 60 * PX_PER_MIN;
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  const now = local(new Date().toISOString());
  const nowTop = (now.minutes - gridStart) * PX_PER_MIN;

  // Resumen de la semana
  const done = active.filter((a) => a.status === "completed");
  const pending = active.filter((a) => a.status === "scheduled");
  const noShow = active.filter((a) => a.status === "no_show");
  const revenue = done.reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);
  const deposits = pending.reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);

  const first = days[0];
  const last = days[6];
  const title =
    first.slice(5, 7) === last.slice(5, 7)
      ? `${Number(first.slice(8))} al ${Number(last.slice(8))} de ${MONTHS_SHORT[Number(last.slice(5, 7)) - 1]}`
      : `${Number(first.slice(8))} ${MONTHS_SHORT[Number(first.slice(5, 7)) - 1]} al ${Number(last.slice(8))} ${MONTHS_SHORT[Number(last.slice(5, 7)) - 1]}`;

  const href = (d: string) => `/?fecha=${d}&vista=semana`;
  const apptHref = (a: WeekAppt, d: string) =>
    a.status === "scheduled" && d <= today ? `/turnos/${a.id}?cobrar=1&vista=semana` : `/turnos/${a.id}?vista=semana`;

  return (
    <section className="card space-y-3 p-3 sm:p-4" aria-label="Semana">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-normal">Semana del {title}</h2>
        <AgendaViewToggle day={day} view="semana" />
        <div className="ml-auto flex items-center gap-1">
          {!days.includes(today) && (
            <Link href={href(today)} className="btn btn-sm" scroll={false}>
              Hoy
            </Link>
          )}
          <Link href={href(shiftDays(day, -7))} className="btn btn-sm" aria-label="Semana anterior" scroll={false}>
            ‹
          </Link>
          <Link href={href(shiftDays(day, 7))} className="btn btn-sm" aria-label="Semana siguiente" scroll={false}>
            ›
          </Link>
        </div>
      </div>

      {/* Resumen de la semana */}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ["Turnos", String(active.length), pending.length ? `${pending.length} por atender` : "Ninguno pendiente"],
          ["Atendidas", String(done.length), active.length ? `${Math.round((done.length / active.length) * 100)}% de la semana` : ""],
          ["Cobrado", fmtMoney(revenue, currency), deposits ? `+ ${fmtMoney(deposits, currency)} en señas` : ""],
          ["No vinieron", String(noShow.length), noShow.length ? "Conviene recontactarlas" : "Sin ausentes"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-semibold leading-tight num">{value}</dd>
            {hint && <dd className="text-xs text-muted">{hint}</dd>}
          </div>
        ))}
      </dl>

      {/* Celular: lista por día */}
      <ol className="space-y-3 md:hidden">
        {days.map((d, i) => {
          const list = (byDay.get(d) ?? []).sort((a, b) => a.start - b.start);
          const selected = d === day;
          return (
            <li key={d} className={`overflow-hidden rounded-xl ${selected ? "ring-2 ring-chrome" : "bg-subtle/60"}`}>
              <Link
                href={href(d)}
                scroll={false}
                className={`flex items-center justify-between rounded-t-xl px-3 py-2 text-sm font-semibold ${
                  selected ? "bg-chrome text-chrome-ink" : d === today ? "text-brand" : ""
                } ${list.length ? "" : "rounded-b-xl"}`}
              >
                <span>
                  {WEEKDAYS[i]} {Number(d.slice(8))}
                  {d === today && " · Hoy"}
                </span>
                <span className={selected ? "text-chrome-muted" : "text-muted"}>
                  {list.length ? `${list.length} ${list.length === 1 ? "turno" : "turnos"}` : "Libre"}
                </span>
              </Link>
              {list.length > 0 && (
                <ul className="divide-y divide-line">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={apptHref(a, d)} className="flex items-start gap-3 px-3 py-2 hover:bg-subtle">
                        <span className="w-11 shrink-0 font-semibold text-brand num">{a.time}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {a.patient ? fullName(a.patient) : "Paciente"}
                          </span>
                          <span className="block truncate text-xs text-muted">{treatmentsOf(a)}</span>
                        </span>
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            a.status === "completed" ? "bg-ok" : a.status === "no_show" ? "bg-bad" : "bg-brand"
                          }`}
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {/* Escritorio: grilla horaria */}
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-x-1 pb-2">
            <span />
            {days.map((d, i) => {
              const count = byDay.get(d)?.length ?? 0;
              const selected = d === day;
              return (
                <Link
                  key={d}
                  href={href(d)}
                  scroll={false}
                  className={`rounded-xl px-2 py-1.5 text-center transition-colors ${
                    selected ? "bg-chrome text-chrome-ink" : "hover:bg-subtle"
                  }`}
                >
                  <span className={`block text-xs font-semibold ${selected ? "text-chrome-muted" : "text-muted"}`}>
                    {WEEKDAYS[i]}
                  </span>
                  <span
                    className={`block text-lg font-semibold leading-tight num ${
                      selected ? "gold-text" : d === today ? "text-brand" : ""
                    }`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <span className={`block text-[0.7rem] ${selected ? "text-chrome-muted" : "text-muted"}`}>
                    {count ? `${count} ${count === 1 ? "turno" : "turnos"}` : "—"}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-x-1">
            <div className="relative" style={{ height }}>
              {hours.map((h, i) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[0.7rem] text-muted num"
                  style={{ top: i * 60 * PX_PER_MIN }}
                >
                  {i === 0 ? "" : `${pad(h)}:00`}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const placed = placeDay(byDay.get(d) ?? []);
              return (
                <div
                  key={d}
                  className={`relative rounded-lg ${d === day ? "bg-brand-soft/40" : ""}`}
                  style={{
                    height,
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${60 * PX_PER_MIN}px)`,
                  }}
                >
                  {placed.map((a) => {
                    const top = (a.start - gridStart) * PX_PER_MIN;
                    const h = Math.max((a.end - a.start) * PX_PER_MIN - 2, 22);
                    const width = 100 / a.lanes;
                    return (
                      <Link
                        key={a.id}
                        href={apptHref(a, d)}
                        title={`${a.time} · ${a.patient ? fullName(a.patient) : "Paciente"} · ${treatmentsOf(a)}${a.professional ? ` · ${a.professional.full_name}` : ""}`}
                        className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-[0.72rem] leading-tight shadow-sm transition-[filter] hover:brightness-95 ${BLOCK_CLASS[a.status]}`}
                        style={{ top, height: h, left: `calc(${a.lane * width}% + 1px)`, width: `calc(${width}% - 2px)` }}
                      >
                        <span className="block font-semibold num">
                          {a.time} {a.status === "completed" ? "✓" : a.status === "no_show" ? "· No vino" : ""}
                        </span>
                        <span className="block truncate font-semibold">{a.patient ? fullName(a.patient) : "Paciente"}</span>
                        {h >= 44 && <span className="block truncate text-muted">{treatmentsOf(a)}</span>}
                        {h >= 60 && a.professional && (
                          <span className="block truncate text-muted">{a.professional.full_name}</span>
                        )}
                      </Link>
                    );
                  })}
                  {d === today && nowTop > 0 && nowTop < height && (
                    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }} aria-hidden="true">
                      <div className="h-0.5 bg-bad" />
                      <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-bad" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
