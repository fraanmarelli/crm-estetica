// PDF de la Factura C / Nota de Crédito C con el QR obligatorio de ARCA.
// Sin "server-only" para poder probarlo con tsx; en la app lo usa solo la ruta del servidor.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { CBTE_NOTA_CREDITO_C, ivaLabel, qrUrl } from "./core";

export type PdfInvoice = {
  environment: "test" | "prod";
  cbte_tipo: number;
  point_of_sale: number;
  number: number;
  issue_date: string;
  concept: number;
  service_from?: string | null;
  service_to?: string | null;
  doc_type: number;
  doc_number: string | null;
  iva_condition: number;
  receiver_name: string | null;
  total: number;
  lines: { description: string; quantity: number; unit_price: number }[];
  issuer: { business_name: string; cuit: string; address: string; iibb: string | null; activity_start: string | null };
  cae: string;
  cae_due: string;
  associated?: { label: string; date: string } | null;
};

const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const ars = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
const DOC_LABEL: Record<number, string> = { 80: "CUIT", 86: "CUIL", 96: "DNI", 99: "Sin identificar" };
const CONCEPT_LABEL: Record<number, string> = { 1: "Productos", 2: "Servicios", 3: "Productos y servicios" };

// Helvetica estándar solo tiene Latin-1: lo que no entra se reemplaza
const safe = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function invoicePdf(inv: PdfInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const isNc = inv.cbte_tipo === CBTE_NOTA_CREDITO_C;
  doc.setTitle(`${isNc ? "Nota de credito C" : "Factura C"} ${String(inv.point_of_sale).padStart(5, "0")}-${String(inv.number).padStart(8, "0")}`);
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.75, 0.75, 0.75);
  const W = 595.28;
  const M = 36;

  const text = (s: string, x: number, y: number, size = 9, f: PDFFont = font, color = ink) =>
    page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, y: number, size = 9, f: PDFFont = font) =>
    text(s, xRight - f.widthOfTextAtSize(safe(s), size), y, size, f);
  const box = (p: PDFPage, x: number, y: number, w: number, h: number) =>
    p.drawRectangle({ x, y, width: w, height: h, borderColor: line, borderWidth: 0.8 });

  if (inv.environment === "test") {
    page.drawText("PRUEBA - SIN VALIDEZ FISCAL", {
      x: 70,
      y: 250,
      size: 34,
      font: bold,
      color: rgb(0.85, 0.2, 0.2),
      opacity: 0.18,
      rotate: degrees(35),
    });
  }

  // Encabezado: emisor | C | comprobante
  const top = 805;
  box(page, M, top - 130, W - 2 * M, 130);
  page.drawLine({ start: { x: W / 2, y: top - 130 }, end: { x: W / 2, y: top - 30 }, color: line, thickness: 0.8 });
  page.drawRectangle({ x: W / 2 - 22, y: top - 44, width: 44, height: 44, color: rgb(1, 1, 1), borderColor: line, borderWidth: 0.8 });
  text("C", W / 2 - 9, top - 30, 26, bold);
  text(`COD. ${isNc ? "013" : "011"}`, W / 2 - 17, top - 41, 6.5, bold);

  text(inv.issuer.business_name, M + 10, top - 30, 13, bold);
  text(`Domicilio comercial: ${inv.issuer.address}`, M + 10, top - 60, 8.5);
  text("Condición frente al IVA: Responsable Monotributo", M + 10, top - 75, 8.5);

  const rx = W / 2 + 30;
  text(isNc ? "NOTA DE CRÉDITO" : "FACTURA", rx, top - 30, 14, bold);
  text(
    `Punto de venta: ${String(inv.point_of_sale).padStart(5, "0")}    Comp. Nro: ${String(inv.number).padStart(8, "0")}`,
    rx,
    top - 52,
    9,
    bold,
  );
  text(`Fecha de emisión: ${dmy(inv.issue_date)}`, rx, top - 68, 9);
  text(`CUIT: ${cuitFmt(inv.issuer.cuit)}`, rx, top - 84, 9);
  text(`Ingresos Brutos: ${inv.issuer.iibb || cuitFmt(inv.issuer.cuit)}`, rx, top - 98, 9);
  text(`Inicio de actividades: ${dmy(inv.issuer.activity_start)}`, rx, top - 112, 9);

  // Período (servicios) y cliente
  let y = top - 150;
  if (inv.concept !== 1) {
    box(page, M, y - 8, W - 2 * M, 22);
    text(
      `Período facturado desde: ${dmy(inv.service_from ?? inv.issue_date)}   hasta: ${dmy(inv.service_to ?? inv.issue_date)}   Vto. para el pago: ${dmy(inv.issue_date)}`,
      M + 10,
      y,
      8.5,
    );
    y -= 30;
  }
  box(page, M, y - 42, W - 2 * M, 56);
  const docTxt = inv.doc_type === 99 ? "Sin identificar" : `${DOC_LABEL[inv.doc_type] ?? "Doc."}: ${inv.doc_number ?? ""}`;
  text(docTxt, M + 10, y, 9, bold);
  text(`Nombre / Razón social: ${inv.receiver_name || (inv.iva_condition === 5 ? "Consumidor final" : "—")}`, M + 200, y, 9);
  text(`Condición frente al IVA: ${ivaLabel(inv.iva_condition)}`, M + 10, y - 16, 9);
  text(`Condición de venta: Contado`, M + 200, y - 16, 9);
  text(`Concepto: ${CONCEPT_LABEL[inv.concept] ?? "—"}`, M + 10, y - 32, 9);
  if (inv.associated) text(`Comprobante asociado: ${inv.associated.label} del ${dmy(inv.associated.date)}`, M + 200, y - 32, 9);

  // Detalle
  y -= 70;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.93, 0.93, 0.93) });
  text("Descripción", M + 8, y, 8.5, bold);
  right("Cantidad", 360, y, 8.5, bold);
  right("Precio unit.", 450, y, 8.5, bold);
  right("Subtotal", W - M - 8, y, 8.5, bold);
  y -= 22;
  for (const l of inv.lines) {
    const desc = safe(l.description);
    // Descripción larga: se corta en renglones
    const words = desc.split(/\s+/);
    const rows: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, 9) > 270) {
        rows.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) rows.push(cur);
    text(rows[0] ?? "", M + 8, y, 9);
    right(String(l.quantity).replace(".", ","), 360, y, 9);
    right(ars(l.unit_price), 450, y, 9);
    right(ars(Math.round(l.quantity * l.unit_price * 100) / 100), W - M - 8, y, 9);
    for (const r of rows.slice(1)) {
      y -= 12;
      text(r, M + 8, y, 9);
    }
    y -= 16;
    if (y < 220) break; // una sola hoja: alcanza para las facturas de una clínica
  }

  // Totales
  const ty = 200;
  box(page, M, ty - 10, W - 2 * M, 50);
  right("Subtotal: $", 470, ty + 22, 9, bold);
  right(ars(inv.total), W - M - 8, ty + 22, 9, bold);
  right("Importe otros tributos: $", 470, ty + 8, 9);
  right(ars(0), W - M - 8, ty + 8, 9);
  right("Importe total: $", 470, ty - 6, 11, bold);
  right(ars(inv.total), W - M - 8, ty - 6, 11, bold);

  // QR + CAE
  const url = qrUrl({
    date: inv.issue_date,
    cuit: inv.issuer.cuit,
    pointOfSale: inv.point_of_sale,
    cbteTipo: inv.cbte_tipo,
    number: inv.number,
    total: inv.total,
    docType: inv.doc_type,
    docNumber: inv.doc_number ?? "",
    cae: inv.cae,
  });
  const png = await QRCode.toBuffer(url, { margin: 0, width: 300, errorCorrectionLevel: "M" });
  const qr = await doc.embedPng(png);
  page.drawImage(qr, { x: M, y: 50, width: 110, height: 110 });
  text("Comprobante autorizado por ARCA", M + 125, 140, 10, bold);
  text("Esta factura se puede verificar escaneando el código QR.", M + 125, 125, 8.5, font, muted);
  right(`CAE N°: ${inv.cae}`, W - M - 8, 140, 10, bold);
  right(`Fecha de vto. de CAE: ${dmy(inv.cae_due)}`, W - M - 8, 125, 9);

  return doc.save();
}
