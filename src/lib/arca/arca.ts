import "server-only";
import https from "node:https";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARCA_URLS,
  ArcaError,
  buildTra,
  caeBody,
  consultBody,
  dummyBody,
  lastNumberBody,
  loginEnvelope,
  parseCaeResponse,
  parseConsult,
  parseLastNumber,
  parseLoginResponse,
  round2,
  wsfeAction,
  wsfeEnvelope,
  xmlTag,
  type ArcaEnv,
  type CaeRequest,
  type Ticket,
} from "./core";
import { signTra } from "./crypto";

// Conexión con ARCA desde el servidor. Nunca desde el navegador: la clave privada y el acceso viven en arca_secrets.

export type ArcaConnection = {
  id: string;
  organization_id: string;
  branch_id: string;
  holder_id: string;
  environment: ArcaEnv;
  cuit: string;
  business_name: string;
  address: string;
  iibb: string | null;
  activity_start: string | null;
  point_of_sale: number;
  status: string;
};

// Un corte de red: no sabemos si ARCA recibió el pedido
export class ArcaNetworkError extends ArcaError {}

// Los servidores de ARCA usan claves de cifrado viejas que Node rechaza por defecto
const agent = new https.Agent({ keepAlive: false, ciphers: "DEFAULT@SECLEVEL=1" });

