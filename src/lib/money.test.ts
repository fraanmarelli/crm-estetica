// Pruebas de la plata en la app (formulario del turno): npm test
import assert from "node:assert/strict";
import { emptyRow, toItems, toRows, type Row } from "./appointment-rows";
import { moneyForServer, numOrNull, paidInPesos, parseMoney, splitPromoPrice } from "./money";

let ok = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    ok++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✕ ${name}`);
    throw e;
  }
}

// ---------------------------------------------------------------------
// Montos escritos en la app
// ---------------------------------------------------------------------
test("«1.500,50» se lee como 1500,5", () => assert.equal(parseMoney("1.500,50"), 1500.5));
test("«150.000» se lee como ciento cincuenta mil", () => assert.equal(parseMoney("150.000"), 150000));
test("vacío o inválido suma cero", () => {
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney("abc"), 0);
});
test("el servidor lee lo mismo que la pantalla", () => {
  assert.equal(numOrNull("1.500,50"), 1500.5);
  assert.equal(numOrNull(""), null);
  assert.equal(numOrNull("abc"), null);
});
test("ida y vuelta al servidor sin perder centavos", () => {
  for (const n of [0, 1, 1500.5, 150000, 3333.33, 1234567.89]) assert.equal(numOrNull(moneyForServer(n)), n);
});
test("moneyForServer redondea a centavos", () => assert.equal(moneyForServer(3333.33 + 3333.33 + 3333.34), "10000"));

// ---------------------------------------------------------------------
// Promos: el precio se reparte y la suma da exacto
// ---------------------------------------------------------------------
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
test("combo de 3 a $100.000: 33.333 + 33.333 + 33.334", () =>
  assert.deepEqual(splitPromoPrice(100000, 3), [33333, 33333, 33334]));
test("el reparto siempre suma el precio de la promo", () => {
  for (const total of [1, 999, 100000, 150000.5, 87654.32]) {
    for (const parts of [1, 2, 3, 4, 7]) assert.equal(sum(splitPromoPrice(total, parts)), total, `${total} en ${parts}`);
  }
});

const promoRow = (price: string, n: number): Row => ({
  ...emptyRow(),
  promotion_id: "promo-1",
  promotion_name: "Combo",
  price,
  promo_items: Array.from({ length: n }, (_, i) => ({ treatment_id: `t${i}`, zone: "" })),
});
const saved = (items: ReturnType<typeof toItems>) =>
  // Así vuelven de la base: número con punto decimal
  items.map((it) => ({ ...it, price: it.price === "" ? "" : String(numOrNull(it.price)) }));

test("al guardar un combo se guardan sus tratamientos con el precio repartido", () => {
  const items = toItems([promoRow("100.000", 3)], () => false);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => numOrNull(i.price)), [33333, 33333, 33334]);
  assert.ok(items.every((i) => i.promotion_id === "promo-1"));
});
test("al volver a abrir el turno, el combo es un solo renglón con el mismo precio", () => {
  const rows = toRows(saved(toItems([promoRow("100.000", 3)], () => false)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, "100.000");
  assert.equal(rows[0].promo_items.length, 3);
});
test("combo con centavos: se reabre con el mismo precio (no multiplicado por 10)", () => {
  const rows = toRows(saved(toItems([promoRow("150.000,50", 2)], () => false)));
  assert.equal(rows[0].price, "150.000,5");
});
test("combo de 3 con centavos que no dividen exacto: se reabre sin decimales de más", () => {
  const rows = toRows([
    { treatment_id: "a", zone: "", quantity: "", price: "3333.33", promotion_id: "p" },
    { treatment_id: "b", zone: "", quantity: "", price: "3333.33", promotion_id: "p" },
    { treatment_id: "c", zone: "", quantity: "", price: "3333.34", promotion_id: "p" },
  ]);
  assert.equal(rows[0].price, "10.000");
});
test("un tratamiento suelto guarda su precio", () => {
  const items = toItems([{ ...emptyRow(), treatment_id: "t1", quantity: "1", price: "45.500,25" }], () => false);
  assert.equal(numOrNull(items[0].price), 45500.25);
});
test("un renglón sin tratamiento no se guarda", () => assert.deepEqual(toItems([emptyRow()], () => false), []));

// ---------------------------------------------------------------------
// Cobro en pantalla = lo que va a calcular la base
// ---------------------------------------------------------------------
const accounts = [
  { id: "efectivo", currency: "ARS" },
  { id: "dolares", currency: "USD" },
];
test("pesos + dólares cotizados + dólares sin cotización", () => {
  const r = paidInPesos(
    [
      { account_id: "efectivo", amount: "30.000", exchange_rate: "" },
      { account_id: "dolares", amount: "100", exchange_rate: "1.200" },
      { account_id: "dolares", amount: "50", exchange_rate: "" },
    ],
    accounts,
  );
  assert.deepEqual(r, { ars: 150000, usdRated: 100, usdUnrated: 50 });
});
test("cotización con centavos se redondea por parte, como la base", () =>
  assert.equal(paidInPesos([{ account_id: "dolares", amount: "33,33", exchange_rate: "1.234,56" }], accounts).ars, 41147.88));
test("una cuenta que no existe no suma", () =>
  assert.equal(paidInPesos([{ account_id: "otra", amount: "1.000", exchange_rate: "" }], accounts).ars, 0));

console.log(`${ok} pruebas bien`);
