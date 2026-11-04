import Link from "next/link";
import { AgendaViewToggle } from "@/components/agenda-view-toggle";

export type DayCount = { total: number; done: number; pending: number; noShow: number };

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Días visibles en la grilla (semanas de lunes a domingo que cubren el mes)
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => isoOf(new Date(Date.UTC(y, m - 1, 1 - offset + i))));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function MonthCalendar({
  month,
  selected,
  today,
  counts,
}: {
  month: string; // YYYY-MM
  selected: string; // YYYY-MM-DD
  today: string;
  counts: Record<string, DayCount>;
}) {
  const [y, m] = month.split("-").map(Number);
  const days = monthGrid(month);
  const monthLink = (target: string) =>
    target === today.slice(0, 7) ? `/?fecha=${today}` : `/?fecha=${target}-01`;

  return (
    <section className="card space-y-3 p-3 sm:p-4" aria-label="Calendario">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-normal">
          {MONTHS[m - 1]} {y}
        </h2>
        <AgendaViewToggle day={selected} view="mes" />
        <div className="ml-auto flex items-center gap-1">
          {selected !== today && (
            <Link href={`/?fecha=${today}`} className="btn btn-sm" scroll={false}>
              Hoy
            </Link>
          )}
          <Link href={monthLink(shiftMonth(month, -1))} className="btn btn-sm" aria-label="Mes anterior" scroll={false}>
            ‹
          </Link>
          <Link href={monthLink(shiftMonth(month, 1))} className="btn btn-sm" aria-label="Mes siguiente" scroll={false}>
            ›
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((iso) => {
          const inMonth = iso.startsWith(month);
          const isSelected = iso === selected;
          const isToday = iso === today;
          const c = counts[iso];
          const dayNum = Number(iso.slice(8));
          return (
            <Link
              key={iso}
              href={`/?fecha=${iso}`}
              scroll={false}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${dayNum} de ${MONTHS[Number(iso.slice(5, 7)) - 1]}${c?.total ? `, ${c.total} turnos` : ""}`}
              className={`flex min-h-[3.25rem] flex-col justify-between rounded-xl border p-1.5 text-left transition-colors sm:min-h-[4.5rem] sm:p-2 ${
                isSelected
                  ? "border-chrome bg-chrome text-chrome-ink"
                  : isToday
                    ? "border-brand bg-surface hover:bg-subtle"
                    : "border-transparent hover:border-line hover:bg-subtle"
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <span
                className={`num text-sm leading-none ${isSelected ? "gold-text font-bold" : isToday ? "font-bold text-brand" : "font-medium"}`}
              >
                {dayNum}
              </span>
              {c && c.total > 0 && (
                <span className="flex items-center gap-1">
                  <span
                    className={`num rounded-full px-1.5 text-[0.7rem] font-semibold leading-5 ${
                      isSelected ? "bg-chrome-ink/10" : c.pending > 0 ? "bg-brand-soft text-brand" : "bg-subtle text-muted"
                    }`}
                  >
                    {c.total}
                    <span className="hidden sm:inline">{c.total === 1 ? " turno" : " turnos"}</span>
                  </span>
                  {c.noShow > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" title="Hubo ausentes" />}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