function soapPost(url: string, xml: string, action: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(xml, "utf8");
    const req = https.request(
      url,
      {
        method: "POST",
        agent,
        timeout: 25_000,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"${action}"`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", (e) => reject(new ArcaNetworkError("Se cortó la respuesta de ARCA.", String(e))));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) =>
      reject(new ArcaNetworkError("No se pudo conectar con ARCA. Puede estar caído; probá en unos minutos.", String(e))),
    );
    req.end(body);
  });
}

async function wsfe(env: ArcaEnv, op: string, inner: string): Promise<string> {
  return soapPost(ARCA_URLS[env].wsfe, wsfeEnvelope(inner), wsfeAction(op));
}

// ---------------- Acceso (WSAA), guardado hasta que vence ----------------

export async function getTicket(admin: SupabaseClient, conn: ArcaConnection, force = false): Promise<Ticket> {
  const { data: sec } = await admin
    .from("arca_secrets")
    .select("private_key, certificate, token, sign, token_expires_at")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (!sec?.certificate) throw new ArcaError("Falta subir el certificado de ARCA de este titular.");
  const valid =
    sec.token && sec.sign && sec.token_expires_at && new Date(sec.token_expires_at).getTime() > Date.now() + 5 * 60_000;
  if (valid && !force) return { token: sec.token, sign: sec.sign, expiresAt: sec.token_expires_at };

  const cms = signTra(buildTra("wsfe"), sec.certificate, sec.private_key);
  const xml = await soapPost(ARCA_URLS[conn.environment].wsaa, loginEnvelope(cms), "");
  const ticket = parseLoginResponse(xml);
  await admin
    .from("arca_secrets")
    .update({ token: ticket.token, sign: ticket.sign, token_expires_at: ticket.expiresAt, updated_at: new Date().toISOString() })
    .eq("connection_id", conn.id);
  return ticket;
}

const authOf = (t: Ticket, conn: ArcaConnection) => ({ token: t.token, sign: t.sign, cuit: conn.cuit });

// ---------------- Probar conexión ----------------

// Servidores de ARCA arriba + acceso con el certificado + punto de venta habilitado
export async function testConnection(admin: SupabaseClient, conn: ArcaConnection): Promise<{ lastNumber: number }> {
  const dummy = await wsfe(conn.environment, "FEDummy", dummyBody());
  if (xmlTag(dummy, "AppServer") !== "OK") {
    throw new ArcaError("Los servidores de ARCA no están respondiendo bien ahora. Probá en un rato.", dummy.slice(0, 300));
  }
  const ticket = await getTicket(admin, conn);
  const xml = await wsfe(conn.environment, "FECompUltimoAutorizado", lastNumberBody(authOf(ticket, conn), conn.point_of_sale, 11));
  return { lastNumber: parseLastNumber(xml) };
}

// ---------------- Emitir ----------------

export type NewInvoice = Omit<CaeRequest, "number" | "pointOfSale"> & {
  appointmentId: string | null;
  patientId: string | null;
  receiverName: string | null;
  docNumberRaw: string;
  lines: { description: string; quantity: number; unit_price: number }[];
  cancelsInvoiceId: string | null;
  createdBy: string;
  createdByName: string;
};

export type InvoiceRow = { id: string; number: number; cae: string; cae_due: string; status: string };

// Pide el CAE. Guarda primero la factura como «pending» con su número (así nunca se emiten dos con el mismo
// número desde el CRM) y la completa con la respuesta. Si se corta la red, pregunta a ARCA si quedó emitida.
export async function emitInvoice(admin: SupabaseClient, conn: ArcaConnection, inv: NewInvoice): Promise<InvoiceRow> {
  let ticket = await getTicket(admin, conn);

  // Si quedó alguna «por confirmar» de este titular, primero se aclara (si no, su número bloquea el siguiente)
  const { data: stuck } = await admin
    .from("invoices")
    .select("id")
    .eq("connection_id", conn.id)
    .eq("status", "pending")
    .eq("cbte_tipo", inv.cbteTipo);
  for (const s of stuck ?? []) await recoverInvoice(admin, conn, s.id).catch(() => null);

  const issuer = {
    business_name: conn.business_name,
    cuit: conn.cuit,
    address: conn.address,
    iibb: conn.iibb,
    activity_start: conn.activity_start,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let lastXml = await wsfe(conn.environment, "FECompUltimoAutorizado", lastNumberBody(authOf(ticket, conn), conn.point_of_sale, inv.cbteTipo));
    let last: number;
    try {
      last = parseLastNumber(lastXml);
    } catch (e) {
      // El acceso guardado dejó de valer: se pide uno nuevo una vez
      if (e instanceof ArcaError && e.codes.includes(600) && attempt === 0) {
        ticket = await getTicket(admin, conn, true);
        lastXml = await wsfe(conn.environment, "FECompUltimoAutorizado", lastNumberBody(authOf(ticket, conn), conn.point_of_sale, inv.cbteTipo));
        last = parseLastNumber(lastXml);
      } else throw e;
    }
    const number = last + 1;

    const { data: row, error: insErr } = await admin
      .from("invoices")
      .insert({
        organization_id: conn.organization_id,
        branch_id: conn.branch_id,
        holder_id: conn.holder_id,
        connection_id: conn.id,
        appointment_id: inv.appointmentId,
        patient_id: inv.patientId,
        environment: conn.environment,
        cuit: conn.cuit,
        cbte_tipo: inv.cbteTipo,
        point_of_sale: conn.point_of_sale,
        number,
        status: "pending",
        issue_date: inv.date,
        concept: inv.concept,
        service_from: inv.concept !== 1 ? (inv.serviceFrom ?? inv.date) : null,
        service_to: inv.concept !== 1 ? (inv.serviceTo ?? inv.date) : null,
        doc_type: inv.docType,
        doc_number: inv.docType === 99 ? null : inv.docNumberRaw,
        iva_condition: inv.ivaCondition,
        receiver_name: inv.receiverName,
        total: round2(inv.total),
        lines: inv.lines,
        issuer,
        cancels_invoice_id: inv.cancelsInvoiceId,
        created_by: inv.createdBy,
        created_by_name: inv.createdByName,
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505" && insErr.message.includes("invoices_cancels_key")) {
        throw new ArcaError("Esa factura ya está anulada (o se está anulando). Actualizá la pantalla.");
      }
      // Otro pedido tomó ese número en el mismo momento: se vuelve a intentar con el siguiente
      if (insErr.code === "23505" && attempt < 2) continue;
      if (insErr.code === "23505") throw new ArcaError("Hay otra factura de este titular por confirmar. Revisala en Números → Facturación.");
      throw new ArcaError(`No se pudo guardar la factura: ${insErr.message}`);
    }

    const req: CaeRequest = { ...inv, pointOfSale: conn.point_of_sale, number };
    try {
      const xml = await wsfe(conn.environment, "FECAESolicitar", caeBody(authOf(ticket, conn), req));
      const res = parseCaeResponse(xml);
      await admin.from("invoices").update({ status: "issued", cae: res.cae, cae_due: res.caeDue, error: null }).eq("id", row.id);
      return { id: row.id, number, cae: res.cae, cae_due: res.caeDue, status: "issued" };
    } catch (e) {
      if (e instanceof ArcaNetworkError) {
        // No sabemos si ARCA la emitió: se pregunta por ese número
        const recovered = await recoverInvoice(admin, conn, row.id).catch(() => null);
        if (recovered) return recovered;
        throw new ArcaError(
          "Se cortó la conexión con ARCA y no se pudo confirmar si la factura salió. Quedó «Por confirmar» en Números → Facturación: tocá «Revisar en ARCA» en unos minutos.",
        );
      }
      const err = e as ArcaError;
      await admin.from("invoices").update({ status: "failed", error: err.message }).eq("id", row.id);
      if (err.codes?.includes(10016) && attempt < 2) continue; // número usado (por ejemplo, desde otro sistema)
      throw err;
    }
  }
  throw new ArcaError("No se pudo conseguir un número de factura libre. Probá de nuevo.");
}

// Para una factura «pending»: ¿ARCA la tiene? Si sí, se completa; si no, queda como no emitida.
export async function recoverInvoice(admin: SupabaseClient, conn: ArcaConnection, invoiceId: string): Promise<InvoiceRow | null> {
  const { data: inv } = await admin
    .from("invoices")
    .select("id, number, cbte_tipo, point_of_sale, total, status")
    .eq("id", invoiceId)
    .single();
  if (!inv || inv.status !== "pending") return null;
  const ticket = await getTicket(admin, conn);
  const xml = await wsfe(conn.environment, "FECompConsultar", consultBody(authOf(ticket, conn), inv.point_of_sale, inv.cbte_tipo, inv.number));
  const found = parseConsult(xml);
  if (found && Math.abs(found.total - Number(inv.total)) < 0.01) {
    await admin.from("invoices").update({ status: "issued", cae: found.cae, cae_due: found.caeDue, error: null }).eq("id", inv.id);
    return { id: inv.id, number: inv.number, cae: found.cae, cae_due: found.caeDue, status: "issued" };
  }
  if (!found) {
    await admin.from("invoices").update({ status: "failed", error: "ARCA no la tiene: no se emitió." }).eq("id", inv.id);
    return null;
  }
  // Existe con otro monto: alguien usó ese número desde otro sistema
  await admin
    .from("invoices")
    .update({ status: "failed", error: "Ese número en ARCA es de otra factura (¿se facturó desde otro sistema?)." })
    .eq("id", inv.id);
  return null;
}
