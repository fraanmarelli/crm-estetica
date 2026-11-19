"use client";

import Link from "next/link";
import { useState } from "react";
import { buildImport, CONTROL, OTHER, type ImportPreview } from "@/lib/sheet-import";
import { fmtMoney } from "@/lib/format";
import { finishImport, importSheetChunk } from "./actions";

const CHUNK = 250;
const fmtDay = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

type Done = { imported: number; already: number; crm: number; patients: number };

export function ImportPanel({
  branchName,
  catalog,
  accounts,
  today,
}: {
  branchName: string;
  catalog: string[];
  accounts: { name: string; currency: string }[];
  today: string;
}) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [readError, setReadError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    setPreview(null);
    setDone(null);
    setError("");
    setReadError("");
    if (!file) return;
    setFileName(file.name);
    try {
      const p = buildImport(await file.text(), catalog, accounts, today);
      if (p.missingHeaders.length || p.rows.length === 0) {
        setReadError(
          "No encontré las columnas de la planilla (Nombres, Tratamiento/s realizado/s, Total). Bajala desde Google Sheets con Archivo → Descargar → Valores separados por comas (.csv), con la hoja «Actual» abierta.",
        );
        return;
      }
      setPreview(p);
    } catch {
      setReadError("No se pudo leer el archivo. Tiene que ser el .csv bajado de Google Sheets.");
    }
  }

  async function run() {
    if (!preview) return;
    setError("");
    const total: Done = { imported: 0, already: 0, crm: 0, patients: 0 };
    for (let i = 0; i < preview.rows.length; i += CHUNK) {
      setProgress(i / preview.rows.length);
      const res = await importSheetChunk(preview.rows.slice(i, i + CHUNK));
      if ("error" in res) {
        setError(`${res.error} Lo que ya entró queda guardado: volvé a tocar «Importar» y sigue desde donde quedó.`);
        setProgress(null);
        return;
      }
      total.imported += res.imported;
      total.already += res.already;
      total.crm += res.crm;
      total.patients += res.patients;
    }
    await finishImport();
    setProgress(null);
    setDone(total);
  }

  const recognized = preview
    ? preview.byTreatment.filter(([t]) => t !== OTHER && t !== CONTROL).reduce((s, [, n]) => s + n, 0)
    : 0;
  const others = preview?.byTreatment.find(([t]) => t === OTHER)?.[1] ?? 0;
  const controls = preview?.byTreatment.find(([t]) => t === CONTROL)?.[1] ?? 0;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>En Google Sheets abrí la hoja «Actual».</li>
          <li>Archivo → Descargar → Valores separados por comas (.csv).</li>
          <li>Elegí ese archivo acá abajo. Antes de guardar nada te muestro qué va a entrar.</li>
        </ol>
        <label className="btn cursor-pointer">
          {fileName ? "Elegir otro archivo" : "Elegir el archivo .csv"}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
            disabled={progress !== null}
          />
        </label>
        {fileName && <p className="text-xs text-muted">{fileName}</p>}
        {readError && <p className="alert-error">{readError}</p>}
      </div>

      {preview && !done && (
        <div className="card space-y-4">
          <div>
            <h2>Lo que va a entrar en {branchName}</h2>
            <p className="text-sm text-muted">
              Del {fmtDay(preview.from)} al {fmtDay(preview.to)}. Lo que ya entró en otra importación no se repite.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-xs text-muted">Visitas</dt>
              <dd className="num text-xl font-semibold">{preview.rows.length.toLocaleString("es-AR")}</dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-xs text-muted">Pacientes</dt>
              <dd className="num text-xl font-semibold">{preview.patients.toLocaleString("es-AR")}</dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-xs text-muted">Cobrado</dt>
              <dd className="num text-xl font-semibold">{fmtMoney(preview.billed)}</dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-xs text-muted">Filas que no entran</dt>
              <dd className={`num text-xl font-semibold ${preview.skipped.length ? "text-warn" : ""}`}>{preview.skipped.length}</dd>
            </div>
          </dl>

          <details className="fold">
            <summary className="cursor-pointer text-sm font-semibold">
              Tratamientos: {recognized.toLocaleString("es-AR")} reconocidos, {controls.toLocaleString("es-AR")} controles,{" "}
              {others.toLocaleString("es-AR")} como «{OTHER}»
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ul className="space-y-1 text-sm">
                {preview.byTreatment.map(([t, n]) => (
                  <li key={t} className="flex justify-between gap-3">
                    <span className={t === OTHER ? "text-warn" : ""}>{t}</span>
                    <span className="num text-muted">{n}</span>
                  </li>
                ))}
              </ul>
              {preview.unknown.length > 0 && (
                <div className="space-y-1 text-sm">
                  <p className="text-xs text-muted">
                    Sin opción en el catálogo (entran como «{OTHER}» con el texto, y se pueden reasignar después):
                  </p>
                  <ul className="space-y-0.5 text-xs">
                    {preview.unknown.slice(0, 25).map(([t, n]) => (
                      <li key={t} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{t}</span>
                        <span className="num text-muted">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          <details className="fold">
            <summary className="cursor-pointer text-sm font-semibold">
              Médicos/as: {preview.professionals.map(([p]) => p).join(", ") || "ninguno"}
            </summary>
            <p className="mt-2 text-sm text-muted">
              Los que no están en el CRM se crean como inactivos (figuran en el historial, no se eligen para turnos
              nuevos). Si coincide el comienzo del nombre, se usa el que ya está («Ulma Irina Feser» = «Ulma»).
            </p>
          </details>

          {preview.skipped.length > 0 && (
            <details className="fold">
              <summary className="cursor-pointer text-sm font-semibold text-warn">
                {preview.skipped.length === 1 ? "1 fila no entra" : `${preview.skipped.length} filas no entran`}
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {preview.skipped.slice(0, 100).map((s) => (
                  <li key={s.line}>
                    <span className="num font-semibold">Fila {s.line}</span>: {s.reason}
                    {s.sample && <span className="text-muted">, {s.sample}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Las pacientes nuevas quedan con «Ficha incompleta» y sin consentimiento de recordatorios.</li>
            <li>La comisión y el insumo son los de la planilla. Los controles van a $0.</li>
            <li>No da millas, no se manda a la planilla ni al calendario y no se verifica en Mercado Pago.</li>
            <li>El «Comentario» queda como nota clínica (no la ve recepción).</li>
          </ul>

          {error && <p className="alert-error">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            {progress !== null && (
              <span className="num text-sm text-muted">Importando… {Math.round(progress * 100)}%</span>
            )}
            <button type="button" className="btn btn-primary" onClick={run} disabled={progress !== null} aria-busy={progress !== null}>
              {progress !== null ? "Importando..." : `Importar ${preview.rows.length.toLocaleString("es-AR")} visitas`}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="card space-y-3">
          <p className="alert-ok">
            Listo: entraron {done.imported.toLocaleString("es-AR")} visitas y {done.patients.toLocaleString("es-AR")}{" "}
            pacientes nuevas.
            {done.already > 0 && ` ${done.already.toLocaleString("es-AR")} ya estaban de antes.`}
            {done.crm > 0 && ` ${done.crm.toLocaleString("es-AR")} se saltearon porque ese día ya tenían un turno cargado en el CRM.`}
          </p>
          <Link href="/pacientes" className="btn">Ver pacientes</Link>
        </div>
      )}
    </div>
  );
}
