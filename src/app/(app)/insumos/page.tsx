import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import type { Supply } from "@/lib/types";
import { SupplyCostsForm } from "./supply-costs-form";
import { NewSupplyForm } from "./new-supply-form";
import { setTreatmentSupply } from "./actions";

type TreatmentRow = { id: string; name: string; category: string | null; supply_id: string | null };

export default async function SuppliesPage() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const canEdit = ctx.isNetwork;

  const [{ data: supplyData }, { data: treatmentData }] = await Promise.all([
    supabase.rpc("supply_list", { p_org: ctx.org.id }),
    supabase
      .from("treatments")
      .select("id, name, category, supply_id")
      .eq("organization_id", ctx.org.id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  const supplies = ((supplyData ?? []) as Supply[]).filter((s) => s.is_active);
  const treatments = (treatmentData ?? []) as TreatmentRow[];

  return (
    <div className="space-y-8">
      <div className="page-head">
        <div>
          <h1>Insumos</h1>
          <p className="page-sub">
            {canEdit
              ? "El costo de cada insumo para las franquicias. Con esto se calcula el margen de cada turno."
              : "Lo que cuesta cada insumo para tu franquicia. Lo define la marca."}
          </p>
        </div>
      </div>

      <SupplyCostsForm supplies={supplies} canEdit={canEdit} />

      <section className="space-y-3">
        <div>
          <h2>Qué insumo usa cada tratamiento</h2>
          <p className="text-sm text-muted">
            Recepción carga la cantidad usada en cada turno (por ejemplo, 50 unidades) y el costo se calcula solo.
          </p>
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Tratamiento</th>
                <th>Insumo</th>
              </tr>
            </thead>
            <tbody>
              {treatments.map((t) => {
                const current = supplies.find((s) => s.id === t.supply_id);
                return (
                  <tr key={t.id}>
                    <td>
                      <span className="font-medium">{t.name}</span>
                      {t.category && <span className="block text-xs text-muted">{t.category}</span>}
                    </td>
                    <td>
                      {canEdit ? (
                        <form action={setTreatmentSupply} className="flex gap-2">
                          <input type="hidden" name="treatment_id" value={t.id} />
                          <select
                            name="supply_id"
                            defaultValue={t.supply_id ?? ""}
                            aria-label={`Insumo de ${t.name}`}
                            className="input"
                          >
                            <option value="">Sin insumo (no suma costo)</option>
                            {supplies.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-sm">Guardar</button>
                        </form>
                      ) : (
                        <span className={current ? "" : "text-muted"}>{current?.name ?? "Sin insumo"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit && (
        <section className="card space-y-3">
          <h2>Agregar un insumo</h2>
          <NewSupplyForm />
        </section>
      )}
    </div>
  );
}
