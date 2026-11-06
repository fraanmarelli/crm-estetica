"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconBrand,
  IconMarketing,
  IconPatients,
  IconRecall,
  IconSettings,
  IconToday,
  IconNumbers,
  IconSupplies,
  IconBilling,
  IconPromo,
  IconLeads,
} from "@/components/icons";

// match: otras rutas que también marcan este ítem como activo (sus pestañas)
// shortLabel: el que se ve en la barra de abajo del celular si el nombre es largo
export type NavItem = { href: string; label: string; shortLabel?: string; icon: keyof typeof ICONS; match?: string[] };

const ICONS = {
  today: IconToday,
  patients: IconPatients,
  recall: IconRecall,
  marketing: IconMarketing,
  brand: IconBrand,
  settings: IconSettings,
  numbers: IconNumbers,
  supplies: IconSupplies,
  billing: IconBilling,
  promos: IconPromo,
  leads: IconLeads,
};

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/") return pathname === "/" || pathname.startsWith("/turnos");
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Barrita de arriba mientras carga la pantalla de este link (va adentro del <Link>)
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-progress" aria-hidden="true" /> : null;
}

// El ítem tocado se marca al instante, sin esperar a que llegue la pantalla nueva
export function useTappedHref() {
  const pathname = usePathname();
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  // Cuando cambia la ruta, manda la ruta real
  const current = tapped && tapped.from === pathname ? tapped.href : null;
  useEffect(() => {
    if (tapped && tapped.from !== pathname) setTapped(null);
  }, [pathname, tapped]);
  return { pathname, tapped: current, tap: (href: string) => setTapped({ href, from: pathname }) };
}

// Barra lateral (escritorio)
export function SideNav({ items }: { items: NavItem[] }) {
  const { pathname, tapped, tap } = useTappedHref();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = tapped ? tapped === item.href : isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={() => tap(item.href)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.92rem] font-medium transition-colors ${
              active
                ? "bg-gold-1/12 text-gold-1"
                : "text-chrome-muted hover:bg-chrome-ink/5 hover:text-chrome-ink"
            }`}
          >
            <Icon />
            {item.label}
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}

// Barra inferior (celular y tablet en vertical)
export function BottomNav({ items }: { items: NavItem[] }) {
  const { pathname, tapped, tap } = useTappedHref();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex max-w-xl justify-around">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = tapped ? tapped === item.href : isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => tap(item.href)}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.7rem] font-semibold ${
                active ? "text-brand" : "text-muted"
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              <span className="truncate">{item.shortLabel ?? item.label}</span>
              <LinkPending />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
