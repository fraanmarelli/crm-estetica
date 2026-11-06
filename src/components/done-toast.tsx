"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// «✓ Turno guardado» después de guardar y volver a otra pantalla: la acción redirige con ?listo=<código>
const MESSAGES: Record<string, string> = {
  turno: "Turno guardado",
  cobro: "Cobro guardado",
  paciente: "Paciente guardada",
  ficha: "Ficha completa",
};

export function DoneToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const code = params.get("listo");
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!code || !MESSAGES[code]) return;
    setShown(MESSAGES[code]);
    // Después del destello, saca ?listo y ?ultimo de la dirección para que no vuelvan a aparecer al recargar
    const clean = setTimeout(() => {
      const rest = new URLSearchParams(params.toString());
      rest.delete("listo");
      rest.delete("ultimo");
      const q = rest.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }, 1500);
    return () => clearTimeout(clean);
  }, [code, params, pathname, router]);

  // Se va sola (aparte: no se corta cuando cambia la dirección)
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + var(--undo-offset, 84px))" }}
    >
      <div className="toast-in rounded-full bg-chrome px-5 py-2.5 text-sm font-semibold text-chrome-ink shadow-lg">
        <span className="text-gold-1">✓</span> {shown}
      </div>
    </div>
  );
}
