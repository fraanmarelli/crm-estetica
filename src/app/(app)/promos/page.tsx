import { createClient } from "@/lib/supabase/server";
import { SectionTabs } from "@/components/section-tabs";
import { requireManagerContext } from "@/lib/context";
import { fmtDate, fmtMoney, todayISO } from "@/lib/format";
import type { Promotion } from "@/lib/types";
import { togglePromotion } from "./actions";
import { PromoForm } from "./promo-form";

type PromoRow = Promotion & {
  branch: { name: string } | null;
  items: (Promotion["items"][number] & { treatment: { name: string } | null })[];
};

export default async function PromosPage() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();

  const [{ data: promoData }, { data: treatmentData }] = await Promise.all([
    supabase
      .from("promotions")
      .select(
        "id, name, price, branch_id, valid_until, is_active, branch:branches(name), items:promotion_items(treatment_id, zone, sort_order, treatment:treatments(name))",
      )
      .eq("organization_id", ctx.org.id)
      .or(`branch_id.is.null,branch_id.eq.${ctx.currentBranch.id}`)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("treatments")
      .select("id, name, category")
      .eq("organization_id", ctx.org.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
  ]);

  const today = todayISO();
  const promos = (promoData ?? []) as unknown as PromoRow[];
  const live = promos.filter((p) => p.is_active && (!p.valid_until || p.valid_until >= today));
  const off = promos.filter((p) => !live.includes(p));

  function PromoItem({ p }: { p: PromoRow }) {
    const canEdit = p.branch_id === null ? ctx.isNetwork : true;
    const expired = Boolean(p.valid_until && p.valid_until < today);
    const items = [...p.items].sort((a, b) => a.sort_order - b.sort_order);
    return (
      <li className="card flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            <span className={`badge ${p.branch_id === null ? "badge-gold" : "badge-gray"}`}>
              {p.branch_id === null ? "Marca · toda la red" : (p.branch?.name ?? "Sucursal")}
            </span>
            {!p.is_active && <span className="badge badge-gray">Pausada</span>}
            {p.is_active && expired && <span className="badge badge-amber">Vencida</span>}
          </div>
          <p className="text-sm text-muted">
            {items.map((i) => `${i.treatment?.name ?? "Tratamiento"}${i.zone ? ` (${i.zone})` : ""}`).join(" + ")}
          </p>
          {p.valid_until && (
            <p className="text-xs text-muted">
              {expired ? "Venció" : "Vence"} el {fmtDate(p.valid_until)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-lg font-semibold">{fmtMoney(p.price)}</span>
          {canEdit && (
            <form action={togglePromotion}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
              <button className="btn btn-sm">{p.is_active ? "Pausar" : "Activar"}</button>
            </form>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <SectionTabs section="ajustes" />
      <div className="page-head">
        <div>
          <h1>Promos</h1>
          <p className="page-sub">
            Aparecen en «Aplicar promo» al cargar un turno, con el precio precargado. Las de la marca valen para todas
            las sucursales; las de {ctx.currentBranch.name}, solo acá.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2>Vigentes</h2>
        {live.length === 0 ? (
          <p className="text-sm text-muted">No hay promos vigentes. Creá la primera abajo.</p>
        ) : (
          <ul className="space-y-3">
            {live.map((p) => (
              <PromoItem key={p.id} p={p} />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4">
        <h2>Nueva promo</h2>
        <PromoForm
          treatments={(treatmentData ?? []) as { id: string; name: string; category: string | null }[]}
          isNetwork={ctx.isNetwork}
          branchName={ctx.currentBranch.name}
        />
      </section>

      {off.length > 0 && (
        <section className="space-y-3">
          <h2>Pausadas o vencidas</h2>
          <ul className="space-y-3 opacity-80">
            {off.map((p) => (
              <PromoItem key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
