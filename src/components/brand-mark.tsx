import type { Organization } from "@/lib/types";

// Logo de la organización. "full" = logo completo (lateral), "mono" = monograma (barra del celular).
// Si la organización no cargó logo, se muestra su nombre en la tipografía de la marca.
export function BrandMark({ org, variant = "full" }: { org: Organization; variant?: "full" | "mono" }) {
  const brand = org.settings.brand ?? {};
  const src = variant === "mono" ? (brand.monogram_url ?? brand.logo_url) : brand.logo_url;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={org.name} className={variant === "mono" ? "h-8 w-auto" : "h-auto w-36"} />;
  }
  return (
    <span className={`gold-text font-display leading-none ${variant === "mono" ? "text-xl" : "text-[1.7rem]"}`}>
      {org.name}
    </span>
  );
}
