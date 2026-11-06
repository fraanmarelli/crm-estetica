// Se vuelve a montar en cada cambio de pantalla: el contenido aparece con un fundido corto (docs/ESTILO.md)
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
