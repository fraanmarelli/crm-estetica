import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { SectionTabs } from "@/components/section-tabs";
import { requireManagerContext } from "@/lib/context";
import { fmtDate } from "@/lib/format";
import type { Supply } from "@/lib/types";
import { SupplyCostsForm } from "./supply-costs-form";
import { NewSupplyForm } from "./new-supply-form";
import { setTreatmentSupply } from "./actions";

type TreatmentRow = { id: string; name: string; category: string | null; supply_id: string | null };

type LotRow = {
  appointment_id: string;
  scheduled_at: string;
  branch_name: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string | null;
  treatment: string;
  professional_name: string | null;
  lot_code: string;
};

export default async function SuppliesPage({
  searchParams,
}: {
  searchParams: Promise<{ lote?: string; red?: string }>;
}) {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const canEdit = ctx.isNetwork;
  const sp = await searchParams;
  const lot = (sp.lote ?? "").trim().slice(0, 60);
  const wholeNetwork = ctx.isNetwork && sp.red === "1";
  const { data: lotData, error: lotError } = lot
    ? await supabase.rpc("lot_trace", {
        p_org: ctx.org.id,
        p_branch: wholeNetwork ? null : ctx.currentBranch.id,
        p_lot: lot,
      })
    : { data: null, error: null };
  const lotRows = (lotData ?? []) as LotRow[];

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
      <SectionTabs section="numeros" />
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

      {/* Trazabilidad (ANMAT): a qué pacientes se les aplicó un lote */}
      <section className="space-y-3" id="lote">
        <h2>Buscar lote</h2>
        <form className="card flex flex-wrap items-end gap-3" action="/insumos#lote">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="lot-search">Código de lote</label>
            <input
              id="lot-search"
              name="lote"
              defaultValue={lot}
              placeholder="Ej. el de una alerta de ANMAT"
              autoComplete="off"
              className="input num uppercase"
            />
          </div>
          {ctx.isNetwork && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="red" value="1" defaultChecked={wholeNetwork} />
              En toda la red
            </label>
          )}
          <button className="btn btn-primary">Buscar</button>
        </form>
        {lotError && <p className="alert-error">No se pudo buscar el lote: {lotError.message}</p>}
        {lot && !lotError && (
          <div className="card overflow-x-auto p-0">
            {lotRows.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                Ningún tratamiento atendido con un lote que contenga «{lot.toUpperCase()}»
                {wholeNetwork ? " en la red" : ` en ${ctx.currentBranch.name}`}.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Paciente</th>
                    <th>Tratamiento</th>
                    <th>Lote</th>
                    {wholeNetwork && <th>Sucursal</th>}
                    <th>Profesional</th>
                  </tr>
                </thead>
                <tbody>
                  {lotRows.map((r) => (
                    <tr key={`${r.appointment_id}-${r.treatment}-${r.lot_code}`}>
                      <td className="whitespace-nowrap">{fmtDate(r.scheduled_at)}</td>
                      <td>
                        <Link href={`/pacientes/${r.patient_id}`} className="font-medium hover:text-brand">
                          {r.patient_name}
                        </Link>
                        {r.patient_phone && <span className="num block text-xs text-muted">+{r.patient_phone}</span>}
                      </td>
                      <td>{r.treatment}</td>
                      <td className="num">{r.lot_code}</td>
                      {wholeNetwork && <td className="text-muted">{r.branch_name}</td>}
                      <td className="text-muted">{r.professional_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

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
                          <SubmitButton className="btn btn-sm" doneText="Guardado">Guardar</SubmitButton>
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
