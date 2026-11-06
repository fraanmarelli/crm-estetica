"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// Botón de enviar de un formulario: mientras guarda muestra «Guardando...» con una ruedita y no se puede
// tocar dos veces. Con doneText, al terminar muestra «✓ ...» un momento (solo en acciones que no
// devuelven error a la pantalla).
export function SubmitButton({
  children,
  pendingText = "Guardando...",
  doneText,
  className = "btn btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  doneText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const [done, setDone] = useState(false);
  const was = useRef(false);

  useEffect(() => {
    if (was.current && !pending && doneText) {
      setDone(true);
      const t = setTimeout(() => setDone(false), 1600);
      was.current = pending;
      return () => clearTimeout(t);
    }
    was.current = pending;
  }, [pending, doneText]);

  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={className}>
      {pending ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          {pendingText}
        </>
      ) : done ? (
        <span className="toast-in">✓ {doneText}</span>
      ) : (
        children
      )}
    </button>
  );
}
