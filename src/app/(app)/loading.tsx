// Se muestra apenas tocás un link, mientras llega la pantalla nueva
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-subtle" />
        <div className="h-4 w-32 animate-pulse rounded bg-subtle" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-subtle" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-subtle" />
    </div>
  );
}
