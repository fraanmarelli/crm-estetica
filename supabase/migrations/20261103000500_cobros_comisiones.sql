-- =====================================================================
-- Cobros divididos en varias cuentas, comisión médica e ingreso neto.
--
--   * Cada sucursal tiene sus cuentas de cobro (Efectivo, MP, GetNet, transferencias,
--     Dólar...). Un turno se cobra en una o varias partes (appointment_payments).
--   * appointments.amount_paid = suma en pesos de las partes (las de dólares suman
--     solo si se cargó la cotización). appointments.amount_usd = dólares recibidos.
--   * Comisión médica: % por profesional (lo carga el franquiciado), o un monto
--     escrito a mano para un turno puntual. Recepción no ve comisiones.
--   * Ingreso neto = facturado - insumos - comisión.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Domicilio de la paciente
-- ---------------------------------------------------------------------
alter table public.patients add column address text;

-- ---------------------------------------------------------------------
-- 2. Cuentas de cobro por sucursal
-- ---------------------------------------------------------------------
create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (branch_id, name),
  unique (id, branch_id)
);

alter table public.payment_accounts enable row level security;
create policy payment_accounts_select on public.payment_accounts for select to authenticated
  using (public.can_access_branch(branch_id));
create policy payment_accounts_write on public.payment_accounts for all to authenticated
  using (public.is_branch_admin(branch_id)) with check (public.is_branch_admin(branch_id));

-- ---------------------------------------------------------------------
-- 3. Partes de cobro de cada turno
-- ---------------------------------------------------------------------
alter table public.appointments
  add column amount_usd numeric(12,2),
  add column commission numeric(12,2),
  add column commission_manual boolean not null default false;

-- appointments necesita la FK compuesta con su sucursal para los cobros
alter table public.appointments add constraint appointments_id_branch_key unique (id, branch_id);

create table public.appointment_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  appointment_id uuid not null,
  account_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),     -- en la moneda de la cuenta
  exchange_rate numeric(12,2) check (exchange_rate is null or exchange_rate > 0), -- solo cuentas en USD
  created_at timestamptz not null default now(),
  foreign key (appointment_id, branch_id)
    references public.appointments(id, branch_id) on delete cascade,
  foreign key (account_id, branch_id)
    references public.payment_accounts(id, branch_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id)
);
create index appointment_payments_appt_idx on public.appointment_payments (appointment_id);

alter table public.appointment_payments enable row level security;
create policy appointment_payments_all on public.appointment_payments for all to authenticated
  using (public.can_access_branch(branch_id)) with check (public.can_access_branch(branch_id));

-- Recalcula el total del turno a partir de sus partes
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
             string_agg(distinct pa.name, ' + ') as methods
        from appointment_payments p
        join payment_accounts pa on pa.id = p.account_id
       where p.appointment_id = v_appt
    ) s
   where a.id = v_appt;
  return null;
end $$;

create trigger appointment_payments_totals after insert or update or delete on public.appointment_payments
  for each row execute function public.sync_appointment_totals();

-- ---------------------------------------------------------------------
-- 4. Comisión médica
-- ---------------------------------------------------------------------
alter table public.professionals
  add column commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100);

-- Recepción no ve el porcentaje de comisión
revoke select on public.professionals from anon, authenticated;
grant select (id, organization_id, branch_id, user_id, full_name, license_number, is_active, created_at, updated_at)
  on public.professionals to authenticated;

-- Ni la comisión de cada turno
revoke select on public.appointments from anon, authenticated;
grant select (id, organization_id, branch_id, patient_id, professional_id, scheduled_at, status, completed_at,
              amount_paid, amount_usd, payment_method, notes, external_ref, created_by, created_at, updated_at)
  on public.appointments to authenticated;

