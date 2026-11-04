"use client";

import { useTransition } from "react";
import { setBranch } from "@/app/(app)/actions";
import type { Branch } from "@/lib/types";

export function BranchSwitcher({ branches, currentId }: { branches: Branch[]; currentId: string | null }) {
  const [pending, startTransition] = useTransition();

  if (branches.length <= 1) {
    return <p className="truncate px-1 text-sm font-semibold">{branches[0]?.name ?? "Sin sucursal"}</p>;
  }
  return (
    <div className="relative">
      <label htmlFor="branch-switcher" className="sr-only">Sucursal</label>
      <select
        id="branch-switcher"
        name="branch_id"
        defaultValue={currentId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("branch_id", e.target.value);
          startTransition(() => setBranch(fd));
        }}
        className={`input-chrome transition-opacity ${pending ? "opacity-60" : ""}`}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {pending && (
        <span className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-gold-1 border-t-transparent" />
      )}
    </div>
  );
}
