-- =====================================================================
-- Señas: una parte del cobro marcada como seña, cargada al reservar.
-- Suma al total del turno igual que cualquier otra parte, así que al
-- registrarlo como realizado solo se cobra lo que falta.
-- =====================================================================

alter table public.appointment_payments
  add column is_deposit boolean not null default false;
