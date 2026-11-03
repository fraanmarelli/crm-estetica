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
} from "@/components/icons";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

const ICONS = {
  today: IconToday,
  patients: IconPatients,
  recall: IconRecall,
  marketing: IconMarketing,
  brand: IconBrand,
  settings: IconSettings,
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// Barra lateral (escritorio)
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
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
        {items.slice(0, 5).map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
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
