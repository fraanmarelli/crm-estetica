import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { fmtDate, fmtMoney, fmtNumber, isoDaysAgo, pluralEs, todayISO } from "@/lib/format";
import { Kpi } from "@/components/kpi";

type Row = { nombre: string; facturado: number; costo: number; margen: number };
type Financials = {
  turnos: number;
  pacientes: number;
  nuevas: number;
  facturado: number;
  dolares: number;
  dolares_sin_cotizar: number;
  costo: number;
  comision: number;
  ingreso_neto: number;
  margen: number;
  items_sin_costo: number;
  por_profesional: (Row & { turnos: number; pacientes: number; comision: number })[];
  por_cuenta: { cuenta: string; moneda: "ARS" | "USD"; cobros: number; monto: number }[];
  por_tratamiento: (Row & { cantidad: number; insumo_usado: number; unidad: string | null })[];
  mejores_pacientes: { id: string; nombre: string; visitas: number; gastado: number; ultima_visita: string }[];
};

const PERIODS = [
  { key: "mes", label: "Este mes" },
  { key: "30", label: "30 días" },
  { key: "90", label: "90 días" },
  { key: "365", label: "12 meses" },
];

function range(key: string): { from: string; to: string } {
  const to = todayISO();
  if (key === "mes") return { from: `${to.slice(0, 7)}-01`, to };
  return { from: isoDaysAgo(Number(key)), to };
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await requireManagerContext();
  const { periodo = "mes" } = await searchParams;
  const period = PERIODS.find((p) => p.key === periodo) ?? PERIODS[0];
  const { from, to } = range(period.key);
  const cur = ctx.org.currency;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("branch_financials", {
    p_branch: ctx.currentBranch.id,
    p_from: from,
    p_to: to,
  });

  if (error || !data) {
    return <p className="alert-error">No se pudieron cargar los números: {error?.message ?? "sin datos"}</p>;
  }
  const f = data as Financials;
  const ticket = f.turnos ? f.facturado / f.turnos : 0;

  return (
    <div className="space-y-8">
      <div className="page-head">
        <div>
          <h1>Números</h1>
          <p className="page-sub">
            {ctx.currentBranch.name}, del {fmtDate(from)} al {fmtDate(to)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/numeros?periodo=${p.key}`}
              className={`btn btn-sm ${p.key === period.key ? "btn-primary" : ""}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Facturado"
          value={fmtMoney(f.facturado, cur)}
          hint={`${f.turnos} turnos · ticket ${fmtMoney(ticket, cur)}`}
        />
        <Kpi
          label="Ingreso neto"
          value={fmtMoney(f.ingreso_neto, cur)}
          hint={`${pct(f.ingreso_neto, f.facturado)} de lo facturado`}
          accent
        />
        <Kpi label="Insumos" value={fmtMoney(f.costo, cur)} hint={`${pct(f.costo, f.facturado)} de lo facturado`} />
        <Kpi
          label="Comisiones médicas"
          value={fmtMoney(f.comision, cur)}
          hint={`${pct(f.comision, f.facturado)} de lo facturado`}
        />
      </div>

      <p className="text-sm text-muted">
        {f.pacientes} pacientes atendidas, {f.nuevas} nuevas.
        {f.dolares > 0 && ` Además se cobraron ${fmtMoney(f.dolares, "USD")}`}
        {f.dolares_sin_cotizar > 0 && ` (${fmtMoney(f.dolares_sin_cotizar, "USD")} sin cotización, no sumados en pesos)`}
        {f.dolares > 0 && "."}
      </p>

      {f.items_sin_costo > 0 && (
        <p className="alert-error">
          {f.items_sin_costo} {f.items_sin_costo === 1 ? "tratamiento no tiene" : "tratamientos no tienen"} costo: falta
          el insumo o su costo. El margen real es menor al que se muestra. Revisalo en{" "}
          <Link href="/insumos" className="underline">Insumos</Link>.
        </p>
      )}

      <section className="space-y-3">
        <h2>Por profesional</h2>
        <div className="card overflow-x-auto p-0">
          {f.por_profesional.length === 0 ? (
            <p className="p-4 text-sm text-muted">Sin turnos realizados en el período.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Turnos</th>
                  <th>Pacientes</th>
                  <th>Facturado</th>
                  <th>Insumos</th>
                  <th>Comisión a pagar</th>
                  <th>Neto</th>
                </tr>
              </thead>
              <tbody>
                {f.por_profesional.map((r) => (
                  <tr key={r.nombre}>
                    <td className="font-medium">{r.nombre}</td>
                    <td>{r.turnos}</td>
                    <td>{r.pacientes}</td>
                    <td className="whitespace-nowrap">{fmtMoney(r.facturado, cur)}</td>
                    <td className="whitespace-nowrap">{fmtMoney(r.costo, cur)}</td>
                    <td className="whitespace-nowrap font-semibold">{fmtMoney(r.comision, cur)}</td>
                    <td className="whitespace-nowrap">
                      {fmtMoney(r.margen, cur)} <span className="text-xs text-muted">{pct(r.margen, r.facturado)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted">«Comisión a pagar» es la liquidación de cada médico para el período elegido.</p>
      </section>

      <section className="space-y-3">
        <h2>Por cuenta de cobro</h2>
        <div className="card overflow-x-auto p-0">
          {f.por_cuenta.length === 0 ? (
            <p className="p-4 text-sm text-muted">Sin cobros registrados en el período.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Cobros</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {f.por_cuenta.map((r) => (
                  <tr key={r.cuenta}>
                    <td className="font-medium">{r.cuenta}</td>
                    <td>{r.cobros}</td>
                    <td className="whitespace-nowrap">{fmtMoney(r.monto, r.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2>Por tratamiento</h2>
        <div className="card overflow-x-auto p-0">
          {f.por_tratamiento.length === 0 ? (
            <p className="p-4 text-sm text-muted">Sin tratamientos en el período.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tratamiento</th>
                  <th>Veces</th>
                  <th>Insumo usado</th>
                  <th>Facturado</th>
                  <th>Insumos</th>
                  <th>Margen</th>
                </tr>
              </thead>
              <tbody>
                {f.por_tratamiento.map((r) => (
                  <tr key={r.nombre}>
                    <td className="font-medium">{r.nombre}</td>
                    <td>{r.cantidad}</td>
                    <td className="whitespace-nowrap">
                      {r.insumo_usado && r.unidad
                        ? `${fmtNumber(Number(r.insumo_usado), 1)} ${pluralEs(r.unidad)}`
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap">{fmtMoney(r.facturado, cur)}</td>
                    <td className="whitespace-nowrap">{fmtMoney(r.costo, cur)}</td>
                    <td className="whitespace-nowrap">
                      {fmtMoney(r.margen, cur)} <span className="text-xs text-muted">{pct(r.margen, r.facturado)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted">
          Suma el precio escrito en cada tratamiento y descuenta solo insumos (la comisión es por turno, no por
          tratamiento).
        </p>
      </section>

      <section className="space-y-3">
        <h2>Pacientes que más gastaron (histórico)</h2>
        <div className="card overflow-x-auto p-0">
          {f.mejores_pacientes.length === 0 ? (
            <p className="p-4 text-sm text-muted">Todavía no hay pacientes con turnos realizados.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Visitas</th>
                  <th>Gastado</th>
                  <th>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {f.mejores_pacientes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/pacientes/${p.id}`} className="link">
                        {p.nombre}
                      </Link>
                    </td>
                    <td>{p.visitas}</td>
                    <td className="whitespace-nowrap">{fmtMoney(p.gastado, cur)}</td>
                    <td>{fmtDate(p.ultima_visita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
