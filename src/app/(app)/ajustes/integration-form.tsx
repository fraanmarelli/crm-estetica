"use client";

import { useActionState, useState } from "react";
import { createIntegration } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState, Branch } from "@/lib/types";

export function IntegrationForm({
  branches,
  isNetwork,
  currentBranch,
}: {
  branches: Branch[];
  isNetwork: boolean;
  currentBranch: Branch;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createIntegration, null);
  const v = state?.ok ? {} : (state?.values ?? {});
  const [type, setType] = useState(v.type ?? "klaviyo");

  return (
    <form key={state?.ok ?? JSON.stringify(v)} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="int-type">Qué querés conectar</label>
          <select id="int-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className="input">
            <option value="klaviyo">Klaviyo (email marketing)</option>
            <option value="google_calendar">Google Calendar (agenda de turnos)</option>
            <option value="google_sheets">Google Sheets (copia de turnos)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="int-branch">Sucursal</label>
          {isNetwork ? (
            <select id="int-branch" name="branch_id" defaultValue={v.branch_id ?? currentBranch.id} className="input">
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="input bg-subtle">{currentBranch.name}</p>
          )}
        </div>
      </div>

      {type === "klaviyo" ? (
        <>
          <div>
            <label className="label" htmlFor="int-secret">Clave privada de Klaviyo</label>
            <input
              id="int-secret"
              name="secret"
              required
              autoComplete="off"
              defaultValue={v.secret}
              placeholder="pk_..."
              className="input"
            />
            <p className="mt-1 text-xs text-muted">
              Klaviyo → Settings → API keys → Create private API key, con acceso completo a Events, Profiles y
              Subscriptions. Después de guardarla no se puede volver a ver.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="int-list">ID de la lista de email (opcional)</label>
            <input id="int-list" name="list_id" defaultValue={v.list_id} placeholder="Ej. XyZ123" className="input" />
            <p className="mt-1 text-xs text-muted">
              Si lo completás, las pacientes que aceptaron recibir mails se suscriben a esa lista.
            </p>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="int-url">URL de la aplicación web (Apps Script)</label>
            <input
              id="int-url"
              name="url"
              required
              defaultValue={v.url}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="int-token">Token (el mismo que CONFIG.TOKEN del script)</label>
            <input id="int-token" name="secret" required autoComplete="off" defaultValue={v.secret} className="input" />
            <p className="mt-1 text-xs text-muted">
              {type === "google_calendar"
                ? "Script: google-apps-script/Calendario.gs. Se crea, edita y borra un evento por cada turno."
                : "Script: google-apps-script/Code.gs. Se agrega una fila por cada turno realizado."}
            </p>
          </div>
        </>
      )}

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton>Conectar</SubmitButton>
      </div>
    </form>
  );
}
