"use client";

import { useTransition } from "react";
import { setViewAs } from "@/app/(app)/actions";

// «Ver como»: solo la marca. Muestra la app como la ve cada rol de la sucursal elegida.
export function ViewAsSwitcher({
  current,
  professionals,
  variant,
}: {
  current: string; // "" = Marca (yo)
  professionals: { id: string; full_name: string }[];
  variant: "side" | "strip";
}) {
  const [pending, start] = useTransition();
  const previewing = current !== "";
  return (
    <label
      className={
        variant === "side"
          ? `flex flex-col gap-1 rounded-xl px-1 ${previewing ? "text-gold-1" : "text-chrome-muted"}`
          : "flex min-w-0 items-center gap-2"
      }
    >
      <span className={variant === "side" ? "px-2 text-[0.7rem] font-semibold uppercase tracking-wider" : "shrink-0 text-xs font-semibold"}>
        Ver como
      </span>
      <select
        name="view_as"
        defaultValue={current}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("view_as", e.target.value);
          start(() => setViewAs(fd));
        }}
        className={`input-chrome min-w-0 transition-opacity ${pending ? "opacity-60" : ""} ${
          previewing ? "ring-1 ring-gold-1" : ""
        }`}
      >
        <option value="">Marca (yo)</option>
        <option value="branch_admin">Franquiciado/a</option>
        <option value="reception">Recepción</option>
        {professionals.map((p) => (
          <option key={p.id} value={`professional:${p.id}`}>
            Profesional: {p.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
