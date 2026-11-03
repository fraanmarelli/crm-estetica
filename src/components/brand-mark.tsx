import type { Organization } from "@/lib/types";

// Logo de la organización si está cargado; si no, el nombre en la tipografía de la marca.
export function BrandMark({ org, compact = false }: { org: Organization; compact?: boolean }) {
  const logo = org.settings.brand?.logo_url;
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={org.name} className={compact ? "h-7 w-auto" : "h-9 w-auto"} />;
  }
  return (
    <span className={`font-display leading-none text-brand ${compact ? "text-xl" : "text-[1.6rem]"}`}>
      {org.name}
    </span>
  );
}
