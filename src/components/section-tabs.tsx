"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
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
    { href: "/cambios", label: "Cambios" },
  ],
  ajustes: [
    { href: "/ajustes", label: "General" },
    { href: "/promos", label: "Promos" },
  ],
} as const;

export function SectionTabs({ section }: { section: keyof typeof SECTIONS }) {
  const { pathname, tapped, tap } = useTappedHref();
  const tabs = SECTIONS[section];
  const activeIndex = tabs.findIndex((t) =>
    tapped ? tapped === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`),
  );
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  // Marca de la pestaña activa: se mide la pestaña y la marca se desliza hasta ahí (solo transform)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[activeIndex];
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    // Cuando termina de cargar la tipografía cambia el ancho de las pestañas
    document.fonts?.ready.then(measure);
  }, [activeIndex]);

  return (
    <nav aria-label="Secciones" className="-mx-1 overflow-x-auto pb-1">
      <div className="relative flex w-max gap-1 px-1">
        {pill && (
          <span
            className="tab-slider"
            style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
            aria-hidden="true"
          />
        )}
        {tabs.map((t, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={t.href}
              ref={(el) => {
                refs.current[i] = el;
              }}
              href={t.href}
              aria-current={active ? "page" : undefined}
              onClick={() => tap(t.href)}
              className={`relative z-[1] rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-200 ${
                active ? `text-surface ${pill ? "" : "bg-ink"}` : "text-muted hover:text-ink"
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
