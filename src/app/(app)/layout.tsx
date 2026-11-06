import { Suspense, type CSSProperties } from "react";
import { DoneToast } from "@/components/done-toast";
import { getContext } from "@/lib/context";
import { ROLE_LABEL } from "@/lib/format";
import { BranchSwitcher } from "@/components/branch-switcher";
import { ViewAsSwitcher } from "@/components/view-as-switcher";
import { createClient } from "@/lib/supabase/server";
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

  const isProfessional = !ctx.canManageCurrentBranch && ctx.roles.includes("professional");

  // «Ver como»: solo la marca; las profesionales de la sucursal elegida
  let viewAsPros: { id: string; full_name: string }[] = [];
  if (ctx.realIsNetwork && ctx.currentBranch) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("professionals")
      .select("id, full_name, branch_id")
      .eq("organization_id", ctx.org.id)
      .eq("is_active", true)
      .order("full_name");
    viewAsPros = ((data ?? []) as { id: string; full_name: string; branch_id: string | null }[]).filter(
      (p) => !p.branch_id || p.branch_id === ctx.currentBranch!.id,
    );
  }
  const viewAsValue = ctx.viewAs
    ? ctx.viewAs.role === "professional"
      ? `professional:${ctx.viewAs.professionalId}`
      : ctx.viewAs.role
    : "";
  const viewAsName =
    ctx.viewAs?.role === "professional"
      ? (viewAsPros.find((p) => p.id === ctx.viewAs!.professionalId)?.full_name ?? "Profesional")
      : ctx.viewAs
        ? ROLE_LABEL[ctx.viewAs.role]
        : null;

  // Menú según docs/MAPA.md: máximo 5 ítems (6 la marca); lo secundario va en pestañas
  const items: NavItem[] = [
    { href: "/", label: "Hoy", icon: "today" },
    { href: "/pacientes", label: "Pacientes", icon: "patients" },
    ...(ctx.canContactCurrentBranch
      ? ([{ href: "/leads", label: "Contactar", icon: "leads", match: ["/recall"] }] as NavItem[])
      : []),
    // La profesional ve sus comisiones; franquiciado y marca las ven en Números → Comisiones
    ...(isProfessional
      ? ([{ href: "/comisiones", label: "Mis comisiones", shortLabel: "Comisiones", icon: "numbers" }] as NavItem[])
      : []),
    ...(ctx.canManageCurrentBranch
      ? ([
          {
            href: "/numeros",
            label: "Números",
            icon: "numbers",
            match: ["/facturacion", "/marketing", "/insumos", "/comisiones"],
          },
        ] as NavItem[])
      : []),
    ...(ctx.isNetwork
      ? ([{ href: "/marca", label: `Sucursales ${ctx.org.name}`, shortLabel: "Sucursales", icon: "brand" }] as NavItem[])
      : []),
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

  const role = ctx.viewAs ? `Marca · viendo como ${viewAsName}` : ROLE_LABEL[ctx.roles[0]];

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
        {ctx.realIsNetwork && (
          <ViewAsSwitcher current={viewAsValue} professionals={viewAsPros} variant="side" />
        )}
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

      {/* «Ver como» en el celular (solo la marca); en la compu está en la barra lateral */}
      {ctx.realIsNetwork && (
        <div
          className="border-t border-chrome-line bg-chrome py-2 text-chrome-ink lg:hidden"
          style={{
            paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
            paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
          }}
        >
          <ViewAsSwitcher current={viewAsValue} professionals={viewAsPros} variant="strip" />
        </div>
      )}

      <main
        className="mx-auto w-full max-w-6xl pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        {ctx.viewAs && (
          <p className="mb-5 rounded-xl bg-gold-1/15 px-4 py-2.5 text-sm">
            Estás viendo la app como <strong>{viewAsName}</strong>. Lo que guardes se guarda de verdad. Para volver,
            elegí «Marca (yo)» en «Ver como».
          </p>
        )}
        {children}
      </main>

      <BottomNav items={items} />
      <Suspense fallback={null}>
        <DoneToast />
      </Suspense>
    </div>
  );
}
