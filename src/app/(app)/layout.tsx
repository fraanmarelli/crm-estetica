import type { CSSProperties } from "react";
import { getContext } from "@/lib/context";
import { ROLE_LABEL } from "@/lib/format";
import { BranchSwitcher } from "@/components/branch-switcher";
import { BrandMark } from "@/components/brand-mark";
import { BottomNav, SideNav, type NavItem } from "@/components/nav-links";
import { IconLogout } from "@/components/icons";

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();

  if (!ctx) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-md space-y-3 text-center">
          <h1>Tu usuario todavía no tiene acceso</h1>
          <p className="text-sm text-muted">Pedile a la marca o a tu franquiciado que te asignen una sucursal.</p>
          <form action="/auth/signout" method="post">
            <button className="btn">Salir</button>
          </form>
        </div>
      </main>
    );
  }

  // Menú según docs/MAPA.md: máximo 5 ítems (6 la marca); lo secundario va en pestañas
  const items: NavItem[] = [
    { href: "/", label: "Hoy", icon: "today" },
    { href: "/pacientes", label: "Pacientes", icon: "patients" },
    ...(ctx.canContactCurrentBranch
      ? ([{ href: "/leads", label: "Contactar", icon: "leads", match: ["/recall"] }] as NavItem[])
      : []),
    ...(ctx.canManageCurrentBranch
      ? ([
          {
            href: "/numeros",
            label: "Números",
            icon: "numbers",
            match: ["/facturacion", "/marketing", "/insumos"],
          },
        ] as NavItem[])
      : []),
    ...(ctx.isNetwork ? ([{ href: "/marca", label: "Red", icon: "brand" }] as NavItem[]) : []),
    ...(ctx.canManageCurrentBranch
      ? ([{ href: "/ajustes", label: "Ajustes", icon: "settings", match: ["/promos", "/equipo"] }] as NavItem[])
      : []),
  ];

  // Colores propios de la organización (si los cargó) pisan los del tema
  const brand = ctx.org.settings.brand ?? {};
  const themeVars: Record<string, string> = {};
  if (brand.primary && HEX.test(brand.primary)) themeVars["--brand"] = brand.primary;
  if (brand.primary_strong && HEX.test(brand.primary_strong)) themeVars["--brand-strong"] = brand.primary_strong;
  if (brand.primary_soft && HEX.test(brand.primary_soft)) themeVars["--brand-soft"] = brand.primary_soft;

  const role = ROLE_LABEL[ctx.roles[0]];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]" style={themeVars as CSSProperties}>
      {/* Lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 bg-chrome px-4 py-7 text-chrome-ink lg:flex">
        <div className="px-3 pb-1">
          <BrandMark org={ctx.org} />
        </div>
        <div className="px-1">
          <BranchSwitcher branches={ctx.branches} currentId={ctx.currentBranch?.id ?? null} />
        </div>
        <SideNav items={items} />
        <div className="mt-auto flex items-center gap-2 border-t border-chrome-line px-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{ctx.email}</p>
            <p className="text-xs text-chrome-muted">{role}</p>
          </div>
          <form action="/auth/signout" method="post">
            <button className="rounded-lg p-2 text-chrome-muted hover:bg-chrome-ink/5 hover:text-chrome-ink" aria-label="Salir">
              <IconLogout />
            </button>
          </form>
        </div>
      </aside>

      {/* Barra superior (celular y tablet) */}
      <header
        className="sticky top-0 z-20 flex items-center gap-3 bg-chrome py-2.5 text-chrome-ink lg:hidden"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
          top: "env(safe-area-inset-top, 0px)",
        }}
      >
        <BrandMark org={ctx.org} variant="mono" />
        <div className="ml-auto min-w-0 max-w-[55%]">
          <BranchSwitcher branches={ctx.branches} currentId={ctx.currentBranch?.id ?? null} />
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-6xl pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        {children}
      </main>

      <BottomNav items={items} />
    </div>
  );
}
