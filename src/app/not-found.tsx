import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card space-y-3 text-center">
        <h1>No encontrado</h1>
        <p className="text-sm text-muted">No existe o no tenés acceso.</p>
        <Link href="/" className="btn">Volver</Link>
      </div>
    </main>
  );
}
