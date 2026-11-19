// Lectura de la planilla: npm test
import { buildImport, mapTreatments, parseDate, parseMoney, OTHER, CONTROL } from "./sheet-import";

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "  ✓" : "  ✕"} ${label}${ok ? "" : ` (dio ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)})`}`);
};

const catalog = [
  "Botox (toxina botulínica)",
  "Ácido hialurónico - labios",
  "Ácido hialurónico - otras zonas",
  "Rinomodelado",
  "Hilos tensores faciales",
  "Consulta médica",
];
const accounts = [
  { name: "Efectivo", currency: "ARS" },
  { name: "MP Marian", currency: "ARS" },
  { name: "Dolar", currency: "USD" },
];

eq("plata con coma de miles", parseMoney("$48,000"), 48000);
eq("plata con punto de miles y coma decimal", parseMoney("$1.234,50"), 1234.5);
eq("plata vacía", parseMoney(" "), 0);
eq("fecha con barra de más", parseDate("04/4//2025"), "2025-04-04");
eq("año dado vuelta", parseDate("25/10/0202"), "2022-10-25");
eq("fecha que no existe", parseDate("31/02/2024"), null);
eq("nombre en la columna de fecha", parseDate("Andrea"), null);

eq("btx + 2 ah → Botox y ácido con cantidad", mapTreatments("Btx + 2 AH", catalog).items, [
  { treatment: "Botox (toxina botulínica)" },
  { treatment: "Ácido hialurónico - otras zonas", quantity: 2 },
]);
eq("AH rinolips → rinomodelado y labios", mapTreatments("AH rinolips", catalog).items.map((i) => i.treatment), [
  "Rinomodelado",
  "Ácido hialurónico - labios",
]);
eq("control btx → Control", mapTreatments("Control BTX", catalog).items, [{ treatment: CONTROL, zone: "Botox" }]);
eq("consulta con lo programado → solo consulta", mapTreatments("Cons ( se programo Botox, Hilos y acido)", catalog).items, [
  { treatment: "Consulta médica" },
]);
eq("desconocido → Otro con el texto", mapTreatments("peptona 1/5", catalog).items, [{ treatment: OTHER, zone: "Peptona 1/5" }]);

const csv = [
  "## Sheet name: Actual",
  ",Nombres,Apellidos,DNI (CUIL/CUIT),Tratamiento/s realizado/s,Medico/a,Comentario ,Codigo/s producto/s,celular,mail,Total,Efectivo,Dolar,MP Marian,Comision medica,Insumo",
  '1/11/2022,MARIA ,VEGA,10047498,HT y Btx,Ulma,no fuma,1001,3512020201,M@X.COM,"$85,000","$35,000",$100,"$50,000"," $9,500"," $36,220"',
  "2/11/2022,MARIA,VEGA,10047498,control btx,Ulma,,,,,,,,,,",
  "Andrea,Lopez,,,btx,,,,,,,,,,,",
  "## Sheet name: viejo",
  "3/11/2022,OTRA,HOJA,1,btx,,,,,,,,,,,",
].join("\n");
const p = buildImport(csv, catalog, accounts, "2026-11-19");
eq("solo la primera hoja, sin la fila corrida", p.rows.length, 2);
eq("una sola paciente (mismo DNI)", p.patients, 1);
eq("fila corrida en la lista de las que no entran", p.skipped.length, 1);
eq("cobro por cuenta (los dólares aparte)", p.rows[0].payments, [
  { account: "Efectivo", amount: 35000 },
  { account: "__usd__", amount: 100 },
  { account: "MP Marian", amount: 50000 },
]);
eq("el total se reparte entre los tratamientos", p.rows[0].items.map((i) => i.price), [42500, 42500]);
eq("comisión e insumo de la planilla", [p.rows[0].commission, p.rows[0].supplies], [9500, 36220]);
eq("nombre prolijo y mail en minúscula", [p.rows[0].first_name, p.rows[0].email], ["Maria", "m@x.com"]);
eq("la misma planilla da las mismas referencias", buildImport(csv, catalog, accounts, "2026-11-19").rows.map((r) => r.ref), p.rows.map((r) => r.ref));

console.log(fails ? `${fails} pruebas de la planilla fallaron` : "planilla: ok");
if (fails) process.exit(1);
