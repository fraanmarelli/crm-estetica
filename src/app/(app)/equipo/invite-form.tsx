"use client";

import { useActionState, useState } from "react";
import { createInvite, type InviteState } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { CopyLink } from "@/app/(app)/pacientes/registro/client-bits";
import { ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";

// Invitar a alguien: mail + rol (+ sucursal para la marca, + ficha si es profesional)
export function InviteForm({
  roles,
  branches,
  professionals = [],
  orgName,
  fixedBranchId,
}: {
  roles: Role[];
  /** La marca elige la sucursal; si no, va en fixedBranchId */
  branches?: { id: string; name: string }[];
  fixedBranchId?: string;
  professionals?: { id: string; full_name: string }[];
  orgName: string;
}) {
  const [state, action] = useActionState<InviteState, FormData>(createInvite, null);
  const [role, setRole] = useState<Role>(roles[0]);
  const needsBranch = branches && !["network_owner", "network_admin"].includes(role);
  const message = state?.link
    ? `Hola! Te sumé al CRM de ${orgName}. Entrá a este link para crear tu contraseña: ${state.link}`
    : "";

  return (
    <div className="space-y-3">
      <form key={state?.link ?? "invite"} action={action} className="space-y-3">
        {fixedBranchId && <input type="hidden" name="branch_id" value={fixedBranchId} />}
        <div className={`grid gap-3 ${needsBranch ? "sm:grid-cols-[1.5fr_1fr_1fr]" : "sm:grid-cols-[1.5fr_1fr]"}`}>
          <div>
            <label className="label" htmlFor="inv-email">Mail</label>
            <input id="inv-email" name="email" type="email" required placeholder="nombre@gmail.com" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="inv-role">Rol</label>
            <select id="inv-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="input">
              {roles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
          {needsBranch && (
            <div>
              <label className="label" htmlFor="inv-branch">Sucursal</label>
              <select id="inv-branch" name="branch_id" required className="input" defaultValue="">
                <option value="" disabled>Elegí</option>
                {branches!.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {role === "professional" && professionals.length > 0 && (
          <div className="sm:max-w-sm">
            <label className="label" htmlFor="inv-prof">Es la ficha de</label>
            <select id="inv-prof" name="professional_id" className="input" defaultValue="">
              <option value="">Ninguna (profesional nueva)</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
        )}
        {state?.error && <p className="alert-error">{state.error}</p>}
        <div className="flex justify-end">
          <SubmitButton>Crear invitación</SubmitButton>
        </div>
      </form>

      {state?.link && (
        <div className="space-y-2 rounded-xl bg-subtle p-3 text-sm">
          <p className="font-semibold">Invitación para {state.email}</p>
          <p className="break-all text-xs text-muted">{state.link}</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-primary"
            >
              Mandar por WhatsApp
            </a>
            <a href={`mailto:${state.email}?subject=${encodeURIComponent(`Tu acceso al CRM de ${orgName}`)}&body=${encodeURIComponent(message)}`} className="btn btn-sm">
              Mandar por mail
            </a>
            <CopyLink url={state.link} />
          </div>
          <p className="text-xs text-muted">Vence en 7 días y sirve una sola vez. Mandalo solo a esa persona.</p>
        </div>
      )}
    </div>
  );
}
