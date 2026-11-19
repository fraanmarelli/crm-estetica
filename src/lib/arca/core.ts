// Factura electrónica de ARCA (ex AFIP): lo que no necesita red ni claves.
// WSAA (login con certificado) + WSFEv1 (Factura C y Nota de Crédito C, que es lo que emite un monotributista).
// Se usa desde el servidor (arca.ts) y desde las pruebas (core.test.ts).

export type ArcaEnv = "test" | "prod";

export const ARCA_URLS: Record<ArcaEnv, { wsaa: string; wsfe: string }> = {
  test: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  prod: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

// Tipos de comprobante (monotributo)
export const CBTE_FACTURA_C = 11;
export const CBTE_NOTA_CREDITO_C = 13;

// Concepto
export const CONCEPTS = { productos: 1, servicios: 2 } as const;
export type ConceptKey = keyof typeof CONCEPTS;

// Documento del cliente
export const DOC_TYPES = { cuit: 80, cuil: 86, dni: 96, ninguno: 99 } as const;
export type DocKey = keyof typeof DOC_TYPES;

// Condición frente al IVA del cliente (obligatoria desde el 1/12/2026, RG 5616)
export const IVA_CONDITIONS: { id: number; label: string }[] = [
  { id: 5, label: "Consumidor final" },
  { id: 6, label: "Responsable monotributo" },
  { id: 1, label: "IVA responsable inscripto" },
  { id: 4, label: "IVA sujeto exento" },
  { id: 13, label: "Monotributista social" },
  { id: 15, label: "IVA no alcanzado" },
];
export const ivaLabel = (id: number) => IVA_CONDITIONS.find((c) => c.id === id)?.label ?? `Código ${id}`;

// Desde este total hay que identificar al consumidor final (DNI o CUIT)
export const IDENTIFY_FROM = 10_000_000;

export type InvoiceLine = { description: string; quantity: number; unit_price: number };

// ---------------- Validaciones ----------------

export const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Dígito verificador del CUIT/CUIL
export function isValidCuit(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, x, i) => s + x * Number(c[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(c[10]);
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function linesTotal(lines: InvoiceLine[]): number {
  return round2(lines.reduce((s, l) => s + round2(l.quantity * l.unit_price), 0));
}

// Lo que se valida antes de pedir el CAE (mensajes para la pantalla)
export function validateInvoice(input: {
  lines: InvoiceLine[];
  docType: DocKey;
  docNumber: string;
  ivaCondition: number;
}): string | null {
  if (!input.lines.length) return "Agregá al menos una línea.";
  for (const l of input.lines) {
    if (!l.description.trim()) return "Cada línea necesita una descripción.";
    if (!(l.quantity > 0)) return `La cantidad de «${l.description}» tiene que ser mayor a 0.`;
    if (!(l.unit_price > 0)) return `El precio de «${l.description}» tiene que ser mayor a 0.`;
  }
  const total = linesTotal(input.lines);
  if (total <= 0) return "El total tiene que ser mayor a 0.";
  if (!IVA_CONDITIONS.some((c) => c.id === input.ivaCondition)) return "Elegí la condición frente al IVA.";
  const doc = onlyDigits(input.docNumber);
  if (input.docType === "ninguno") {
    if (total >= IDENTIFY_FROM) return "Desde $10.000.000 hay que poner el DNI o el CUIT del cliente.";
    if (input.ivaCondition !== 5) return "Sin DNI ni CUIT solo se puede facturar a consumidor final.";
    return null;
  }
  if (input.docType === "dni") {
    if (doc.length < 7 || doc.length > 8) return "El DNI tiene que tener 7 u 8 números.";
    return null;
  }
  if (!isValidCuit(doc)) return "El CUIT/CUIL no es válido (revisá los 11 números).";
  return null;
}

// ---------------- Fechas (hora de Argentina, sin horario de verano) ----------------

const AR_OFFSET_MS = -3 * 60 * 60 * 1000;

// «2026-11-20» de hoy en Argentina
export function arDate(d = new Date()): string {
  return new Date(d.getTime() + AR_OFFSET_MS).toISOString().slice(0, 10);
}
export const yyyymmdd = (iso: string) => iso.replaceAll("-", "").slice(0, 8);
export const fromYyyymmdd = (s: string) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");

// «2026-11-20T10:00:00-03:00»
function arIsoTime(d: Date): string {
  return new Date(d.getTime() + AR_OFFSET_MS).toISOString().slice(0, 19) + "-03:00";
}

// ---------------- XML ----------------

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xD;|&#13;/g, "")
    .replace(/&amp;/g, "&");
}

// Primer <Tag>…</Tag> (con o sin prefijo de namespace)
export function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`));
  return m ? m[1] : null;
}
export function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

// Errores y observaciones de ARCA: [{code, msg}]
export function arcaMessages(xml: string, container: "Errors" | "Observaciones" | "Events"): { code: number; msg: string }[] {
  const block = xmlTag(xml, container);
  if (!block) return [];
  const item = container === "Errors" ? "Err" : container === "Observaciones" ? "Obs" : "Evt";
  return xmlTags(block, item).map((b) => ({
    code: Number(xmlTag(b, "Code") ?? 0),
    msg: xmlUnescape(xmlTag(b, "Msg") ?? "").trim(),
  }));
}

// ---------------- WSAA ----------------

// Pedido de acceso (TRA) para un servicio: vale 10 minutos para firmarlo y mandarlo
export function buildTra(service: string, now = new Date()): string {
  const from = new Date(now.getTime() - 10 * 60 * 1000);
  const to = new Date(now.getTime() + 10 * 60 * 1000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${arIsoTime(from)}</generationTime>` +
    `<expirationTime>${arIsoTime(to)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  );
}

export function loginEnvelope(cmsBase64: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  );
}

export type Ticket = { token: string; sign: string; expiresAt: string };

export function parseLoginResponse(xml: string): Ticket {
  const fault = xmlTag(xml, "faultstring");
  if (fault) throw new ArcaError(wsaaFaultMessage(xmlUnescape(fault)), xmlUnescape(fault));
  const ret = xmlTag(xml, "loginCmsReturn");
  if (!ret) throw new ArcaError("ARCA no devolvió el acceso. Probá de nuevo en unos minutos.", xml.slice(0, 300));
  const inner = xmlUnescape(ret);
  const token = xmlTag(inner, "token");
  const sign = xmlTag(inner, "sign");
  const exp = xmlTag(inner, "expirationTime");
  if (!token || !sign || !exp) throw new ArcaError("ARCA devolvió un acceso incompleto.", inner.slice(0, 300));
  return { token: token.trim(), sign: sign.trim(), expiresAt: new Date(exp.trim()).toISOString() };
}

// Los errores de WSAA, en castellano para quien configura
export function wsaaFaultMessage(fault: string): string {
  const f = fault.toLowerCase();
  if (f.includes("no se encontro") || f.includes("not authorized") || f.includes("no autorizado") || f.includes("notauthorized"))
    return "ARCA dice que este certificado no está habilitado para «Facturación electrónica». Falta el paso de «Administrador de Relaciones» (o en prueba, «Crear autorización a servicio» en WSASS).";
  if (f.includes("ya posee un ta valido"))
    return "ARCA ya entregó un acceso hace poco y todavía no venció. Esperá unos minutos y probá de nuevo.";
  if (f.includes("expir") || f.includes("vencid")) return "El certificado está vencido. Hay que renovarlo en ARCA.";
  if (f.includes("cms") || f.includes("firma") || f.includes("certificado"))
    return "ARCA no aceptó el certificado. Revisá que sea el que descargaste de ARCA para este pedido y para este ambiente (prueba o real).";
  if (f.includes("time") || f.includes("hora")) return "ARCA rechazó la hora del pedido. Probá de nuevo en un minuto.";
  return `ARCA rechazó el acceso: ${fault}`;
}

// ---------------- WSFEv1 ----------------

export type Auth = { token: string; sign: string; cuit: string };

function authXml(a: Auth): string {
  return `<ar:Auth><ar:Token>${a.token}</ar:Token><ar:Sign>${a.sign}</ar:Sign><ar:Cuit>${onlyDigits(a.cuit)}</ar:Cuit></ar:Auth>`;
}

export function wsfeEnvelope(body: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soap:Body>${body}</soap:Body></soap:Envelope>`
  );
}

