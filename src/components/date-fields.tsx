"use client";

import { useEffect, useRef, useState } from "react";

// Fecha y hora cómodas en la compu. En el celular (pantalla táctil) se usa el selector nativo,
// que ahí funciona bien; en la compu, un calendario propio y una lista de horarios.
// El valor que viaja en el formulario es siempre el mismo: "AAAA-MM-DD" o "AAAA-MM-DDTHH:mm".

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}
function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
function longLabel(iso: string) {
  if (!ISO.test(iso)) return "Elegí el día";
  const { y, m, d } = parts(iso);
  const wd = new Date(Date.UTC(y, m, d, 12)).getUTCDay();
  return `${DAY_NAMES[wd]} ${d} de ${MONTHS[m]}${y !== Number(todayIso().slice(0, 4)) ? ` de ${y}` : ""}`;
}
const isoToDmy = (iso: string) => (ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

// Mientras se escribe: 05112026 → 05/11/2026
function maskDmy(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
function dmyToIso(dmy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return date.getUTCDate() === Number(dd) && date.getUTCMonth() === Number(mm) - 1 ? `${yyyy}-${mm}-${dd}` : null;
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

// Calendario de un mes (lunes primero)
export function MonthPicker({
  value,
  onPick,
  yearNav = false,
}: {
  value: string;
  onPick: (iso: string) => void;
  yearNav?: boolean;
}) {
  const today = todayIso();
  const start = parts(ISO.test(value) ? value : today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const move = (delta: number) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  return (
    <div className="w-72 space-y-2 p-3">
      <div className="flex items-center justify-between gap-1">
        {yearNav && (
          <button type="button" className="btn btn-sm px-2" onClick={() => move(-12)} aria-label="Año anterior">«</button>
        )}
        <button type="button" className="btn btn-sm px-2.5" onClick={() => move(-1)} aria-label="Mes anterior">‹</button>
        <span className="flex-1 text-center text-sm font-semibold capitalize">
          {MONTHS[view.m]} {view.y}
        </span>
        <button type="button" className="btn btn-sm px-2.5" onClick={() => move(1)} aria-label="Mes siguiente">›</button>
        {yearNav && (
          <button type="button" className="btn btn-sm px-2" onClick={() => move(12)} aria-label="Año siguiente">»</button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-muted">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = toIso(view.y, view.m, i + 1);
          const selected = iso === value;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className={`num rounded-lg py-1.5 transition-colors ${
                selected
                  ? "bg-brand font-semibold text-[var(--surface)]"
                  : isToday
                    ? "font-semibold text-brand ring-1 ring-brand/40 hover:bg-subtle"
                    : "hover:bg-subtle"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between pt-1 text-xs">
        <button type="button" className="link" onClick={() => onPick(today)}>Hoy</button>
      </div>
    </div>
  );
}

function Popover({ open, children }: { open: boolean; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="absolute left-0 top-full z-40 mt-1 rounded-2xl bg-surface shadow-[var(--shadow-card-hover)]">
      {children}
    </div>
  );
}

// Horarios cada 15 minutos para la lista (más el elegido si no cae justo)
function timeSlots(current: string) {
  const out: string[] = [];
  for (let h = 7; h <= 22; h++) for (const m of [0, 15, 30, 45]) out.push(`${pad(h)}:${pad(m)}`);
  if (current && !out.includes(current)) out.push(current);
  return out.sort();
}

/** Fecha y hora de un turno. `value`/`onChange` en formato "AAAA-MM-DDTHH:mm". */
export function DateTimeField({
  id,
  name,
  value,
  onChange,
}: {
  id?: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || "10:00";

  return (
    <>
      <input type="hidden" name={name} value={value} />
      {/* Celular y tablet: el nativo */}
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input touch-only"
        aria-label="Fecha y hora"
      />
      {/* Compu: calendario + horarios */}
      <div ref={ref} className="pointer-only relative grid grid-cols-[1fr_6.5rem] gap-2">
        <button
          type="button"
          className="input text-left"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {longLabel(date)}
        </button>
        <select
          value={time}
          onChange={(e) => onChange(`${date || todayIso()}T${e.target.value}`)}
          className="input num"
          aria-label="Hora"
        >
          {timeSlots(time).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <Popover open={open}>
          <MonthPicker
            value={date}
            onPick={(iso) => {
              onChange(`${iso}T${time}`);
              setOpen(false);
            }}
          />
        </Popover>
      </div>
    </>
  );
}

/**
 * Solo fecha (nacimiento, vencimiento). En la compu se escribe "dd/mm/aaaa" (las barras se ponen
 * solas) o se elige en el calendario; en el celular, el nativo.
 */
export function DateField({
  id,
  name,
  defaultValue = "",
  className = "input",
  birthday = false,
  autoComplete,
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  className?: string;
  /** Fecha de nacimiento: el calendario permite saltar de a años */
  birthday?: boolean;
  autoComplete?: string;
}) {
  const [iso, setIso] = useState(ISO.test(defaultValue) ? defaultValue : "");
  const [text, setText] = useState(isoToDmy(defaultValue));
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const invalid = text.length === 10 && !dmyToIso(text);

  return (
    <>
      <input type="hidden" name={name} value={iso} />
      <input
        id={id}
        type="date"
        autoComplete={autoComplete}
        value={iso}
        onChange={(e) => {
          setIso(e.target.value);
          setText(isoToDmy(e.target.value));
        }}
        className={`${className} touch-only`}
      />
      <div ref={ref} className="pointer-only relative">
        <input
          value={text}
          onChange={(e) => {
            const masked = maskDmy(e.target.value);
            setText(masked);
            setIso(dmyToIso(masked) ?? "");
          }}
          placeholder="dd/mm/aaaa"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Fecha (día/mes/año)"
          aria-invalid={invalid}
          className={`${className} num pr-10 ${invalid ? "border-bad" : ""}`}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
          onClick={() => setOpen((o) => !o)}
          aria-label="Abrir calendario"
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
          </svg>
        </button>
        <Popover open={open}>
          <MonthPicker
            value={iso}
            yearNav={birthday}
            onPick={(picked) => {
              setIso(picked);
              setText(isoToDmy(picked));
              setOpen(false);
            }}
          />
        </Popover>
      </div>
    </>
  );
}
