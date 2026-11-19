"use client";

import { createContext, useContext } from "react";

// Pestañas de funciones que la marca apagó en esta sede (las arma el layout; las lee SectionTabs)
const HiddenTabsContext = createContext<string[]>([]);

export function HiddenTabsProvider({ hrefs, children }: { hrefs: string[]; children: React.ReactNode }) {
  return <HiddenTabsContext.Provider value={hrefs}>{children}</HiddenTabsContext.Provider>;
}

export function useHiddenTabs(): string[] {
  return useContext(HiddenTabsContext);
}
