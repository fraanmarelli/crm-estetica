// Montos en pesos tal como se escriben en la app (es-AR): «1.500,50» = mil quinientos con cincuenta.
// Sin React ni Next: lo usan el formulario del turno, las acciones del servidor y las pruebas
// (src/lib/money.test.ts).

/** Redondea a centavos (evita 9999,999999 al sumar 3333,33 + 3333,33 + 3333,34). */
export const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que escribió la persona → número. Vacío o inválido = 0 (para sumar en pantalla). */
export function parseMoney(s: string): number {
  const t = String(s ?? "").trim();
  if (t === "") return 0;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Lo que llega al servidor → número o null si está vacío o no es un número. */
export function numOrNull(v: string): number | null {
  if (v === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Número → texto para el servidor: sin puntos de miles y con coma decimal (así lo lee numOrNull). */
export const moneyForServer = (n: number) => String(roundCents(n)).replace(".", ",");

/** Precio de una promo repartido entre sus tratamientos: partes iguales en pesos enteros y el
 *  resto en el último, para que la suma dé exacto el precio de la promo. */
export function splitPromoPrice(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const share = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? roundCents(total - share * (parts - 1)) : share));
}

export type PaymentLine = { account_id: string; amount: string; exchange_rate: string };
export type AccountCurrency = { id: string; currency: string };

/** Cuánto suman en pesos las partes del cobro (igual que la base: los dólares cuentan solo con cotización). */
export function paidInPesos(list: PaymentLine[], accounts: AccountCurrency[]) {
  let ars = 0;
  let usdRated = 0;
  let usdUnrated = 0;
  for (const p of list) {
    const acc = accounts.find((a) => a.id === p.account_id);
    if (!acc) continue;
    const amount = parseMoney(p.amount);
    const rate = parseMoney(p.exchange_rate);
    if (acc.currency === "ARS") ars += amount;
    else if (rate > 0) {
      ars += roundCents(amount * rate);
      usdRated += amount;
    } else usdUnrated += amount;
  }
  return { ars: roundCents(ars), usdRated: roundCents(usdRated), usdUnrated: roundCents(usdUnrated) };
}
