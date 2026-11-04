"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

// Refresca la lista de "se registraron hoy" cada 5 segundos
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copiado" : "Copiar link"}
    </button>
  );
}

// Cambiar el link pide confirmación en la misma pantalla
export function RotateButton() {
  const [confirming, setConfirming] = useState(false);
  const { pending } = useFormStatus();
  if (!confirming) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
        Cambiar link
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-warn">El link y el QR actuales dejan de funcionar.</span>
      <button type="submit" disabled={pending} className="btn btn-sm btn-primary">
        {pending ? "Cambiando..." : "Sí, cambiar"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
        Cancelar
      </button>
    </span>
  );
}
