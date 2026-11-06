"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { undoLeadContacted } from "./actions";

// Aviso «Le escribiste a X · Deshacer» abajo de la pantalla. Vive por encima de las listas para que no
// desaparezca cuando el lead pasa de «Sin contactar» a «Escritos».
type Undo = { id: string; name: string };
const UndoContext = createContext<(u: Undo) => void>(() => {});

export const useLeadUndo = () => useContext(UndoContext);

const VISIBLE_MS = 10_000;

export function LeadUndoProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Undo | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((u: Undo) => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(u);
    timer.current = setTimeout(() => setCurrent(null), VISIBLE_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <UndoContext.Provider value={show}>
      {children}
      {current && (
        <div
          role="status"
          className="fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + var(--undo-offset, 84px))" }}
        >
          <div className="toast-in flex items-center gap-4 rounded-full bg-chrome px-5 py-2.5 text-sm text-chrome-ink shadow-lg">
            <span>Le escribiste a {current.name}</span>
            <button
              type="button"
              disabled={pending}
              className="font-semibold underline underline-offset-2"
              onClick={() =>
                start(async () => {
                  await undoLeadContacted(current.id);
                  setCurrent(null);
                })
              }
            >
              {pending ? "Deshaciendo..." : "Deshacer"}
            </button>
          </div>
        </div>
      )}
    </UndoContext.Provider>
  );
}
