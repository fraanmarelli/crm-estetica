import Link from "next/link";

// Indicador: etiqueta, número grande y una línea de contexto.
// "accent" lo pinta con el color de la marca: usarlo para UN solo número por pantalla,
// el que pide acción.
export function Kpi({
  label,
  value,
  hint,
  accent = false,
  href,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  accent?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  );
  const cls = `kpi ${accent ? "kpi-accent" : ""} ${href ? "transition-colors hover:border-brand" : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
