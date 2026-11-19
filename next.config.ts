import type { NextConfig } from "next";

// Encabezados de seguridad para todas las páginas:
// - nadie puede mostrar el CRM dentro de otra página (evita que engañen a alguien para que toque botones)
// - el navegador no adivina tipos de archivo
// - los links con token (/registro, /ficha, /invitacion) no se filtran a otros sitios por el «referer»
// - sin cámara, micrófono ni ubicación
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const tokenPageHeaders = [{ key: "Referrer-Policy", value: "no-referrer" }];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/registro/:path*", headers: tokenPageHeaders },
      { source: "/ficha/:path*", headers: tokenPageHeaders },
      { source: "/invitacion/:path*", headers: tokenPageHeaders },
    ];
  },
};

export default nextConfig;
