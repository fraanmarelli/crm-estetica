// Renglones de «Tratamientos» del turno ↔ ítems que se guardan. Sin React: lo usa el formulario
// del turno y lo prueban src/lib/money.test.ts.
import { moneyInputValue } from "@/lib/format";
import { moneyForServer, parseMoney, roundCents, splitPromoPrice } from "@/lib/money";
import type { AppointmentItemInput } from "@/lib/types";

// Un renglón: un tratamiento suelto o una promo entera (un solo precio).
// Al guardar, la promo se convierte en sus tratamientos (para recall, insumos y Klaviyo)
// con el precio repartido entre ellos.
export type Row = {
  treatment_id: string;
  zone: string;
  quantity: string;
  price: string;
  promotion_id: string;
  promotion_name: string;
  promo_items: { treatment_id: string; zone: string }[];
  // Lote del insumo (jeringa, vial): en una promo, vale para sus tratamientos con insumo
  lot_code: string;
};

export const emptyRow = (): Row => ({
  treatment_id: "",
  zone: "",
  quantity: "",
  price: "",
  promotion_id: "",
  promotion_name: "",
  promo_items: [],
  lot_code: "",
});

// Precio guardado (viene de la base como «3333.5», con punto decimal) → número
const storedPrice = (v: string) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? 0 : n;
};

/** Ítems guardados → renglones (los de una misma promo vuelven a ser uno, con el precio sumado). */
export function toRows(items: AppointmentItemInput[]): Row[] {
  const rows: Row[] = [];
  const byPromo = new Map<string, { row: Row; total: number }>();
  for (const it of items) {
    if (it.promotion_id) {
      const existing = byPromo.get(it.promotion_id);
      if (existing) {
        existing.total = roundCents(existing.total + storedPrice(it.price));
        existing.row.price = moneyInputValue(existing.total);
        existing.row.promo_items.push({ treatment_id: it.treatment_id, zone: it.zone });
        existing.row.quantity = "";
        existing.row.lot_code = existing.row.lot_code || (it.lot_code ?? "");
        continue;
      }
      const row: Row = {
        ...emptyRow(),
        promotion_id: it.promotion_id,
        promotion_name: it.promotion_name ?? "Promo",
        price: moneyInputValue(it.price),
        quantity: it.quantity,
        promo_items: [{ treatment_id: it.treatment_id, zone: it.zone }],
        lot_code: it.lot_code ?? "",
      };
      byPromo.set(it.promotion_id, { row, total: storedPrice(it.price) });
      rows.push(row);
    } else {
      rows.push({
        ...emptyRow(),
        ...it,
        price: moneyInputValue(it.price),
        promotion_id: "",
        promotion_name: "",
        lot_code: it.lot_code ?? "",
      });
    }
  }
  return rows;
}

/** Renglones → ítems que se guardan. */
export function toItems(rows: Row[], hasSupply: (treatmentId: string) => boolean): AppointmentItemInput[] {
  const out: AppointmentItemInput[] = [];
  for (const r of rows) {
    if (r.promotion_id) {
      const list = r.promo_items;
      if (!list.length) continue;
      const hasPrice = r.price.trim() !== "";
      const prices = splitPromoPrice(parseMoney(r.price), list.length);
      list.forEach((it, i) => {
        out.push({
          treatment_id: it.treatment_id,
          zone: it.zone,
          quantity: list.length === 1 ? r.quantity : "",
          price: hasPrice ? moneyForServer(prices[i]) : "",
          promotion_id: r.promotion_id,
          lot_code: list.length === 1 || hasSupply(it.treatment_id) ? r.lot_code : "",
        });
      });
    } else if (r.treatment_id) {
      out.push({
        treatment_id: r.treatment_id,
        zone: r.zone,
        quantity: r.quantity,
        price: r.price.trim() === "" ? "" : moneyForServer(parseMoney(r.price)),
        lot_code: r.lot_code,
      });
    }
  }
  return out;
}
