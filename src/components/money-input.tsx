"use client";

import { useState } from "react";
import { groupThousands } from "@/lib/format";

// Campo de monto con punto de miles mientras se escribe (para formularios sin estado propio)
export function MoneyInput({
  defaultValue = "",
  className = "input num",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> & { defaultValue?: string }) {
  const [value, setValue] = useState(groupThousands(defaultValue));
  return (
    <input
      {...props}
      value={value}
      onChange={(e) => setValue(groupThousands(e.target.value))}
      inputMode="decimal"
      className={className}
    />
  );
}
