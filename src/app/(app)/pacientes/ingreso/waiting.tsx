"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Mientras la paciente completa la ficha, revisa cada 3 segundos si ya la envió
export function IntakeWaiting() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden="true" />
      Esperando que la paciente complete sus datos…
    </p>
  );
}
