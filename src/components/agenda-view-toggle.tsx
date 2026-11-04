import Link from "next/link";
import { IconViewMonth, IconViewWeek } from "@/components/icons";

// Selector Mes / Semana de la agenda
export function AgendaViewToggle({ day, view }: { day: string; view: "mes" | "semana" }) {
  const item = (v: "mes" | "semana", label: string, Icon: typeof IconViewMonth) => (
    <Link
      href={v === "mes" ? `/?fecha=${day}` : `/?fecha=${day}&vista=semana`}
      scroll={false}
      aria-current={view === v ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        view === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
  return (
    <div className="flex rounded-full bg-subtle p-0.5" role="group" aria-label="Vista de la agenda">
      {item("mes", "Mes", IconViewMonth)}
      {item("semana", "Semana", IconViewWeek)}
    </div>
  );
}
