// «Próximamente»: una función planeada (ver docs/MAPA.md, 🆕) que se muestra en gris en el lugar donde va
// a vivir. Solo aparece cuando la marca prende «Mostrar lo que viene»; el equipo nunca la ve.
// No se puede tocar ni enfocar: es una muestra, no un botón deshabilitado.

export function SoonBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-subtle px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
      Próximamente
    </span>
  );
}

// Tarjeta o sección entera que todavía no existe
export function SoonCard({
  title,
  description,
  className = "",
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      aria-disabled="true"
      className={`pointer-events-none select-none rounded-2xl border border-dashed border-line bg-surface/60 p-4 opacity-70 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-muted">{title}</p>
        <SoonBadge />
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  );
}

// Botón o acción que todavía no existe (se ve como un botón apagado con la etiqueta)
export function SoonButton({ label }: { label: string }) {
  return (
    <span
      aria-disabled="true"
      className="pointer-events-none inline-flex select-none items-center gap-2 rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm font-semibold text-muted opacity-70"
    >
      {label}
      <SoonBadge />
    </span>
  );
}