-- Comisión automática (% del profesional sobre lo cobrado), salvo que se haya cargado a mano
create or replace function public.compute_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pct numeric;
begin
  -- El usuario no puede escribir la comisión directo: solo vía set_commission()
  if current_setting('crm.allow_commission', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.commission := null;
      new.commission_manual := false;
    else
      new.commission := old.commission;
      new.commission_manual := old.commission_manual;
    end if;
  end if;

  if new.commission_manual then
    return new;
  end if;

  if new.status = 'completed' and new.professional_id is not null then
    select commission_pct into v_pct from professionals where id = new.professional_id;
    new.commission := round(coalesce(new.amount_paid, 0) * coalesce(v_pct, 0) / 100, 2);
  else
    new.commission := null;
  end if;
  return new;
end $$;

create trigger appointments_commission before insert or update on public.appointments
  for each row execute function public.compute_commission();

-- Carga manual (o vuelta al automático con p_amount = null). Solo marca y franquiciado.
create or replace function public.set_commission(p_appointment uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from appointments where id = p_appointment;
  if v_branch is null or not public.can_see_costs(v_branch) then
    raise exception 'Solo la marca o el franquiciado pueden cargar comisiones';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'La comisión no puede ser negativa';
  end if;

  perform set_config('crm.allow_commission', 'on', true);
  update appointments
     set commission = p_amount,
         commission_manual = p_amount is not null
   where id = p_appointment;
  perform set_config('crm.allow_commission', 'off', true);
end $$;

-- Lectura de comisiones y % (solo marca y franquiciado)
create or replace function public.professional_list(p_branch uuid)
returns table (id uuid, full_name text, branch_id uuid, is_active boolean, commission_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_costs(p_branch) then
    raise exception 'Sin acceso';
  end if;
  return query
    select pr.id, pr.full_name, pr.branch_id, pr.is_active, pr.commission_pct
      from professionals pr
      join branches b on b.organization_id = pr.organization_id
     where b.id = p_branch
       and (pr.branch_id is null or pr.branch_id = p_branch)
     order by pr.is_active desc, pr.full_name;
end $$;

create or replace function public.appointment_commission(p_appointment uuid)
returns table (commission numeric, commission_manual boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_branch uuid;
begin
  select a.branch_id into v_branch from appointments a where a.id = p_appointment;
  if v_branch is null or not public.can_see_costs(v_branch) then
    raise exception 'Sin acceso';
  end if;
  return query select a.commission, a.commission_manual from appointments a where a.id = p_appointment;
end $$;

-- ---------------------------------------------------------------------
-- 5. Millas: se otorgan cuando el turno queda realizado y con monto cobrado,
--    aunque los cobros se carguen después de marcarlo como realizado.
-- ---------------------------------------------------------------------
create or replace function public.award_loyalty_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric;
  v_points integer;
begin
  if new.status <> 'completed' or coalesce(new.amount_paid, 0) <= 0 then
    return null;
  end if;
  if exists (select 1 from loyalty_transactions where appointment_id = new.id and points > 0) then
    return null;
  end if;

  select loyalty_points_per_1000 into v_rate from organizations where id = new.organization_id;
  v_points := floor(new.amount_paid / 1000 * coalesce(v_rate, 0));

  if v_points > 0 then
    insert into loyalty_transactions
      (organization_id, patient_id, branch_id, appointment_id, points, reason, created_by)
    values
      (new.organization_id, new.patient_id, new.branch_id, new.id, v_points,
       'Turno completado', new.created_by);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 6. Números: comisión, ingreso neto, dólares y liquidación por profesional
-- ---------------------------------------------------------------------
create or replace function public.branch_financials(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_result jsonb;
begin
  if not public.can_see_costs(p_branch) then
    raise exception 'Sin acceso a los números de esta sucursal';
  end if;
  select o.timezone into v_tz from branches b join organizations o on o.id = b.organization_id where b.id = p_branch;

  with appts as (
    select a.*
      from appointments a
     where a.branch_id = p_branch
       and a.status = 'completed'
       and (a.completed_at at time zone v_tz)::date between p_from and p_to
  ),
  item_tot as (
    select ai.appointment_id,
           sum(ai.cost) as cost,
           count(*) filter (where ai.cost is null) as sin_costo
      from appointment_items ai
      join appts on appts.id = ai.appointment_id
     group by ai.appointment_id
  ),
  first_visit as (
    select patient_id, min(completed_at) as first_at
      from appointments
     where branch_id = p_branch and status = 'completed'
     group by patient_id
  ),
  usd_sin_cotizar as (
    select coalesce(sum(p.amount), 0) as usd
      from appointment_payments p
      join payment_accounts pa on pa.id = p.account_id
      join appts on appts.id = p.appointment_id
     where pa.currency = 'USD' and p.exchange_rate is null
  ),
  totals as (
    select count(*) as turnos,
           count(distinct appts.patient_id) as pacientes,
           coalesce(sum(appts.amount_paid), 0) as facturado,
           coalesce(sum(appts.amount_usd), 0) as dolares,
           coalesce(sum(item_tot.cost), 0) as costo,
           coalesce(sum(appts.commission), 0) as comision,
           coalesce(sum(item_tot.sin_costo), 0) as items_sin_costo,
           count(distinct appts.patient_id) filter (
             where (fv.first_at at time zone v_tz)::date between p_from and p_to
           ) as nuevas
      from appts
      left join item_tot on item_tot.appointment_id = appts.id
      left join first_visit fv on fv.patient_id = appts.patient_id
  ),
  by_prof as (
    select coalesce(pr.full_name, 'Sin profesional') as nombre,
           count(*) as turnos,
           count(distinct appts.patient_id) as pacientes,
           coalesce(sum(appts.amount_paid), 0) as facturado,
           coalesce(sum(item_tot.cost), 0) as costo,
           coalesce(sum(appts.commission), 0) as comision
      from appts
      left join professionals pr on pr.id = appts.professional_id
      left join item_tot on item_tot.appointment_id = appts.id
     group by 1
  ),
  by_treat as (
    select t.name as nombre,
           count(*) as cantidad,
           coalesce(sum(ai.quantity), 0) as insumo_usado,
           max(s.unit) as unidad,
           coalesce(sum(ai.price), 0) as facturado,
           coalesce(sum(ai.cost), 0) as costo
      from appointment_items ai
      join appts on appts.id = ai.appointment_id
      join treatments t on t.id = ai.treatment_id
      left join supplies s on s.id = t.supply_id
     group by t.name
  ),
  by_account as (
    select pa.name as cuenta,
           pa.currency as moneda,
           count(*) as cobros,
           coalesce(sum(p.amount), 0) as monto
      from appointment_payments p
      join payment_accounts pa on pa.id = p.account_id
      join appts on appts.id = p.appointment_id
     group by pa.name, pa.currency
  ),
  top_patients as (
    select p.id,
           trim(p.first_name || ' ' || coalesce(p.last_name, '')) as nombre,
           count(*) as visitas,
           coalesce(sum(a.amount_paid), 0) as gastado,
           max(a.completed_at) as ultima_visita
      from appointments a
      join patients p on p.id = a.patient_id
     where a.branch_id = p_branch and a.status = 'completed'
     group by p.id, p.first_name, p.last_name
     order by gastado desc
     limit 10
  )
  select jsonb_build_object(
    'turnos', t.turnos,
    'pacientes', t.pacientes,
    'nuevas', t.nuevas,
    'facturado', t.facturado,
    'dolares', t.dolares,
    'dolares_sin_cotizar', (select usd from usd_sin_cotizar),
    'costo', t.costo,
    'comision', t.comision,
    'ingreso_neto', t.facturado - t.costo - t.comision,
    'margen', t.facturado - t.costo - t.comision,
    'items_sin_costo', t.items_sin_costo,
    'por_profesional', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', bp.nombre, 'turnos', bp.turnos, 'pacientes', bp.pacientes,
        'facturado', bp.facturado, 'costo', bp.costo, 'comision', bp.comision,
        'margen', bp.facturado - bp.costo - bp.comision
      ) order by bp.facturado desc) from by_prof bp), '[]'::jsonb),
    'por_tratamiento', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', bt.nombre, 'cantidad', bt.cantidad, 'insumo_usado', bt.insumo_usado, 'unidad', bt.unidad,
        'facturado', bt.facturado, 'costo', bt.costo, 'margen', bt.facturado - bt.costo
      ) order by bt.facturado desc) from by_treat bt), '[]'::jsonb),
    'por_cuenta', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cuenta', ba.cuenta, 'moneda', ba.moneda, 'cobros', ba.cobros, 'monto', ba.monto
      ) order by ba.moneda, ba.monto desc) from by_account ba), '[]'::jsonb),
    'mejores_pacientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id, 'nombre', tp.nombre, 'visitas', tp.visitas, 'gastado', tp.gastado,
        'ultima_visita', tp.ultima_visita
      ) order by tp.gastado desc) from top_patients tp), '[]'::jsonb)
  )
  into v_result
  from totals t;

  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- 7. Lo que sale a la planilla: además de los campos generales, una clave por
