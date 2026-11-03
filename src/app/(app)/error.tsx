"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-md space-y-3">
      <h1>Algo falló</h1>
      <p className="text-sm text-muted">{error.message || "Error inesperado."}</p>
      <button className="btn" onClick={reset}>Reintentar</button>
    </div>
  );
}
