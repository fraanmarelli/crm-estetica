import Link from "next/link";

// Páginas legales públicas (política de privacidad, borrado de datos). Las pide Meta para publicar la app.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="mx-auto min-h-screen max-w-2xl pb-16 pt-10"
      style={{
        paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
      }}
    >
      <article className="legal space-y-5 text-[15px] leading-relaxed">{children}</article>
      <footer className="mt-12 flex flex-wrap gap-4 border-t border-line pt-4 text-xs text-muted">
        <span>CRM Estética · Tero Labs</span>
        <Link href="/privacidad" className="hover:text-ink">Política de privacidad</Link>
        <Link href="/borrado-de-datos" className="hover:text-ink">Borrado de datos</Link>
        <a href="https://terolabs.dev" className="hover:text-ink">terolabs.dev</a>
      </footer>
    </main>
  );
}
