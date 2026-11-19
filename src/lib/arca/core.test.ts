// Factura electrónica (sin conectarse a ARCA): npm test
import forge from "node-forge";
import {
  buildTra,
  caeBody,
  invoiceLabel,
  isValidCuit,
  linesTotal,
  parseCaeResponse,
  parseConsult,
  parseLastNumber,
  parseLoginResponse,
  qrUrl,
  validateInvoice,
  ArcaError,
} from "./core";
import { createKeyAndCsr, normalizePem, readCertificate, signTra } from "./crypto";
import { invoicePdf } from "./pdf";

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "  ✓" : "  ✕"} ${label}${ok ? "" : ` (dio ${JSON.stringify(got)}, se esperaba ${JSON.stringify(want)})`}`);
};
const throwsMsg = (fn: () => unknown) => {
  try {
    fn();
    return "no falló";
  } catch (e) {
    return e instanceof ArcaError ? e.message : String(e);
  }
};

// ---- Validaciones ----
eq("CUIT válido", isValidCuit("20-27394058-9"), true);
eq("CUIT con dígito mal", isValidCuit("20273940581"), false);
eq("10 botox de $70.000", linesTotal([{ description: "Botox", quantity: 10, unit_price: 70000 }]), 700000);
eq(
  "sin DNI a consumidor final por $700.000: se puede",
  validateInvoice({ lines: [{ description: "Botox", quantity: 10, unit_price: 70000 }], docType: "ninguno", docNumber: "", ivaCondition: 5 }),
  null,
);
eq(
  "sin DNI desde $10.000.000: no",
  validateInvoice({ lines: [{ description: "Botox", quantity: 200, unit_price: 70000 }], docType: "ninguno", docNumber: "", ivaCondition: 5 }),
  "Desde $10.000.000 hay que poner el DNI o el CUIT del cliente.",
);
eq(
  "DNI corto",
  validateInvoice({ lines: [{ description: "Botox", quantity: 1, unit_price: 1 }], docType: "dni", docNumber: "123", ivaCondition: 5 }),
  "El DNI tiene que tener 7 u 8 números.",
);
eq(
  "precio en 0",
  validateInvoice({ lines: [{ description: "Botox", quantity: 1, unit_price: 0 }], docType: "ninguno", docNumber: "", ivaCondition: 5 }),
  "El precio de «Botox» tiene que ser mayor a 0.",
);

// ---- Pedido de CAE ----
const auth = { token: "T", sign: "S", cuit: "20273940589" };
const prod = caeBody(auth, {
  pointOfSale: 3,
  cbteTipo: 11,
  number: 124,
  date: "2026-11-20",
  concept: 1,
  docType: 99,
  docNumber: "",
  total: 700000,
  ivaCondition: 5,
});
eq("factura de productos: sin fechas de servicio", prod.includes("FchServDesde"), false);
eq("consumidor final sin identificar: DocNro 0", prod.includes("<ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro>"), true);
eq("total, neto e IVA 0 como pide la Factura C", /ImpTotal>700000\.00<.*ImpNeto>700000\.00<.*ImpIVA>0</.test(prod), true);
eq("condición frente al IVA después de la moneda", /MonCotiz>1<\/ar:MonCotiz><ar:CondicionIVAReceptorId>5</.test(prod), true);
const serv = caeBody(auth, {
  pointOfSale: 3,
  cbteTipo: 13,
  number: 7,
  date: "2026-11-20",
  concept: 2,
  docType: 96,
  docNumber: "30.111.222",
  total: 85000.5,
  ivaCondition: 5,
  associated: { cbteTipo: 11, pointOfSale: 3, number: 124, cuit: "20273940589", date: "2026-11-19" },
});
eq(
  "servicios: fechas antes de la moneda",
  /<ar:FchServDesde>20261120<\/ar:FchServDesde><ar:FchServHasta>20261120<\/ar:FchServHasta><ar:FchVtoPago>20261120<\/ar:FchVtoPago><ar:MonId>/.test(serv),
  true,
);
eq("DNI sin puntos", serv.includes("<ar:DocNro>30111222</ar:DocNro>"), true);
eq("nota de crédito con su factura asociada al final", /CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId><ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>11<\/ar:Tipo><ar:PtoVta>3<\/ar:PtoVta><ar:Nro>124</.test(serv), true);

// ---- Respuestas de ARCA ----
const ok = `<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><Resultado>A</Resultado><CAE>76123456789012</CAE><CAEFchVto>20261130</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;
eq("CAE aprobado", parseCaeResponse(ok), { cae: "76123456789012", caeDue: "2026-11-30", observations: [] });
const rejected = `<FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10242</Code><Msg>Condicion IVA receptor no valida</Msg></Obs></Observaciones><CAE></CAE></FECAEDetResponse></FeDetResp></FECAESolicitarResult>`;
eq(
  "rechazo explicado",
  throwsMsg(() => parseCaeResponse(rejected)),
  "Falta la condición frente al IVA del cliente o no corresponde para una Factura C.",
);
eq("último número", parseLastNumber(`<FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>123</CbteNro></FECompUltimoAutorizadoResult>`), 123);
eq(
  "punto de venta que no es de web services",
  throwsMsg(() => parseLastNumber(`<Errors><Err><Code>11002</Code><Msg>El punto de venta no esta habilitado</Msg></Err></Errors>`)),
  "El punto de venta no está habilitado para Web Services en ARCA. Creá uno del tipo «Web Services» y cargá ese número.",
);
eq(
  "consulta de una factura que existe",
  parseConsult(`<ResultGet><CbteFch>20261120</CbteFch><ImpTotal>700000</ImpTotal><CodAutorizacion>761</CodAutorizacion><FchVto>20261130</FchVto></ResultGet>`),
  { cae: "761", caeDue: "2026-11-30", total: 700000, date: "2026-11-20" },
);
eq("consulta de una que no existe", parseConsult(`<Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors>`), null);
eq(
  "acceso de WSAA",
  parseLoginResponse(
    `<loginCmsReturn>&lt;?xml version="1.0"?&gt;&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2026-11-20T22:00:00.000-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;TOK&lt;/token&gt;&lt;sign&gt;SIG&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn>`,
  ),
  { token: "TOK", sign: "SIG", expiresAt: "2026-11-21T01:00:00.000Z" },
);
eq(
  "certificado sin permiso para facturar",
  throwsMsg(() => parseLoginResponse(`<soapenv:Fault><faultcode>ns1:coe.notAuthorized</faultcode><faultstring>Computador no autorizado a acceder al servicio</faultstring></soapenv:Fault>`)),
  "ARCA dice que este certificado no está habilitado para «Facturación electrónica». Falta el paso de «Administrador de Relaciones» (o en prueba, «Crear autorización a servicio» en WSASS).",
);

