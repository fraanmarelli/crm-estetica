"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; match?: string[] };

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

// Barra lateral (escritorio)
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.92rem] font-medium transition-colors ${
              active
                ? "bg-gold-1/12 text-gold-1"
                : "text-chrome-muted hover:bg-chrome-ink/5 hover:text-chrome-ink"
            }`}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Barra inferior (celular y tablet en vertical)
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex max-w-xl justify-around">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.7rem] font-semibold ${
                active ? "text-brand" : "text-muted"
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
