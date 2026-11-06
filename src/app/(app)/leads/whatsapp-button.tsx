"use client";

import { useTransition } from "react";
import { IconWhatsApp } from "@/components/icons";
import { markLeadContacted } from "./actions";
import { useLeadUndo } from "./undo";

// Abre WhatsApp con el mensaje escrito y registra que se le escribió (con «Deshacer» por si no se mandó)
export function LeadWhatsAppButton({
  id,
  name,
  href,
  label = "Escribirle",
  primary,
}: {
  id: string;
  name: string;
  href: string;
  label?: string;
  primary: boolean;
}) {
  const [pending, start] = useTransition();
  const showUndo = useLeadUndo();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`btn btn-sm ${primary ? "btn-primary" : ""}`}
      onClick={() => {
        window.open(href, "_blank", "noopener,noreferrer");
        start(async () => {
          await markLeadContacted(id);
          showUndo({ id, name });
        });
      }}
    >
      <IconWhatsApp className="h-4 w-4" />
      {label}
    </button>
  );
}
