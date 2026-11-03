-- =====================================================================
-- Insumos y costos, números de la franquicia y datos para Klaviyo.
--
-- Modelo:
--   * La marca define el catálogo de tratamientos y los insumos, con el precio
--     al que vende cada insumo a las franquicias (unit_cost).
--   * Cada tratamiento usa un insumo principal (treatments.supply_id).
--   * El precio de venta NO está atado al tratamiento: se escribe en cada turno
--     (promociones, descuentos).
--   * Al registrar un turno, el costo de cada ítem = cantidad × unit_cost del
--     insumo en ese momento (queda congelado).
--
-- Quién ve costos y márgenes: la marca y el franquiciado. Recepción y
-- profesionales no.
-- =====================================================================

-- El precio vive en cada turno, no en el catálogo
alter table public.treatments drop column default_price;

-- ---------------------------------------------------------------------
-- 1. ¿Puede ver costos? Marca o franquiciado de esa sucursal
-- ---------------------------------------------------------------------
create or replace function public.can_see_costs(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from memberships m
      join branches b on b.organization_id = m.organization_id
     where b.id = p_branch
       and m.user_id = auth.uid()
       and (
         m.role in ('network_owner', 'network_admin')
         or (m.branch_id = p_branch and m.role = 'branch_admin')
       )
  );
$$;

create or replace function public.can_see_org_costs(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from memberships m
     where m.organization_id = p_org
       and m.user_id = auth.uid()
       and m.role in ('network_owner', 'network_admin', 'branch_admin')
  );
$$;

-- ---------------------------------------------------------------------
-- 2. Insumos (los define la marca)
-- ---------------------------------------------------------------------
create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  unit text not null default 'unidad',          -- unidad, ml, jeringa, vial, hilo, kit...
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);
create trigger supplies_updated_at before update on public.supplies
  for each row execute function public.set_updated_at();

alter table public.supplies enable row level security;

create policy supplies_select on public.supplies for select to authenticated
  using (public.is_org_member(organization_id));
create policy supplies_write on public.supplies for all to authenticated
  using (public.has_network_access(organization_id))
  with check (public.has_network_access(organization_id));

-- unit_cost no se lee directo: lo ven marca y franquiciados vía supply_list()
revoke all on public.supplies from anon, authenticated;
grant select (id, organization_id, name, unit, is_active, created_at, updated_at)
  on public.supplies to authenticated;
grant insert, update, delete on public.supplies to authenticated;
grant all on public.supplies to service_role;

alter table public.treatments add column supply_id uuid;
alter table public.treatments
  add constraint treatments_supply_fk
  foreign key (supply_id, organization_id) references public.supplies(id, organization_id);

