"use client";

import { useTransition } from "react";
import { setRoadmap } from "@/app/(app)/actions";

// «Mostrar lo que viene»: solo la marca. Prende las funciones planeadas en gris («Próximamente»)
// en el lugar donde van a estar, para mostrar el producto.
export function RoadmapToggle({ on, variant }: { on: boolean; variant: "side" | "strip" }) {
  const [pending, start] = useTransition();
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 text-sm ${
        variant === "side" ? "rounded-xl px-3 py-1" : "shrink-0 text-xs"
      } ${on ? "text-gold-1" : "text-chrome-muted"} ${pending ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("on", e.target.checked ? "1" : "0");
          start(() => setRoadmap(fd));
        }}
        className="h-4 w-4 accent-[var(--brand)]"
      />
      <span className="font-semibold">Mostrar lo que viene</span>
    </label>
  );
}