--    cada columna de la planilla de Córdoba (el script ignora mayúsculas, tildes,
--    espacios y símbolos) y una clave por cada cuenta de cobro con su monto.
-- ---------------------------------------------------------------------
create or replace function public.appointment_event_payload(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select a.*, o.timezone, b.name as branch_name,
           p.first_name, p.last_name, p.phone, p.email, p.dni, p.address,
           p.consent_marketing_at, p.marketing_opt_out_at,
           pr.full_name as professional_name,
           (select sum(ai.cost) from appointment_items ai where ai.appointment_id = a.id) as items_cost,
           (select string_agg(t.name || coalesce(' - ' || ai.zone, ''), ', ' order by t.name)
              from appointment_items ai join treatments t on t.id = ai.treatment_id
             where ai.appointment_id = a.id) as treatments_text
      from appointments a
      join organizations o on o.id = a.organization_id
      join branches b on b.id = a.branch_id
      join patients p on p.id = a.patient_id
      left join professionals pr on pr.id = a.professional_id
     where a.id = p_appointment_id
  )
  select jsonb_build_object(
    'id_crm',           base.id,
    'fecha',            to_char(coalesce(base.completed_at, base.scheduled_at) at time zone base.timezone,
                                'YYYY-MM-DD'),
    'fecha_iso',        coalesce(base.completed_at, base.scheduled_at),
    'sucursal',         base.branch_name,
    'sucursal_id',      base.branch_id,
    'paciente',         trim(base.first_name || ' ' || coalesce(base.last_name, '')),
    'paciente_id',      base.patient_id,
    'nombre',           base.first_name,
    'apellido',         base.last_name,
    'telefono',         base.phone,
    'email',            base.email,
    'dni',              base.dni,
    'acepta_marketing', base.consent_marketing_at is not null and base.marketing_opt_out_at is null,
    'tratamiento',      base.treatments_text,
    'items',            coalesce((
                          select jsonb_agg(jsonb_build_object(
                            'tratamiento_id', t.id,
                            'tratamiento', t.name,
                            'categoria', t.category,
                            'zona', ai.zone,
                            'cantidad', ai.quantity,
                            'precio', ai.price,
                            'dias_recall', t.recall_days,
                            'proximo_vencimiento',
                              case when t.recall_days is not null then
                                ((coalesce(base.completed_at, base.scheduled_at) at time zone base.timezone)::date
                                  + t.recall_days)
                              end
                          ) order by t.name)
                            from appointment_items ai
                            join treatments t on t.id = ai.treatment_id
                           where ai.appointment_id = base.id
                        ), '[]'::jsonb),
    'profesional',      base.professional_name,
    'monto',            base.amount_paid,
    'medio_de_pago',    base.payment_method,
    'estado',           base.status,
    'notas',            base.notes,
    -- Columnas de la planilla de Córdoba
    'Nombres',                   base.first_name,
    'Apellidos',                 base.last_name,
    'DNI (CUIL/CUIT)',           base.dni,
    'Tratamiento/s realizado/s', base.treatments_text,
    'Medico/a',                  base.professional_name,
    'Comentario',                base.notes,
    'celular',                   base.phone,
    'mail',                      base.email,
    'Domicilio',                 base.address,
    'Total',                     base.amount_paid,
    'Comision medica',           base.commission,
    'Insumo',                    base.items_cost,
    'Ingreso Neto',              coalesce(base.amount_paid, 0) - coalesce(base.items_cost, 0)
                                   - coalesce(base.commission, 0)
  )
  || coalesce((
       select jsonb_object_agg(pa.name, s.amount)
         from (
           select p.account_id, sum(p.amount) as amount
             from appointment_payments p
            where p.appointment_id = base.id
            group by p.account_id
         ) s
         join payment_accounts pa on pa.id = s.account_id
     ), '{}'::jsonb)
  from base;
$$;

revoke execute on function public.appointment_event_payload(uuid) from public, anon, authenticated;
grant execute on function public.appointment_event_payload(uuid) to service_role;

-- Funciones internas de comisiones: sin acceso anónimo
revoke execute on function public.set_commission(uuid, numeric) from public, anon;
revoke execute on function public.professional_list(uuid) from public, anon;
revoke execute on function public.appointment_commission(uuid) from public, anon;
grant execute on function public.set_commission(uuid, numeric) to authenticated;
grant execute on function public.professional_list(uuid) to authenticated;
grant execute on function public.appointment_commission(uuid) to authenticated;
