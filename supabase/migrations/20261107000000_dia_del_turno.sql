-- =====================================================================
-- Un turno cuenta en el día del turno, en todas las pantallas de números.
-- Antes Ventas, Facturación, el mail semanal y Sucursales usaban el día en que se marcó
-- «atendido» (completed_at) y Comisiones el día del turno: un turno del 31 registrado el 1
-- caía en meses distintos según la pantalla. Ahora todas usan el día del turno
-- (scheduled_at en la hora de la organización), como dice la regla de facturación.
-- Lo prueba supabase/tests/plata.test.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.branch_financials(p_branch uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and a.scheduled_at >= (p_from::timestamp at time zone v_tz)
       and a.scheduled_at < ((p_to + 1)::timestamp at time zone v_tz)
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
    select patient_id, min(scheduled_at) as first_at
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
           max(a.scheduled_at) as ultima_visita
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
end $function$

;

CREATE OR REPLACE FUNCTION public.holder_status(p_branch uuid, p_month date DEFAULT NULL::date)
 RETURNS TABLE(holder_id uuid, name text, cuit text, annual_limit numeric, alert_pct integer, month_total numeric, last12_total numeric, level text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             (a.scheduled_at at time zone v_tz)::date as day,
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
end $function$

;

CREATE OR REPLACE FUNCTION public.billing_by_account(p_branch uuid, p_from date, p_to date)
 RETURNS TABLE(account_id uuid, account_name text, currency text, is_active boolean, holder_id uuid, holder_name text, total_ars numeric, total_usd numeric, payments_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         and (a.scheduled_at at time zone o.timezone)::date between p_from and p_to
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
end $function$

;

CREATE OR REPLACE FUNCTION public.weekly_report(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_today date;
  v_to date;
  v_from date;
  v_prev_to date;
  v_prev_from date;
  v_result jsonb;
begin
  select timezone into v_tz from organizations where id = p_org;
  v_today := (now() at time zone v_tz)::date;
  v_to := v_today - extract(isodow from v_today)::integer;   -- último domingo
  v_from := v_to - 6;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - 6;

  with b as (
    select id, name from branches where organization_id = p_org and is_active
  ),
  appt as (
    select a.branch_id,
           count(*) filter (where (a.scheduled_at at time zone v_tz)::date between v_from and v_to) as done,
           coalesce(sum(a.amount_paid) filter (where (a.scheduled_at at time zone v_tz)::date between v_from and v_to), 0) as revenue,
           count(*) filter (where (a.scheduled_at at time zone v_tz)::date between v_prev_from and v_prev_to) as done_prev,
           coalesce(sum(a.amount_paid) filter (where (a.scheduled_at at time zone v_tz)::date between v_prev_from and v_prev_to), 0) as revenue_prev,
           max(a.created_at) as last_loaded
      from appointments a
     where a.organization_id = p_org and a.status = 'completed'
     group by a.branch_id
  ),
  cur as (select * from marketing_summary(p_org, v_from, v_to)),
  prev as (select * from marketing_summary(p_org, v_prev_from, v_prev_to)),
  due as (
    select branch_id, count(*) as due_count
      from recall_queue
     where organization_id = p_org and due_date <= v_to
     group by branch_id
  ),
  contacts as (
    select branch_id,
           count(*) as contacted,
           count(*) filter (where outcome = 'booked') as booked
      from recall_contacts
     where organization_id = p_org
       and (contacted_at at time zone v_tz)::date between v_from and v_to
     group by branch_id
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'branches', coalesce(jsonb_agg(jsonb_build_object(
      'branch_id', b.id,
      'branch', b.name,
      'done', coalesce(appt.done, 0),
      'done_prev', coalesce(appt.done_prev, 0),
      'revenue', coalesce(appt.revenue, 0),
      'revenue_prev', coalesce(appt.revenue_prev, 0),
      'new_patients', coalesce(cur.new_patients, 0),
      'new_patients_prev', coalesce(prev.new_patients, 0),
      'new_social', coalesce(cur.new_patients_social, 0),
      'spend', coalesce(cur.spend, 0),
      'spend_prev', coalesce(prev.spend, 0),
      'messages', coalesce(cur.messages, 0) + coalesce(cur.leads, 0),
      'recall_due', coalesce(due.due_count, 0),
      'recall_contacted', coalesce(contacts.contacted, 0),
      'recall_booked', coalesce(contacts.booked, 0),
      'has_ads', exists (select 1 from ad_connections c where c.branch_id = b.id and c.is_active),
      'last_loaded', appt.last_loaded
    ) order by coalesce(appt.revenue, 0) desc), '[]'::jsonb)
  )
  into v_result
  from b
  left join appt on appt.branch_id = b.id
  left join cur on cur.branch_id = b.id
  left join prev on prev.branch_id = b.id
  left join due on due.branch_id = b.id
  left join contacts on contacts.branch_id = b.id;

  return v_result;
end $function$

;

create or replace view public.branch_monthly_stats with (security_invoker = true) as
select a.organization_id,
       a.branch_id,
       date_trunc('month', a.scheduled_at at time zone o.timezone)::date as month,
       count(*) filter (where a.status = 'completed') as completed,
       count(*) filter (where a.status = 'no_show') as no_shows,
       count(*) filter (where a.status = 'cancelled') as cancelled,
       coalesce(sum(a.amount_paid) filter (where a.status = 'completed'), 0) as revenue,
       count(distinct a.patient_id) filter (where a.status = 'completed') as unique_patients
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
 group by a.organization_id, a.branch_id, date_trunc('month', a.scheduled_at at time zone o.timezone)::date;
