import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Política de privacidad · CRM Estética" };

const UPDATED = "5 de noviembre de 2026";

export default function PrivacyPage() {
  return (
    <>
      <header className="space-y-1">
        <h1>Política de privacidad</h1>
        <p className="text-sm text-muted">CRM Estética · Última actualización: {UPDATED}</p>
      </header>

      <p>
        CRM Estética es un sistema de gestión para clínicas de estética (pacientes, turnos, cobros y marketing),
        desarrollado y operado por <strong>Tero Labs</strong>, emprendimiento de Franco Giuliano Marelli (Córdoba,
        Argentina, <a href="https://terolabs.dev">terolabs.dev</a>).
        Esta política explica qué datos trata el CRM, para qué y cómo pedir que se borren.
      </p>

      <h2>Quién decide sobre los datos</h2>
      <p>
        Cada clínica que usa el CRM es responsable de los datos de sus pacientes y de sus clientes potenciales, en los
        términos de la Ley 25.326 de Protección de los Datos Personales. Tero Labs los trata por cuenta de la clínica,
        solo para prestarle el servicio, y no los usa para fines propios.
      </p>

      <h2>Qué datos se tratan</h2>
      <ul>
        <li>
          <strong>Usuarios del CRM</strong> (equipo de la clínica): email, rol y sucursal.
        </li>
        <li>
          <strong>Pacientes</strong>: los que la clínica carga o la paciente completa en su ficha (nombre, contacto,
          documento, fecha de nacimiento, consentimientos, turnos, tratamientos y cobros).
        </li>
        <li>
          <strong>Clientes potenciales de Facebook e Instagram</strong>: cuando la clínica conecta su página, el CRM
          recibe las respuestas de sus formularios de anuncios (nombre, celular, email, respuestas del formulario) y el
          anuncio y la campaña de origen.
        </li>
        <li>
          <strong>Métricas de anuncios</strong>: gasto y resultados por campaña y día de la cuenta publicitaria que la
          clínica conecta.
        </li>
        <li>
          <strong>Mercado Pago</strong>: si la clínica conecta su cuenta (solo lectura), el CRM consulta las
          transferencias recibidas para confirmar que un cobro llegó.
        </li>
      </ul>

      <h2>Para qué se usan</h2>
      <p>
        Solo para mostrarle a la clínica su propia información dentro del CRM: contactar a los clientes potenciales,
        agendar turnos, confirmar cobros y medir sus anuncios. Los datos no se venden, no se ceden a terceros y no se
        usan para publicidad de Tero Labs ni de otras empresas. Cada clínica ve únicamente lo suyo.
      </p>

      <h2>Datos de Meta (Facebook e Instagram)</h2>
      <p>
        El CRM pide a Meta solo los permisos necesarios para leer los formularios de clientes potenciales y las
        métricas de anuncios de las páginas y cuentas que la clínica elige. Los permisos de acceso (tokens) se guardan
        en el servidor y nunca se muestran en el navegador. La clínica puede desconectar su página en cualquier momento
        desde la sección Leads del CRM, o quitar la app desde la configuración de su cuenta de Facebook.
      </p>

      <h2>Dónde se guardan y cuánto tiempo</h2>
      <p>
        Los datos se guardan en servidores de proveedores de infraestructura (Supabase y Vercel), con acceso
        restringido por usuario y sucursal. Se conservan mientras la clínica use el servicio o hasta que pida
        borrarlos. Al desconectar una página o una cuenta, se borran de inmediato sus permisos de acceso.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés pedir acceso, corrección o borrado de tus datos a la clínica con la que tuviste contacto, o escribiendo a{" "}
        <a href="mailto:hola@terolabs.dev">hola@terolabs.dev</a>. Ver también <Link href="/borrado-de-datos">cómo pedir el
        borrado de tus datos</Link>. La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326,
        atiende las denuncias por incumplimiento de las normas de protección de datos personales.
      </p>

      <h2>Contacto</h2>
      <p>
        Tero Labs (Franco Giuliano Marelli) · <a href="mailto:hola@terolabs.dev">hola@terolabs.dev</a>
      </p>
    </>
  );
}
