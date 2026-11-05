"use client";

import { useTransition } from "react";
import { IconWhatsApp } from "@/components/icons";
import { markLeadContacted } from "./actions";

// Abre WhatsApp con el mensaje escrito y marca el lead como contactado
export function LeadWhatsAppButton({ id, href, primary }: { id: string; href: string; primary: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={`btn btn-sm ${primary ? "btn-primary" : ""}`}
      onClick={() => {
        window.open(href, "_blank", "noopener,noreferrer");
        start(() => markLeadContacted(id));
      }}
    >
      <IconWhatsApp className="h-4 w-4" />
      Escribirle
    </button>
  );
}