export const wsfeAction = (op: string) => `http://ar.gov.afip.dif.FEV1/${op}`;

export function dummyBody(): string {
  return `<ar:FEDummy/>`;
}

export function lastNumberBody(a: Auth, pointOfSale: number, cbteTipo: number): string {
  return `<ar:FECompUltimoAutorizado>${authXml(a)}<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`;
}

export function consultBody(a: Auth, pointOfSale: number, cbteTipo: number, number: number): string {
  return (
    `<ar:FECompConsultar>${authXml(a)}<ar:FeCompConsReq>` +
    `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo><ar:CbteNro>${number}</ar:CbteNro><ar:PtoVta>${pointOfSale}</ar:PtoVta>` +
    `</ar:FeCompConsReq></ar:FECompConsultar>`
  );
}

export type CaeRequest = {
  pointOfSale: number;
  cbteTipo: number;
  number: number;
  date: string; // AAAA-MM-DD
  concept: number; // 1 productos, 2 servicios
  docType: number;
  docNumber: string;
  total: number;
  ivaCondition: number;
  serviceFrom?: string; // AAAA-MM-DD (servicios)
  serviceTo?: string;
  paymentDue?: string;
  associated?: { cbteTipo: number; pointOfSale: number; number: number; cuit: string; date: string };
};

