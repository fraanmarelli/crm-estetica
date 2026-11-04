-- =====================================================================
-- Facturación por titular (monotributo).
-- ARCA mide los ingresos por titular (CUIT), sumando todas sus cuentas, en
-- los últimos 12 meses. Cada sucursal carga sus titulares con el tope de su
-- categoría y el % al que quiere el aviso; cada cuenta de cobro se asigna a
-- un titular. Las cuentas sin titular (efectivo, dólares en mano) no suman.
-- Lo ve solo quien administra la sucursal (franquiciado; también la marca).
-- Los cobros se cuentan en el día del turno.
-- =====================================================================

create table public.account_holders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  cuit text,
  annual_limit numeric(14,2) check (annual_limit is null or annual_limit > 0),
  alert_pct integer not null default 80 check (alert_pct between 1 and 100),
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (branch_id, name),
  unique (id, branch_id)
);

alter table public.account_holders enable row level security;
create policy account_holders_all on public.account_holders for all to authenticated
  using (public.is_branch_admin(branch_id)) with check (public.is_branch_admin(branch_id));

alter table public.payment_accounts add column holder_id uuid;
alter table public.payment_accounts
  add constraint payment_accounts_holder_fk foreign key (holder_id, branch_id)
  references public.account_holders(id, branch_id) on delete set null (holder_id);

-- Lo cobrado en cada cuenta entre dos fechas (inclusive)
create or replace function public.billing_by_account(p_branch uuid, p_from date, p_to date)
returns table (
  account_id uuid,
  account_name text,
  currency text,
  is_active boolean,
  holder_id uuid,
  holder_name text,
  total_ars numeric,
  total_usd numeric,
  payments_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca ven la facturación';
  end if;
  return query
    with pays as (
      select p.account_id, p.amount, p.exchange_rate
        from appointment_payments p
        join appointments a on a.id = p.appointment_id
        join organizations o on o.id = a.organization_id
       where p.branch_id = p_branch
         and (coalesce(a.completed_at, a.scheduled_at) at time zone o.timezone)::date between p_from and p_to
    )
    select pa.id, pa.name, pa.currency, pa.is_active, h.id, h.name,
           coalesce(sum(case when pa.currency = 'ARS' then s.amount
                             when s.exchange_rate is not null then round(s.amount * s.exchange_rate, 2)
                             else 0 end), 0)::numeric,
           coalesce(sum(case when pa.currency = 'USD' then s.amount else 0 end), 0)::numeric,
           count(s.amount)
      from payment_accounts pa
      left join account_holders h on h.id = pa.holder_id
      left join pays s on s.account_id = pa.id
     where pa.branch_id = p_branch
     group by pa.id, pa.name, pa.currency, pa.is_active, pa.sort_order, h.id, h.name
     order by pa.sort_order, pa.name;
end $$;
revoke execute on function public.billing_by_account(uuid, date, date) from public, anon;
grant execute on function public.billing_by_account(uuid, date, date) to authenticated;

-- Estado de cada titular: lo de un mes y lo de los 12 meses que terminan en ese mes
-- level: 'ok' | 'warn' (llegó al % de aviso) | 'over' (llegó o pasó el tope) | 'none' (sin tope)
create or replace function public.holder_status(p_branch uuid, p_month date default null)
returns table (
  holder_id uuid,
  name text,
  cuit text,
  annual_limit numeric,
  alert_pct integer,
  month_total numeric,
  last12_total numeric,
  level text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_month date;
  v_from12 date;
  v_to date;
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca ven la facturación';
  end if;
  select o.timezone into v_tz from branches b join organizations o on o.id = b.organization_id where b.id = p_branch;
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone v_tz)::date))::date;
  v_from12 := (v_month - interval '11 months')::date;
  v_to := (v_month + interval '1 month' - interval '1 day')::date;

  return query
    with pays as (
      select pa.holder_id,
             (coalesce(a.completed_at, a.scheduled_at) at time zone v_tz)::date as day,
             case when pa.currency = 'ARS' then p.amount
                  when p.exchange_rate is not null then round(p.amount * p.exchange_rate, 2)
                  else 0 end as ars
        from appointment_payments p
        join appointments a on a.id = p.appointment_id
        join payment_accounts pa on pa.id = p.account_id
       where p.branch_id = p_branch and pa.holder_id is not null
    ),
    sums as (
      select h.id,
             coalesce(sum(s.ars) filter (where s.day between v_month and v_to), 0)::numeric as m,
             coalesce(sum(s.ars) filter (where s.day between v_from12 and v_to), 0)::numeric as y
        from account_holders h
        left join pays s on s.holder_id = h.id
       where h.branch_id = p_branch
       group by h.id
    )
    select h.id, h.name, h.cuit, h.annual_limit, h.alert_pct, sums.m, sums.y,
           case
             when h.annual_limit is null then 'none'
             when sums.y >= h.annual_limit then 'over'
             when sums.y >= h.annual_limit * h.alert_pct / 100.0 then 'warn'
             else 'ok'
           end
      from account_holders h
      join sums on sums.id = h.id
     order by h.name;
end $$;
revoke execute on function public.holder_status(uuid, date) from public, anon;
grant execute on function public.holder_status(uuid, date) to authenticated;
