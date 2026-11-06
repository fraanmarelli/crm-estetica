import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { setAppointmentStatus } from "@/app/(app)/actions";
import { IconWhatsApp } from "@/components/icons";
import { TransferStatus, type TransferCheck } from "@/components/transfer-status";
import { TZ, fillTemplate, fmtMoney, fmtTime, fullName, whatsappLink } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";

export type DayRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  amount_paid: number | null;
  amount_usd: number | null;
  patient: {
    id: string;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    notes: string | null;
    consent_data_at: string | null;
  } | null;
  professional: { full_name: string } | null;
  items: { zone: string | null; treatment: { name: string } | null }[];
  checks: TransferCheck[];
};

export function shortDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00-03:00`);
  return d.toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
}

function durationLabel(m: number) {
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
}

// Turnos del día en dos tarjetas: las que faltan atender arriba, las ya resueltas abajo
export function DayList({
  rows,
  returningIds,
  day,
  today,
  viewParam,
  canRemind,
  reminderTpl,
  branchLabel,
  currency,
  highlightId = null,
  readOnly = false,
}: {
  rows: DayRow[];
  returningIds: string[];
  day: string;
  today: string;
  viewParam: string;
  canRemind: boolean;
  reminderTpl: string;
  branchLabel: string;
  currency: string;
  // El turno recién guardado: destello suave al volver a la agenda
  highlightId?: string | null;
  // Profesional: ve sus turnos y abre la ficha; no cobra, no marca ausencias, no ve montos
  readOnly?: boolean;
}) {
  const returning = new Set(returningIds);
  const pending = rows.filter((r) => r.status === "scheduled");
  const finished = rows.filter((r) => r.status !== "scheduled");
  const done = rows.filter((r) => r.status === "completed");
  const noShows = rows.filter((r) => r.status === "no_show");
  const cancelled = rows.filter((r) => r.status === "cancelled");

  function renderRow(r: DayRow) {
    const p = r.patient;
    const time = fmtTime(r.scheduled_at);
    const isPending = r.status === "scheduled";
    const reminder =
      p?.phone && isPending && canRemind
        ? whatsappLink(
            p.phone,
            fillTemplate(reminderTpl, { nombre: p.first_name, sucursal: branchLabel, dia: shortDate(day), hora: time }),
          )
        : null;
    const treatmentsText =
      r.items.map((i) => [i.treatment?.name, i.zone].filter(Boolean).join(" - ")).join(", ") || "Sin tratamiento cargado";
    return (
      <li
        key={r.id}
        className={`grid grid-cols-[3.75rem_1fr] gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[3.75rem_1fr_auto] sm:items-center ${
          r.status === "cancelled" ? "opacity-55" : ""
        } ${r.id === highlightId ? "flash" : ""}`}
      >
        <div className="leading-tight">
          <span className={`num block text-lg font-semibold ${isPending ? "text-ink" : "text-muted"}`}>{time}</span>
          <span className="text-xs text-muted">{durationLabel(r.duration_minutes)}</span>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {p ? (
              <Link href={`/pacientes/${p.id}`} className="text-[0.98rem] font-semibold hover:text-brand">
                {fullName(p)}
              </Link>
            ) : (
              <span className="font-semibold">Paciente</span>
            )}
            {isPending && p && p.consent_data_at && !returning.has(p.id) && (
              <span className="badge badge-amber">Primera vez</span>
            )}
            {p && !p.consent_data_at && r.status !== "cancelled" && (
              <Link
                href={`/pacientes/${p.id}/completar?volver=${encodeURIComponent(`/?fecha=${day}${viewParam}`)}`}
                className="badge badge-amber hover:underline"
              >
                Ficha incompleta · completar
              </Link>
            )}
            {isPending && (Number(r.amount_paid) > 0 || Number(r.amount_usd) > 0) && (
              <span className="badge badge-green">
                Señó {Number(r.amount_paid) > 0 ? fmtMoney(r.amount_paid, currency) : fmtMoney(r.amount_usd, "USD")}
              </span>
            )}
          </div>
          <p className="truncate text-sm text-muted">
            {treatmentsText}
            {r.professional ? ` · ${r.professional.full_name}` : ""}
          </p>
          {r.checks?.length > 0 && <TransferStatus checks={r.checks} compact />}
          {p?.notes && isPending && (
            <p className="line-clamp-2 text-xs">
              <span className="font-semibold">Nota:</span> {p.notes}
            </p>
          )}
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
          {r.status === "completed" && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ok">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Atendida
              {!readOnly && Number(r.amount_paid) > 0 && (
                <span className="num font-normal text-muted">· {fmtMoney(r.amount_paid, currency)}</span>
              )}
            </span>
          )}
          {r.status === "no_show" && <span className="text-sm font-semibold text-bad">No vino</span>}
          {r.status === "cancelled" && <span className="text-sm text-muted">Cancelado</span>}
          {reminder && !readOnly && (
            <a
              href={reminder}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm"
              aria-label={`Recordar turno a ${p ? fullName(p) : "la paciente"} por WhatsApp`}
            >
              <IconWhatsApp className="h-4 w-4" />
              <span className="hidden sm:inline">Recordar</span>
            </a>
          )}
          {readOnly ? (
            p && (
              <Link href={`/pacientes/${p.id}`} className="btn btn-sm">
                Ver ficha
              </Link>
            )
          ) : isPending && day <= today ? (
            <>
              <form action={setAppointmentStatus}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="status" value="no_show" />
                <SubmitButton className="btn btn-sm" pendingText="Marcando...">No vino</SubmitButton>
              </form>
              <Link href={`/turnos/${r.id}?cobrar=1${viewParam}`} className="btn btn-sm btn-primary">
                Cobrar
              </Link>
            </>
          ) : (
            <Link href={`/turnos/${r.id}${viewParam ? "?vista=semana" : ""}`} className="btn btn-sm">
              {r.status === "completed" ? "Ver cobro" : "Editar"}
            </Link>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <section className="card space-y-1 p-0" aria-label="Por atender">
          <h3 className="px-4 pt-4 text-sm font-semibold text-muted">
            Por atender <span className="num text-ink">{pending.length}</span>
          </h3>
          <ol className="divide-y divide-line">{pending.map(renderRow)}</ol>
        </section>
      )}
      {finished.length > 0 && (
        <section className="card space-y-1 p-0" aria-label="Atendidas y ausentes">
          <h3 className="px-4 pt-4 text-sm font-semibold text-muted">
            {[
              done.length && `Atendidas ${done.length}`,
              noShows.length && `No vinieron ${noShows.length}`,
              cancelled.length && `Canceladas ${cancelled.length}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </h3>
          <ol className="divide-y divide-line">{finished.map(renderRow)}</ol>
        </section>
      )}
    </div>
  );
}
