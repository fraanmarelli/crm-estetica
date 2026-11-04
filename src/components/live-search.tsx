"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Buscador que filtra mientras se escribe (actualiza ?q= en la URL, sin botón)
export function LiveSearch({
  placeholder,
  label = "Buscar",
  autoFocus = true,
}: {
  placeholder: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function update(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      if (next.trim()) p.set("q", next.trim());
      else p.delete("q");
      const qs = p.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    }, 250);
  }

  return (
    <div className="relative">
      <label htmlFor="live-search" className="sr-only">{label}</label>
      <input
        id="live-search"
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        className="input py-2.5 pr-10 text-base"
      />
      {pending && (
        <span
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-brand border-t-transparent"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