// ---- QR ----
const url = qrUrl({ date: "2026-11-20", cuit: "20273940589", pointOfSale: 3, cbteTipo: 11, number: 124, total: 700000, docType: 99, docNumber: "", cae: "76123456789012" });
const payload = JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString());
eq("QR de ARCA", [url.startsWith("https://www.afip.gob.ar/fe/qr/?p="), payload.ver, payload.nroCmp, payload.codAut, "tipoDocRec" in payload], [true, 1, 124, 76123456789012, false]);
eq("número para la pantalla", invoiceLabel(11, 3, 124), "Factura C 00003-00000124");

// ---- Certificado y firma ----
const { privateKeyPem, csrPem } = createKeyAndCsr({ cuit: "20273940589", businessName: "Marian Pérez", alias: "drbeauty-cordoba-1" });
const csr = forge.pki.certificationRequestFromPem(csrPem);
eq("pedido de certificado firmado y con el CUIT", [csr.verify(), csr.subject.getField({ type: "2.5.4.5" })?.value], [true, "CUIT 20273940589"]);
eq("sin tildes en el nombre del pedido", csr.subject.getField("O")?.value, "Marian Perez");

// Certificado «de ARCA» simulado: lo firma otra clave, como hace ARCA
const ca = forge.pki.rsa.generateKeyPair(1024);
const key = forge.pki.privateKeyFromPem(privateKeyPem);
const cert = forge.pki.createCertificate();
cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
cert.serialNumber = "01";
cert.validity.notBefore = new Date("2026-11-20");
cert.validity.notAfter = new Date("2028-11-19");
cert.setSubject(csr.subject.attributes);
cert.setIssuer([{ name: "commonName", value: "Computadores Test" }]);
cert.sign(ca.privateKey, forge.md.sha256.create());
const certPem = forge.pki.certificateToPem(cert);
const info = readCertificate(certPem, privateKeyPem);
eq("el certificado es de esta clave, del CUIT y vence en 2 años", [info.matchesKey, info.cuit, info.notAfter.toISOString().slice(0, 10)], [true, "20273940589", "2028-11-19"]);
const other = createKeyAndCsr({ cuit: "20273940589", businessName: "X", alias: "x" });
eq("certificado de otro pedido: no corresponde", readCertificate(certPem, other.privateKeyPem).matchesKey, false);
const pasted = certPem.replace(/\n/g, " ");
eq("acepta el certificado pegado en una sola línea", readCertificate(normalizePem(pasted), privateKeyPem).matchesKey, true);

const tra = buildTra("wsfe", new Date("2026-11-20T13:00:00Z"));
eq("pedido de acceso en hora argentina", tra.includes("<generationTime>2026-11-20T09:50:00-03:00</generationTime>"), true);
const cms = signTra(tra, certPem, privateKeyPem);
const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as forge.pkcs7.PkcsSignedData & {
  rawCapture: { content: forge.asn1.Asn1 };
};
eq("la firma lleva el pedido adentro y el certificado", [Boolean(p7.rawCapture?.content), p7.certificates.length], [true, 1]);

// ---- PDF ----
(async () => {
  const pdf = await invoicePdf({
    environment: "test",
    cbte_tipo: 11,
    point_of_sale: 3,
    number: 124,
    issue_date: "2026-11-20",
    concept: 1,
    doc_type: 99,
    doc_number: null,
    iva_condition: 5,
    receiver_name: null,
    total: 700000,
    lines: [{ description: "Botox (toxina botulínica) — frasco", quantity: 10, unit_price: 70000 }],
    issuer: { business_name: "Marian Pérez", cuit: "20273940589", address: "Av. Colón 1234, Córdoba", iibb: null, activity_start: "2022-10-01" },
    cae: "76123456789012",
    cae_due: "2026-11-30",
  });
  eq("PDF de la factura", Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
  if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, pdf);

  console.log(fails ? `${fails} pruebas de factura electrónica fallaron` : "factura electrónica: ok");
  if (fails) process.exit(1);
})();
