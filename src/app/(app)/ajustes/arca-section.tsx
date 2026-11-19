"use client";

import { useActionState, useEffect, useState } from "react";
import { disconnectArca, startArcaConnection, testArcaConnection, uploadArcaCertificate } from "../facturas/actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export type ArcaHolder = {
  holder_id: string;
  name: string;
  cuit: string | null;
  connection: {
    id: string;
    environment: "test" | "prod";
    cuit: string;
    business_name: string;
    address: string;
    iibb: string | null;
    activity_start: string | null;
    point_of_sale: number;
    status: "needs_cert" | "ready" | "error";
    cert_expires_at: string | null;
    last_error: string | null;
    csr: string | null;
  } | null;
};

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }) : "";

export function ArcaSection({ holders }: { holders: ArcaHolder[] }) {
  return (
    <ul className="divide-y divide-line">
      {holders.map((h) => (
        <li key={h.holder_id} className="py-4 first:pt-0 last:pb-0">
          <HolderRow h={h} />
        </li>
      ))}
    </ul>
  );
}

function HolderRow({ h }: { h: ArcaHolder }) {
  const c = h.connection;
  const [editing, setEditing] = useState(!c);
  const [open, setOpen] = useState(false);
  const badge = !c
    ? <span className="badge badge-gray">Sin conectar</span>
    : c.status === "ready"
      ? <span className="badge badge-green">Conectado{c.environment === "test" ? " · prueba" : ""}</span>
      : c.status === "error"
        ? <span className="badge badge-red">Con error</span>
        : <span className="badge badge-amber">Falta el certificado</span>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{h.name}</p>
          <p className="text-sm text-muted">
            {c
              ? `CUIT ${c.cuit} · punto de venta ${c.point_of_sale}${c.cert_expires_at ? ` · certificado hasta el ${fmtDay(c.cert_expires_at)}` : ""}`
              : "Todavía no factura desde el CRM."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {badge}
          {!open && (
            <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
              {c ? "Ver" : "Conectar ARCA"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-4 rounded-xl border border-line p-4">
          {c?.status === "error" && c.last_error && <p className="alert-error">{c.last_error}</p>}
          {editing || !c ? (
            <DataForm h={h} onCancel={c ? () => setEditing(false) : () => setOpen(false)} onSaved={() => setEditing(false)} />
          ) : (
            <>
              {c.status !== "ready" && <CertificateSteps c={c} />}
              {c.status === "ready" && <TestForm connectionId={c.id} />}
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                  Cambiar datos
                </button>
                {c.status === "ready" && <ReplaceCert c={c} />}
                <form action={disconnectArca}>
                  <input type="hidden" name="connection_id" value={c.id} />
                  <SubmitButton pendingText="Desconectando..." className="btn btn-sm text-bad">
                    Desconectar
                  </SubmitButton>
                </form>
                <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DataForm({ h, onCancel, onSaved }: { h: ArcaHolder; onCancel: () => void; onSaved: () => void }) {
  const [state, action] = useActionState<ActionState, FormData>(startArcaConnection, null);
  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);
  const c = h.connection;
  const v = state?.values;
  const val = (k: string, d: string | number | null | undefined) => v?.[k] ?? (d == null ? "" : String(d));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="holder_id" value={h.holder_id} />
      <p className="text-sm text-muted">Los datos tal como figuran en ARCA. Van impresos en cada factura.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre o razón social" name="business_name" defaultValue={val("business_name", c?.business_name ?? h.name)} />
        <Field label="CUIT" name="cuit" defaultValue={val("cuit", c?.cuit ?? h.cuit)} inputMode="numeric" />
        <Field label="Domicilio comercial" name="address" defaultValue={val("address", c?.address)} className="sm:col-span-2" />
        <Field label="Ingresos Brutos (si es distinto del CUIT)" name="iibb" defaultValue={val("iibb", c?.iibb)} />
        <Field label="Inicio de actividades" name="activity_start" type="date" defaultValue={val("activity_start", c?.activity_start)} />
        <Field
          label="Punto de venta (Web Services)"
          name="point_of_sale"
          defaultValue={val("point_of_sale", c?.point_of_sale)}
          inputMode="numeric"
          hint="El que creaste en ARCA del tipo «Web Services». En prueba podés poner 1."
        />
        <div className="space-y-1.5">
          <label htmlFor={`env-${h.holder_id}`} className="label">Ambiente</label>
          <select id={`env-${h.holder_id}`} name="environment" defaultValue={val("environment", c?.environment ?? "test")} className="input">
            <option value="test">Prueba (homologación, sin validez fiscal)</option>
            <option value="prod">Real</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-muted">
        Si cambiás el CUIT o el ambiente, hay que pedir un certificado nuevo. El resto de los datos se cambia sin tocar el certificado.
      </p>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex gap-2">
        <SubmitButton pendingText="Guardando...">Guardar y seguir</SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  className = "",
  ...props
}: { label: string; name: string; hint?: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `${name}-${props.defaultValue ?? ""}`.replace(/\W/g, "");
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} name={name} className="input" {...props} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

// Los pasos en ARCA: cambian según el ambiente
function CertificateSteps({ c }: { c: NonNullable<ArcaHolder["connection"]> }) {
  const [copied, setCopied] = useState(false);
  const csrLink = (
    <a href={`/ajustes/arca/${c.id}/pedido`} className="link font-semibold">
      Descargar el pedido de certificado (.csr)
    </a>
  );
  return (
    <div className="space-y-4">
      {c.environment === "prod" ? (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>{csrLink}.</li>
          <li>
            Entrá a ARCA con la clave fiscal de {c.business_name} y abrí <b>«Administración de Certificados Digitales»</b>. Si
            no aparece, agregalo desde «Administrador de Relaciones de Clave Fiscal» → «Adherir servicio».
          </li>
          <li>
            Tocá <b>«Agregar alias»</b>, poné un nombre (por ejemplo <i>crm</i>), subí el archivo .csr y confirmá. Después
            entrá al alias y descargá el certificado (.crt).
          </li>
          <li>Subí ese .crt acá abajo.</li>
          <li>
            En <b>«Administrador de Relaciones de Clave Fiscal»</b> → «Nueva relación» → Buscar → ARCA → WebServices →{" "}
            <b>«Facturación Electrónica»</b>. En «Representante» elegí el alias que creaste y confirmá.
          </li>
          <li>
            En <b>«Administración de puntos de venta y domicilios»</b> creá un punto de venta del sistema{" "}
            <b>«Factura Electrónica - Monotributo - Web Services»</b> y cargá ese número en los datos ({c.point_of_sale} ahora).
          </li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Entrá a ARCA con la clave fiscal de {c.business_name}. En «Administrador de Relaciones de Clave Fiscal» →
            «Adherir servicio» → ARCA → Servicios interactivos → <b>«WSASS - Autogestión Certificados Homologación»</b>.
          </li>
          <li>
            Abrí WSASS → <b>«Nuevo certificado»</b>: poné un nombre (por ejemplo <i>crm</i>) y pegá este pedido:
            <textarea readOnly value={c.csr ?? ""} rows={4} className="input mt-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-sm mt-1"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(c.csr ?? "");
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copiado" : "Copiar pedido"}
            </button>{" "}
            <span className="text-xs text-muted">o {csrLink}</span>
          </li>
          <li>Tocá «Crear DN y obtener certificado», copiá el certificado que aparece y pegalo (o subilo) acá abajo.</li>
          <li>
            En WSASS → <b>«Crear autorización a servicio»</b>: elegí ese certificado y el servicio{" "}
            <b>«wsfe - Facturación Electrónica»</b>.
          </li>
        </ol>
      )}
      <CertUpload connectionId={c.id} />
    </div>
  );
}

function CertUpload({ connectionId }: { connectionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(uploadArcaCertificate, null);
  return (
    <form action={action} className="space-y-2 rounded-xl bg-subtle p-3">
      <input type="hidden" name="connection_id" value={connectionId} />
      <label className="label" htmlFor={`crt-${connectionId}`}>Certificado de ARCA (.crt)</label>
      <input id={`crt-${connectionId}`} type="file" name="certificate_file" accept=".crt,.pem,.cer,.txt" className="block text-sm" />
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">O pegar el texto del certificado</summary>
        <textarea name="certificate_text" rows={4} className="input mt-2 font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" />
      </details>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <SubmitButton pendingText="Probando con ARCA...">Subir y probar conexión</SubmitButton>
    </form>
  );
}

function TestForm({ connectionId }: { connectionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(testArcaConnection, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="connection_id" value={connectionId} />
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <SubmitButton pendingText="Probando con ARCA..." className="btn btn-sm">
        Probar conexión
      </SubmitButton>
    </form>
  );
}

// Certificado nuevo (renovación cada 2 años): mismo pedido si sigue siendo la misma clave
function ReplaceCert({ c }: { c: NonNullable<ArcaHolder["connection"]> }) {
  const [show, setShow] = useState(false);
  if (!show)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setShow(true)}>
        Subir certificado nuevo
      </button>
    );
  return (
    <div className="w-full">
      <CertificateSteps c={c} />
    </div>
  );
}
