"use client";

import { useState } from "react";

export type TabItem = { key: string; label: string; count?: number; content: React.ReactNode };

// Pestañas dentro de una pantalla (no cambian la dirección). La primera arranca abierta.
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.key);
  const current = items.find((t) => t.key === active) ?? items[0];
  if (!current) return null;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {items.map((t) => {
          const on = t.key === current.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`tab-${t.key}`}
              onClick={() => setActive(t.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                on ? "bg-ink text-surface" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {typeof t.count === "number" && t.count > 0 && (
                <span className={`num ml-1.5 font-normal ${on ? "opacity-70" : ""}`}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`tab-${current.key}`}>
        {current.content}
      </div>
    </div>
  );
}
