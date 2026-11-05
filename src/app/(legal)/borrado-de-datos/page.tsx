import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Borrado de datos · CRM Estética" };

export default function DataDeletionPage() {
  return (
    <>
      <header className="space-y-1">
        <h1>Cómo pedir el borrado de tus datos</h1>
        <p className="text-sm text-muted">CRM Estética · Tero Labs</p>
      </header>

      <h2>Si completaste un formulario de una clínica en Facebook o Instagram</h2>
      <ol>
        <li>
          Escribí a <a href="mailto:hola@terolabs.dev">hola@terolabs.dev</a> con el asunto «Borrar mis datos».
        </li>
        <li>Indicá el nombre de la clínica y el celular o email que pusiste en el formulario.</li>
        <li>
          En un plazo máximo de 30 días borramos tu información del CRM de esa clínica y te confirmamos por el mismo
          medio. También podés pedírselo directamente a la clínica.
        </li>
      </ol>

      <h2>Si sos una clínica y conectaste tu página o cuenta de Meta</h2>
      <ol>
        <li>
          En el CRM, entrá a <strong>Leads</strong> y tocá <strong>Desconectar</strong>: se borra en el momento el
          permiso de acceso a tu página. Lo mismo en <strong>Marketing</strong> para la cuenta publicitaria.
        </li>
        <li>
          Opcional: en Facebook, andá a <strong>Configuración y privacidad → Configuración → Integraciones
          comerciales</strong>, buscá «CRM Estética» y tocá <strong>Eliminar</strong>.
        </li>
        <li>
          Para borrar también los leads, pacientes y demás información guardada, escribí a{" "}
          <a href="mailto:hola@terolabs.dev">hola@terolabs.dev</a> desde el email de tu usuario del CRM. Lo borramos en
          un plazo máximo de 30 días.
        </li>
      </ol>

      <p className="text-sm text-muted">
        Más información en la <Link href="/privacidad">política de privacidad</Link>.
      </p>
    </>
  );
}
