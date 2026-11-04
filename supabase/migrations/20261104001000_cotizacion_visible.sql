-- =====================================================================
-- El medio de pago del turno muestra la cotización usada en las partes en
-- dólares, por transparencia administrativa. Ejemplo:
--   "Efectivo + Dolar (US$ 250 a $1450)"
--   "Seña MP CHARI + Dolar (US$ 100 sin cotización)"
-- Se ve en el historial de la paciente y en la columna "Medio de pago" de la planilla.
-- =====================================================================

create or replace function public.fmt_amount(p numeric)
returns text language sql immutable as $$
  select case when p = trunc(p) then trunc(p)::text else rtrim(rtrim(p::text, '0'), '.') end;
$$;

create or replace function public.sync_appointment_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_appt uuid := coalesce(new.appointment_id, old.appointment_id);
begin
  update appointments a
     set amount_paid = s.ars,
         amount_usd = s.usd,
         payment_method = s.methods
    from (
      select coalesce(sum(case when pa.currency = 'ARS' then p.amount
                               when p.exchange_rate is not null then round(p.amount * p.exchange_rate, 2)
                               else 0 end), 0) as ars,
             nullif(sum(case when pa.currency = 'USD' then p.amount else 0 end), 0) as usd,
             string_agg(
               (case when p.is_deposit then 'Seña ' else '' end) ||
               case
                 when pa.currency = 'USD' and p.exchange_rate is not null then
                   pa.name || ' (US$ ' || public.fmt_amount(p.amount) || ' a $' || public.fmt_amount(p.exchange_rate) || ')'
                 when pa.currency = 'USD' then
                   pa.name || ' (US$ ' || public.fmt_amount(p.amount) || ' sin cotización)'
                 else pa.name
               end,
               ' + ' order by p.is_deposit desc, pa.sort_order, p.created_at
             ) as methods
        from appointment_payments p
        join payment_accounts pa on pa.id = p.account_id
       where p.appointment_id = v_appt
    ) s
   where a.id = v_appt;
  return null;
end $$;
