// Cruce de transferencias entrantes de Mercado Pago con cobros cargados en el CRM.
// Función pura (sin red ni base) para poder probarla. Basado en la conciliación de ConfirmaYa.

export type Transfer = {
  id: string;
  cents: number;
  /** CUIT/CUIL de quien transfirió (solo dígitos) o null si MP no lo informó. */
  cuit: string | null;
  at: Date;
};

export type Check = {
  id: string;
  cents: number;
  /** DNI de la paciente (solo dígitos) o null. */
  dni: string | null;
  createdAt: Date;
};

export type Outcome =
  | { checkId: string; status: "verified"; transfer: Transfer; matchedBy: "dni" | "amount"; note: string | null }
  | { checkId: string; status: "review" | "pending" | "not_found"; note: string | null };

/** La transferencia puede llegar hasta 72 h antes (seña desde la casa) o después de cargar el cobro. */
export const WINDOW_MS = 72 * 60 * 60 * 1000;

export function digits(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}

/** CUIT = XX + DNI (8) + X. Algunos medios informan directamente el DNI. */
export function cuitMatchesDni(cuit: string | null, dni: string | null): boolean {
  if (!cuit || !dni || dni.length < 7 || dni.length > 8) return false;
  if (cuit.length === 11) return cuit.slice(2, 10) === dni.padStart(8, "0");
  if (cuit.length === 7 || cuit.length === 8) return cuit.padStart(8, "0") === dni.padStart(8, "0");
  return false;
}

const inWindow = (t: Transfer, c: Check) => Math.abs(t.at.getTime() - c.createdAt.getTime()) <= WINDOW_MS;
const closest = (list: Transfer[], c: Check) =>
  [...list].sort(
    (a, b) => Math.abs(a.at.getTime() - c.createdAt.getTime()) - Math.abs(b.at.getTime() - c.createdAt.getTime()),
  )[0];

/**
 * 1) Transferencia por el monto exacto, del DNI de la paciente y dentro de la ventana.
 * 2) Si no hay: por monto exacto, de alguien que no es otra paciente con cobro pendiente.
 * Se asigna solo si la transferencia elegida no la reclama otro cobro; si hay dudas, «review».
 * `transfers` ya viene sin las transferencias usadas por otros cobros.
 */
export function matchTransfers(transfers: Transfer[], checks: Check[], now = new Date()): Outcome[] {
  const byDni = new Map<string, Transfer[]>();
  for (const c of checks) {
    byDni.set(
      c.id,
      transfers.filter((t) => t.cents === c.cents && inWindow(t, c) && cuitMatchesDni(t.cuit, c.dni)),
    );
  }
  // Transferencias que son de otra paciente con un cobro pendiente: no se usan por monto solo
  const ownedByOther = (t: Transfer, self: Check) =>
    checks.some((o) => o.id !== self.id && (byDni.get(o.id) ?? []).some((x) => x.id === t.id));

  const choice = new Map<string, { list: Transfer[]; by: "dni" | "amount" }>();
  for (const c of checks) {
    const dniList = byDni.get(c.id) ?? [];
    if (dniList.length) choice.set(c.id, { list: dniList, by: "dni" });
    else {
      const amountList = transfers.filter((t) => t.cents === c.cents && inWindow(t, c) && !ownedByOther(t, c));
      choice.set(c.id, { list: amountList, by: "amount" });
    }
  }

  // Cada transferencia elegida, ¿cuántos cobros la quieren?
  const picked = new Map<string, Transfer | null>();
  const claims = new Map<string, number>();
  for (const c of checks) {
    const { list, by } = choice.get(c.id)!;
    const t = by === "dni" ? closest(list, c) : list.length === 1 ? list[0] : null;
    picked.set(c.id, t ?? null);
    if (t) claims.set(t.id, (claims.get(t.id) ?? 0) + 1);
  }

  return checks.map((c): Outcome => {
    const { list, by } = choice.get(c.id)!;
    const t = picked.get(c.id) ?? null;
    if (t && claims.get(t.id) === 1) {
      const note =
        by === "amount" && c.dni
          ? `Llegó por ese monto pero de otra persona${t.cuit ? ` (CUIT ${t.cuit})` : ""}`
          : by === "amount"
            ? "Verificada por monto: la paciente no tiene DNI cargado"
            : null;
      return { checkId: c.id, status: "verified", transfer: t, matchedBy: by, note };
    }
    if (t || list.length > 1) {
      return {
        checkId: c.id,
        status: "review",
        note:
          list.length > 1
            ? `Hay ${list.length} transferencias por ese monto: confirmalo en Mercado Pago`
            : "Otra paciente cargó un cobro por el mismo monto: confirmalo en Mercado Pago",
      };
    }
    const expired = now.getTime() - c.createdAt.getTime() > WINDOW_MS;
    return expired
      ? { checkId: c.id, status: "not_found", note: "No llegó ninguna transferencia por ese monto en 72 h" }
      : { checkId: c.id, status: "pending", note: null };
  });
}