const money = (n: number) => round2(n).toFixed(2);

export function caeBody(a: Auth, r: CaeRequest): string {
  const isService = r.concept !== 1;
  const docNumber = r.docType === 99 ? "0" : onlyDigits(r.docNumber);
  // El orden de los campos es el del WSDL (ARCA lo valida)
  return (
    `<ar:FECAESolicitar>${authXml(a)}<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${r.pointOfSale}</ar:PtoVta><ar:CbteTipo>${r.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${r.concept}</ar:Concepto>` +
    `<ar:DocTipo>${r.docType}</ar:DocTipo>` +
    `<ar:DocNro>${docNumber}</ar:DocNro>` +
    `<ar:CbteDesde>${r.number}</ar:CbteDesde>` +
    `<ar:CbteHasta>${r.number}</ar:CbteHasta>` +
    `<ar:CbteFch>${yyyymmdd(r.date)}</ar:CbteFch>` +
    `<ar:ImpTotal>${money(r.total)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>0</ar:ImpTotConc>` +
    `<ar:ImpNeto>${money(r.total)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0</ar:ImpOpEx>` +
    `<ar:ImpTrib>0</ar:ImpTrib>` +
    `<ar:ImpIVA>0</ar:ImpIVA>` +
    (isService
      ? `<ar:FchServDesde>${yyyymmdd(r.serviceFrom ?? r.date)}</ar:FchServDesde>` +
        `<ar:FchServHasta>${yyyymmdd(r.serviceTo ?? r.date)}</ar:FchServHasta>` +
        `<ar:FchVtoPago>${yyyymmdd(r.paymentDue ?? r.date)}</ar:FchVtoPago>`
      : "") +
    `<ar:MonId>PES</ar:MonId>` +
    `<ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${r.ivaCondition}</ar:CondicionIVAReceptorId>` +
    (r.associated
      ? `<ar:CbtesAsoc><ar:CbteAsoc>` +
        `<ar:Tipo>${r.associated.cbteTipo}</ar:Tipo>` +
        `<ar:PtoVta>${r.associated.pointOfSale}</ar:PtoVta>` +
        `<ar:Nro>${r.associated.number}</ar:Nro>` +
        `<ar:Cuit>${onlyDigits(r.associated.cuit)}</ar:Cuit>` +
        `<ar:CbteFch>${yyyymmdd(r.associated.date)}</ar:CbteFch>` +
        `</ar:CbteAsoc></ar:CbtesAsoc>`
      : "") +
    `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`
  );
}

export class ArcaError extends Error {
  detail: string;
  codes: number[];
  constructor(message: string, detail = "", codes: number[] = []) {
    super(message);
    this.detail = detail;
    this.codes = codes;
  }
}

export function parseLastNumber(xml: string): number {
  const errs = arcaMessages(xml, "Errors");
  if (errs.length) throw new ArcaError(wsfeErrorMessage(errs), JSON.stringify(errs), errs.map((e) => e.code));
  const n = xmlTag(xml, "CbteNro");
  if (n == null) throw new ArcaError("ARCA no devolvió el último número de factura.", xml.slice(0, 300));
  return Number(n);
}

export type CaeResult = { cae: string; caeDue: string; observations: string[] };

