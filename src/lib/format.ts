import type { AppointmentStatus, RecallOutcome, Role } from "./types";

// Argentina no tiene horario de verano desde 2009: offset fijo -03:00.
export const TZ = "America/Argentina/Buenos_Aires";
export const TZ_OFFSET = "-03:00";

export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function dayRange(isoDate: string): { start: string; end: string } {
  const start = new Date(`${isoDate}T00:00:00${TZ_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// "2026-11-03T15:30" (input datetime-local) -> ISO UTC
export function localInputToISO(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00${TZ_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ISO UTC -> "2026-11-03T15:30" para precargar un input datetime-local
export function isoToLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T12:00:00${TZ_OFFSET}`) : new Date(value);
  return d.toLocaleDateString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtTime(value: string): string {
  // Siempre 24 h (10:30, 14:00): en algunos servidores es-AR sale con "a. m."
  return new Date(value).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return `${fmtDate(value)} ${fmtTime(value)}`;
}

export function fmtMoney(value: number | string | null | undefined, currency = "ARS"): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
}

export function monthsSince(iso: string): number {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.max(1, Math.round(days / 30.4));
}

export function daysUntil(isoDate: string): number {
  const today = new Date(`${todayISO()}T12:00:00${TZ_OFFSET}`).getTime();
  const target = new Date(`${isoDate}T12:00:00${TZ_OFFSET}`).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function whatsappLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}

export function fullName(p: { first_name: string; last_name: string | null }): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

export const DEFAULT_RECALL_MESSAGE =
  "Hola {nombre}! Te escribimos de {sucursal}. Ya pasaron {meses} meses de tu {tratamiento}. ¿Querés que te reservemos un turno?";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  completed: "Atendida",
  no_show: "No vino",
  cancelled: "Cancelado",
};

export const STATUS_CLASS: Record<AppointmentStatus, string> = {
  scheduled: "badge badge-blue",
  completed: "badge badge-green",
  no_show: "badge badge-red",
  cancelled: "badge badge-gray",
};

export const OUTCOME_LABEL: Record<RecallOutcome, string> = {
  no_answer: "No respondió",
  booked: "Reservó turno",
  later: "Más adelante",
  not_interested: "No le interesa",
  wrong_number: "Número equivocado",
  opted_out: "Pidió no ser contactada",
};

export const ROLE_LABEL: Record<Role, string> = {
  network_owner: "Marca",
  network_admin: "Equipo de la marca",
  branch_admin: "Franquiciado/a",
  reception: "Recepción",
  professional: "Profesional",
};

export const PAYMENT_METHODS = [
  "Efectivo",
  "Transferencia",
  "Mercado Pago",
  "Tarjeta de débito",
  "Tarjeta de crédito",
  "Otro",
];

export const PATIENT_SOURCES = [
  "Instagram",
  "Facebook",
  "Google",
  "TikTok",
  "Referido/a",
  "Pasó por la puerta",
  "Otro",
];

export const SOCIAL_SOURCES = ["Instagram", "Facebook"];

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-AR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function isoDaysAgo(days: number): string {
  const d = new Date(`${todayISO()}T12:00:00${TZ_OFFSET}`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Plural simple en español: unidad → unidades, jeringa → jeringas
export function pluralEs(word: string): string {
  if (!word) return word;
  // Abreviaturas (ml, cc, u) no se pluralizan
  if (word.length <= 2 || !/[aeiouáéíóú]/i.test(word)) return word;
  return /[aeiouáéó]$/i.test(word) ? `${word}s` : `${word}es`;
}

// Montos mientras se escriben: punto cada 3 cifras y coma para decimales (10.000.000 / 1.450,50).
// Los parsers del servidor ya sacan los puntos y cambian la coma por punto.
export function groupThousands(raw: string): string {
  const clean = String(raw ?? "").replace(/[^\d,]/g, "");
  if (!clean) return "";
  const [intPart, ...rest] = clean.split(",");
  const digits = intPart.replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return rest.length ? `${grouped || "0"},${rest.join("").slice(0, 2)}` : grouped;
}

// Número guardado (ej. 1450.5) a como se muestra en un campo (1.450,5)
export function moneyInputValue(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const [i, d] = String(n).split(".");
  const dec = d && Number(d) !== 0 ? `,${d.replace(/0+$/, "")}` : "";
  return groupThousands(i) + dec;
}