-- Lista de insumos con su costo (solo marca y franquiciados)
create or replace function public.supply_list(p_org uuid)
returns table (id uuid, name text, unit text, unit_cost numeric, is_active boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_org_costs(p_org) then
    raise exception 'Sin acceso a los costos';
  end if;
  return query
    select s.id, s.name, s.unit, s.unit_cost, s.is_active, s.updated_at
      from supplies s
     where s.organization_id = p_org
     order by s.is_active desc, s.name;
end $$;

-- ---------------------------------------------------------------------
-- 3. Costo de cada ítem vendido (cantidad × costo del insumo, congelado)
-- ---------------------------------------------------------------------
alter table public.appointment_items add column cost numeric(12,2);

create or replace function public.fill_item_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_unit_cost numeric;
begin
  -- Al editar sin cambiar tratamiento ni cantidad, se mantiene el costo original
  if tg_op = 'UPDATE'
     and new.treatment_id is not distinct from old.treatment_id
     and new.quantity is not distinct from old.quantity then
    new.cost := old.cost;
    return new;
  end if;

  select s.unit_cost
    into v_unit_cost
    from treatments t
    join supplies s on s.id = t.supply_id
   where t.id = new.treatment_id;

  -- El costo lo calcula el sistema, nunca el usuario
  new.cost := case
    when v_unit_cost is null then null
    else round(v_unit_cost * coalesce(nullif(new.quantity, 0), 1), 2)
  end;
  return new;
end $$;

create trigger appointment_items_cost before insert or update on public.appointment_items
  for each row execute function public.fill_item_cost();

-- La columna cost no se lee directo: se ve en branch_financials
revoke select on public.appointment_items from anon, authenticated;
grant select (id, appointment_id, treatment_id, zone, quantity, price, notes, created_at)
  on public.appointment_items to authenticated;

-- ---------------------------------------------------------------------
-- 4. Números de la franquicia (costos solo para marca y franquiciado)
-- ---------------------------------------------------------------------
create or replace function public.branch_financials(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_costs boolean;
  v_result jsonb;
begin
  if not public.can_see_costs(p_branch) then
    raise exception 'Sin acceso a los números de esta sucursal';
  end if;
  v_costs := true;
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
  totals as (
    select count(*) as turnos,
           count(distinct appts.patient_id) as pacientes,
           coalesce(sum(appts.amount_paid), 0) as facturado,
           coalesce(sum(item_tot.cost), 0) as costo,
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
           coalesce(sum(item_tot.cost), 0) as costo
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
    'costo', t.costo,
    'margen', t.facturado - t.costo,
    'items_sin_costo', t.items_sin_costo,
    'por_profesional', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', bp.nombre, 'turnos', bp.turnos, 'pacientes', bp.pacientes,
        'facturado', bp.facturado, 'costo', bp.costo, 'margen', bp.facturado - bp.costo
      ) order by bp.facturado desc) from by_prof bp), '[]'::jsonb),
    'por_tratamiento', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', bt.nombre, 'cantidad', bt.cantidad, 'insumo_usado', bt.insumo_usado, 'unidad', bt.unidad,
        'facturado', bt.facturado, 'costo', bt.costo, 'margen', bt.facturado - bt.costo
      ) order by bt.facturado desc) from by_treat bt), '[]'::jsonb),
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
-- 5. Integraciones: el franquiciado conecta las suyas; la clave no se lee
-- ---------------------------------------------------------------------
revoke select on public.integrations from anon, authenticated;
grant select (id, organization_id, branch_id, type, name, config, events, is_active, created_at, updated_at)
  on public.integrations to authenticated;

alter table public.integrations
  add constraint integrations_type_check check (type in ('google_sheets', 'klaviyo'));

drop policy outbox_select on public.event_outbox;
create policy outbox_select on public.event_outbox for select to authenticated
  using (
    public.has_network_access(organization_id)
    or (branch_id is not null and public.is_branch_admin(branch_id))
  );

-- ---------------------------------------------------------------------
-- 6. Datos que salen a las integraciones (Sheets y Klaviyo)
-- ---------------------------------------------------------------------
create or replace function public.appointment_event_payload(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id_crm',           a.id,
    'fecha',            to_char(coalesce(a.completed_at, a.scheduled_at) at time zone o.timezone,
                                'YYYY-MM-DD"T"HH24:MI'),
    'fecha_iso',        coalesce(a.completed_at, a.scheduled_at),
    'sucursal',         b.name,
    'sucursal_id',      b.id,
    'paciente',         trim(p.first_name || ' ' || coalesce(p.last_name, '')),
    'paciente_id',      p.id,
    'nombre',           p.first_name,
    'apellido',         p.last_name,
    'telefono',         p.phone,
    'email',            p.email,
    'dni',              p.dni,
    'acepta_marketing', p.consent_marketing_at is not null and p.marketing_opt_out_at is null,
    'tratamiento',      (
                          select string_agg(t.name || coalesce(' - ' || ai.zone, ''), ', ' order by t.name)
                            from appointment_items ai
                            join treatments t on t.id = ai.treatment_id
                           where ai.appointment_id = a.id
                        ),
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
                                ((coalesce(a.completed_at, a.scheduled_at) at time zone o.timezone)::date
                                  + t.recall_days)
                              end
                          ) order by t.name)
                            from appointment_items ai
                            join treatments t on t.id = ai.treatment_id
                           where ai.appointment_id = a.id
                        ), '[]'::jsonb),
    'profesional',      pr.full_name,
    'monto',            a.amount_paid,
    'medio_de_pago',    a.payment_method,
    'estado',           a.status,
    'notas',            a.notes
  )
  from appointments a
  join organizations o on o.id = a.organization_id
  join branches b on b.id = a.branch_id
  join patients p on p.id = a.patient_id
  left join professionals pr on pr.id = a.professional_id
  where a.id = p_appointment_id;
$$;

revoke execute on function public.appointment_event_payload(uuid) from public, anon, authenticated;
grant execute on function public.appointment_event_payload(uuid) to service_role;
