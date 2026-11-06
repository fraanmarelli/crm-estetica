"use client";

import Link from "next/link";
import { LinkPending, useTappedHref } from "@/components/nav-links";

// Pestañas de un ítem del menú (ver docs/MAPA.md). Cada pestaña es una ruta propia.
const SECTIONS = {
  contactar: [
    { href: "/leads", label: "Leads" },
    { href: "/recall", label: "Recall" },
  ],
  numeros: [
    { href: "/numeros", label: "Ventas" },
    { href: "/comisiones", label: "Comisiones" },
    { href: "/facturacion", label: "Facturación" },
    { href: "/marketing", label: "Anuncios" },
    { href: "/insumos", label: "Insumos" },
  ],
  ajustes: [
    { href: "/ajustes", label: "General" },
    { href: "/promos", label: "Promos" },
  ],
} as const;

export function SectionTabs({ section }: { section: keyof typeof SECTIONS }) {
  const { pathname, tapped, tap } = useTappedHref();
  return (
    <nav aria-label="Secciones" className="-mx-1 overflow-x-auto pb-1">
      <div className="flex w-max gap-1 px-1">
        {SECTIONS[section].map((t) => {
          const active = tapped ? tapped === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              onClick={() => tap(t.href)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                active ? "bg-ink text-surface" : "text-muted hover:bg-ink/5 hover:text-ink"
              }`}
            >
              {t.label}
              <LinkPending />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
