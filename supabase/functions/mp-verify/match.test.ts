// Se corre con: npx tsx supabase/functions/mp-verify/match.test.ts
import assert from "node:assert/strict";
import { cuitMatchesDni, matchTransfers, type Check, type Transfer } from "./match.ts";

const now = new Date("2026-11-04T15:00:00-03:00");
const h = (hours: number) => new Date(now.getTime() + hours * 3600_000);
const T = (id: string, pesos: number, cuit: string | null, at = h(0)): Transfer => ({ id, cents: pesos * 100, cuit, at });
const C = (id: string, pesos: number, dni: string | null, createdAt = h(0)): Check => ({ id, cents: pesos * 100, dni, createdAt });
const one = (ts: Transfer[], cs: Check[]) => matchTransfers(ts, cs, now);

assert.equal(cuitMatchesDni("27301234561", "30123456"), true);
assert.equal(cuitMatchesDni("27301234561", "3012345"), false);
assert.equal(cuitMatchesDni("30123456", "30123456"), true);

// DNI y monto: verificada
let r = one([T("a", 150000, "27301234561")], [C("1", 150000, "30123456")]);
assert.equal(r[0].status, "verified");
assert.equal(r[0].status === "verified" && r[0].matchedBy, "dni");

// Seña desde la casa: transferencia 20 h antes de cargarla
r = one([T("a", 30000, "27301234561", h(-20))], [C("1", 30000, "30123456")]);
assert.equal(r[0].status, "verified");

// Sin transferencia: pendiente; pasadas 72 h, no llegó
assert.equal(one([], [C("1", 1000, null)])[0].status, "pending");
assert.equal(one([], [C("1", 1000, null, h(-73))])[0].status, "not_found");

// Monto distinto no cuenta
assert.equal(one([T("a", 149999, "27301234561")], [C("1", 150000, "30123456")])[0].status, "pending");

// Sin DNI de la paciente: por monto si es único
r = one([T("a", 80000, "20111111112")], [C("1", 80000, null)]);
assert.equal(r[0].status === "verified" && r[0].matchedBy, "amount");

// Pagó otra persona (la paciente tiene DNI): verificada por monto con aviso
r = one([T("a", 80000, "20111111112")], [C("1", 80000, "30123456")]);
assert.equal(r[0].status, "verified");
assert.match(r[0].note ?? "", /otra persona/);

// Dos transferencias por el mismo monto y sin DNI: revisar
r = one([T("a", 50000, null), T("b", 50000, null)], [C("1", 50000, null)]);
assert.equal(r[0].status, "review");

// Dos cobros por el mismo monto, una sola transferencia de alguien ajeno: los dos a revisar
r = one([T("a", 50000, "20999999993")], [C("1", 50000, null), C("2", 50000, null)]);
assert.deepEqual(r.map((x) => x.status), ["review", "review"]);

// Dos cobros por el mismo monto, cada transferencia del DNI de su paciente: cada uno la suya
r = one(
  [T("a", 50000, "27301234561"), T("b", 50000, "27222222224")],
  [C("1", 50000, "30123456"), C("2", 50000, "22222222")],
);
assert.deepEqual(
  r.map((x) => (x.status === "verified" ? x.transfer.id : x.status)),
  ["a", "b"],
);

// La transferencia de otra paciente con cobro pendiente no se usa por monto
r = one([T("a", 50000, "27222222224")], [C("1", 50000, null), C("2", 50000, "22222222")]);
assert.deepEqual(r.map((x) => x.status), ["pending", "verified"]);

// Fuera de la ventana (transferencia de hace 4 días)
assert.equal(one([T("a", 1000, null, h(-96))], [C("1", 1000, null)])[0].status, "pending");

console.log("mp-verify match: ok");
