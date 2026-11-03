// Íconos de línea propios (24x24, trazo 1.75) para no sumar dependencias.
type Props = { className?: string };

function Svg({ children, className = "h-5 w-5" }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconToday = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPatients = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
    <path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
  </Svg>
);

export const IconRecall = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 1 1 17.7 6" />
    <path d="M20.5 3.5V8h-4.5" />
    <path d="M12 8v4.5l3 1.8" />
  </Svg>
);

export const IconMarketing = (p: Props) => (
  <Svg {...p}>
    <path d="M4 19V11M10 19V5M16 19v-6M22 19H2" />
  </Svg>
);

export const IconBrand = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5 14.4 9l5.6.5-4.3 3.7 1.3 5.6L12 15.9l-5 2.9 1.3-5.6L4 9.5 9.6 9z" />
  </Svg>
);

export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const IconLogout = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const IconWhatsApp = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z" />
    <path d="M9.2 9.3c.3 2.4 2.2 4.6 4.9 5.3l1.1-1.2-1.7-.9-.8.8c-1-.5-1.9-1.3-2.4-2.4l.8-.8-.8-1.7z" />
  </Svg>
);