export function parseCaeResponse(xml: string): CaeResult {
  const fault = xmlTag(xml, "faultstring");
  if (fault) throw new ArcaError(`ARCA respondió con un error: ${xmlUnescape(fault)}`, fault);
  const errs = arcaMessages(xml, "Errors");
  const det = xmlTag(xml, "FECAEDetResponse") ?? "";
  const obs = arcaMessages(det, "Observaciones");
  const result = xmlTag(det, "Resultado") ?? xmlTag(xml, "Resultado");
  const cae = (xmlTag(det, "CAE") ?? "").trim();
  if (result === "A" && cae) {
    return { cae, caeDue: fromYyyymmdd((xmlTag(det, "CAEFchVto") ?? "").trim()), observations: obs.map((o) => o.msg) };
  }
  const all = [...errs, ...obs];
  throw new ArcaError(
    all.length ? wsfeErrorMessage(all) : "ARCA rechazó la factura sin decir por qué.",
    JSON.stringify(all),
    all.map((e) => e.code),
  );
}

// Lo que devuelve FECompConsultar (para recuperar una factura si se cortó la respuesta)
export function parseConsult(xml: string): { cae: string; caeDue: string; total: number; date: string } | null {
  const errs = arcaMessages(xml, "Errors");
  if (errs.some((e) => e.code === 602)) return null; // no existe
  if (errs.length) throw new ArcaError(wsfeErrorMessage(errs), JSON.stringify(errs), errs.map((e) => e.code));
  const r = xmlTag(xml, "ResultGet");
  if (!r) return null;
  const cae = (xmlTag(r, "CodAutorizacion") ?? "").trim();
  if (!cae) return null;
  return {
    cae,
    caeDue: fromYyyymmdd((xmlTag(r, "FchVto") ?? "").trim()),
    total: Number(xmlTag(r, "ImpTotal") ?? 0),
    date: fromYyyymmdd((xmlTag(r, "CbteFch") ?? "").trim()),
  };
}

// Los errores más comunes de WSFE, explicados
export function wsfeErrorMessage(errs: { code: number; msg: string }[]): string {
  const first = errs[0];
  const known: Record<number, string> = {
    600: "ARCA no aceptó el acceso. Volvé a «Probar conexión» en Ajustes → Factura electrónica.",
    601: "El CUIT del titular no coincide con el del certificado.",
    10016: "El número de factura ya se usó. Probá emitir de nuevo.",
    10015: "El DNI o CUIT del cliente no es válido para ARCA.",
    10013: "Con ese DNI/CUIT, el tipo de documento no corresponde.",
    10242: "Falta la condición frente al IVA del cliente o no corresponde para una Factura C.",
    11002: "El punto de venta no está habilitado para Web Services en ARCA. Creá uno del tipo «Web Services» y cargá ese número.",
    10004: "El punto de venta no existe o no es de Web Services en ARCA.",
  };
  const parts = errs.map((e) => known[e.code] ?? `${e.msg} (código ${e.code})`);
  return [...new Set(parts)].join(" · ") || `ARCA: ${first?.msg ?? "error"}`;
}

// ---------------- QR obligatorio ----------------

export function qrUrl(i: {
  date: string;
  cuit: string;
  pointOfSale: number;
  cbteTipo: number;
  number: number;
  total: number;
  docType: number;
  docNumber: string;
  cae: string;
}): string {
  const data: Record<string, string | number> = {
    ver: 1,
    fecha: i.date,
    cuit: Number(onlyDigits(i.cuit)),
    ptoVta: i.pointOfSale,
    tipoCmp: i.cbteTipo,
    nroCmp: i.number,
    importe: round2(i.total),
    moneda: "PES",
    ctz: 1,
    tipoCodAut: "E",
    codAut: Number(i.cae),
  };
  if (i.docType !== 99) {
    data.tipoDocRec = i.docType;
    data.nroDocRec = Number(onlyDigits(i.docNumber));
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString("base64")}`;
}

// «Factura C 0003-00000123»
export function invoiceLabel(cbteTipo: number, pointOfSale: number, number: number): string {
  const kind = cbteTipo === CBTE_NOTA_CREDITO_C ? "Nota de crédito C" : "Factura C";
  return `${kind} ${String(pointOfSale).padStart(5, "0")}-${String(number).padStart(8, "0")}`;
}
