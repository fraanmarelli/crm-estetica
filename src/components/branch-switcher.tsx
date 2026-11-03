"use client";

import { setBranch } from "@/app/(app)/actions";
import type { Branch } from "@/lib/types";

export function BranchSwitcher({ branches, currentId }: { branches: Branch[]; currentId: string | null }) {
  if (branches.length <= 1) {
    return (
      <p className="truncate px-2 text-sm font-semibold text-ink">
        {branches[0]?.name ?? "Sin sucursal"}
      </p>
    );
  }
  return (
    <form action={setBranch}>
      <label htmlFor="branch-switcher" className="sr-only">Sucursal</label>
      <select
        id="branch-switcher"
        name="branch_id"
        defaultValue={currentId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input py-2 font-semibold"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </form>
  );
}
