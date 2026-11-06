import { SubmitButton } from "@/components/submit-button";
import { fmtMoney } from "@/lib/format";
import { deleteHolder } from "./actions";
import { HolderForm } from "./forms";

export type HolderStatus = {
  holder_id: string;
  name: string;
  cuit: string | null;
  annual_limit: number | null;
  alert_pct: number;
  month_total: number;
  last12_total: number;
  level: "ok" | "warn" | "over" | "none";
};

// Color según qué tan cerca está del tope: barra, porcentaje y una línea solo si hay que actuar
const TONE = {
  over: { bar: "bg-bad", text: "text-bad", note: "Llegó al tope de su categoría" },
  warn: { bar: "bg-warn", text: "text-warn", note: "Se acerca al tope de su categoría" },
  ok: { bar: "bg-ok", text: "text-ink", note: null },
  none: { bar: "bg-muted", text: "text-muted", note: null },
};

export function HolderCard({ h, monthLabel, accountNames }: { h: HolderStatus; monthLabel: string; accountNames: string[] }) {
  const tone = TONE[h.level];
  const total = Number(h.last12_total);
  const limit = h.annual_limit ? Number(h.annual_limit) : null;
  const pct = limit ? (total / limit) * 100 : null;
  const left = limit !== null ? limit - total : null;

  return (
    <li className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{h.name}</h3>
          <p className="num text-xs text-muted">{h.cuit ? `CUIT ${h.cuit}` : "Sin CUIT cargado"}</p>
        </div>
        {pct !== null && (
          <p className={`num text-right text-2xl leading-none ${tone.text}`}>
            {pct < 1 && pct > 0 ? "<1" : Math.floor(pct)}%
            <span className="block pt-1 text-xs text-muted">del tope</span>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm">
          <span className="num text-lg font-semibold">{fmtMoney(total)}</span>
          <span className="text-muted">
            {limit ? ` de ${fmtMoney(limit)} en 12 meses` : " en 12 meses · cargá el tope para recibir avisos"}
          </span>
        </p>
        {limit && (
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
          </div>
        )}
        {tone.note && <p className={`text-sm font-semibold ${tone.text}`}>{tone.note}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">{monthLabel}</dt>
          <dd className="num">{fmtMoney(h.month_total)}</dd>
        </div>
        {left !== null && (
          <div>
            <dt className="text-xs text-muted">{left >= 0 ? "Le queda" : "Se pasó por"}</dt>
            <dd className={`num ${left < 0 ? "text-bad" : ""}`}>{fmtMoney(Math.abs(left))}</dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="text-xs text-muted">Cuentas</dt>
          <dd>{accountNames.join(", ") || "Ninguna todavía: asignalas en la tabla de cuentas"}</dd>
        </div>
      </dl>

      <details className="group rounded-xl bg-subtle px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-muted">
          Editar datos, tope o aviso ({h.alert_pct}%)
        </summary>
        <div className="mt-3 space-y-3">
          <HolderForm holder={{ ...h, id: h.holder_id }} compact />
          <form action={deleteHolder}>
            <input type="hidden" name="id" value={h.holder_id} />
            <SubmitButton
              className="text-xs text-muted underline-offset-2 hover:text-bad hover:underline"
              pendingText="Quitando..."
            >
              Quitar titular
            </SubmitButton>
            <span className="text-xs text-muted"> · sus cuentas dejan de sumar; no se borra ningún cobro</span>
          </form>
        </div>
      </details>
    </li>
  );
}
