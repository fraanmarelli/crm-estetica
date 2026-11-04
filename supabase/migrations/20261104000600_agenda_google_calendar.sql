-- =====================================================================
-- Agenda: duración de cada turno, cumpleaños del día y Google Calendar.
--
-- Google Calendar funciona como la planilla: un Apps Script en la cuenta de
-- Google de la sucursal recibe cada turno y crea / actualiza / borra el evento.
-- El id del evento en Google se guarda en integration_refs para poder editarlo.
--
-- Eventos de turnos que salen por event_outbox:
--   appointment.saved      cualquier alta o cambio de un turno (calendario)
--   appointment.completed  pasó a realizado (planilla, Klaviyo)
--   appointment.updated    cambió un turno ya realizado (planilla)
--   appointment.deleted    se borró un turno (calendario)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Duración del turno
-- ---------------------------------------------------------------------
alter table public.appointments
  add column duration_minutes integer not null default 30 check (duration_minutes between 5 and 600);

grant select (duration_minutes) on public.appointments to authenticated;

-- ---------------------------------------------------------------------
-- 2. Ids externos (evento de Google Calendar de cada turno)
-- ---------------------------------------------------------------------
create table public.integration_refs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  entity_id uuid not null,
  external_id text not null,
  updated_at timestamptz not null default now(),
  primary key (integration_id, entity_id)
);

alter table public.integration_refs enable row level security;
-- Sin políticas: solo el servidor (service role) la usa
revoke all on public.integration_refs from anon, authenticated;
grant all on public.integration_refs to service_role;

alter table public.integrations drop constraint integrations_type_check;
alter table public.integrations
  add constraint integrations_type_check check (type in ('google_sheets', 'klaviyo', 'google_calendar'));

-- ---------------------------------------------------------------------
-- 3. Encolado de eventos de turnos
-- ---------------------------------------------------------------------
create or replace function public.enqueue_appointment_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_events text[] := array['appointment.saved'];
begin
  -- Los importados de la planilla no se reenvían
  if new.external_ref is not null then
    return new;
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    v_events := v_events || 'appointment.completed'::text;
  elsif tg_op = 'UPDATE' and old.status = 'completed' then
    v_events := v_events || 'appointment.updated'::text;
  end if;

  insert into event_outbox (organization_id, branch_id, integration_id, event_type, entity_id)
  select new.organization_id,
         new.branch_id,
         i.id,
         -- Si la integración escucha varios, va el más específico
         (select u.e from unnest(v_events) with ordinality as u(e, n)
           where u.e = any (i.events) order by u.n desc limit 1),
         new.id
    from integrations i
   where i.organization_id = new.organization_id
     and i.is_active
     and (i.branch_id is null or i.branch_id = new.branch_id)
     and i.events && v_events
  on conflict (integration_id, entity_id) where status = 'pending'
  do update set
    event_type = case
      when event_outbox.event_type = 'appointment.updated' and excluded.event_type = 'appointment.completed'
        then excluded.event_type
      else event_outbox.event_type
    end,
    requeued = event_outbox.requeued or event_outbox.attempts > 0;

  return new;
end $$;

-- Turno borrado: se avisa a las integraciones que tienen un evento creado para él
create or replace function public.enqueue_appointment_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into event_outbox (organization_id, branch_id, integration_id, event_type, entity_id)
  select old.organization_id, old.branch_id, r.integration_id, 'appointment.deleted', old.id
    from integration_refs r
    join integrations i on i.id = r.integration_id
   where r.entity_id = old.id
     and i.is_active
     and 'appointment.deleted' = any (i.events)
  on conflict (integration_id, entity_id) where status = 'pending'
  do update set
    event_type = 'appointment.deleted',
    requeued = event_outbox.requeued or event_outbox.attempts > 0;
  return old;
end $$;

create trigger appointments_enqueue_deleted after delete on public.appointments
  for each row execute function public.enqueue_appointment_deleted();

-- ---------------------------------------------------------------------
-- 4. El dispatcher recibe, además del turno, su horario y el id externo
-- ---------------------------------------------------------------------
create or replace function public.claim_outbox_events(p_limit integer default 25)
returns table (
  id bigint,
  event_type text,
  integration_type text,
  config jsonb,
  secret text,
  payload jsonb
)
language sql volatile security definer set search_path = public as $$
  with claimed as (
    update event_outbox e
       set attempts = e.attempts + 1,
           next_attempt_at = now() + interval '5 minutes'
     where e.id in (
       select o.id
         from event_outbox o
        where o.status = 'pending' and o.next_attempt_at <= now()
        order by o.id
        limit p_limit
        for update skip locked
     )
    returning e.id, e.event_type, e.integration_id, e.entity_id
  )
  select c.id,
         c.event_type,
         i.type,
         i.config,
         i.secret,
         case when c.event_type like 'appointment.%' then
           coalesce(public.appointment_event_payload(c.entity_id), jsonb_build_object('id_crm', c.entity_id))
           || jsonb_build_object(
                'evento', c.event_type,
                'inicio', a.scheduled_at,
                'duracion_min', a.duration_minutes,
                'external_id', r.external_id
              )
         else '{}'::jsonb end
    from claimed c
    join integrations i on i.id = c.integration_id
    left join appointments a on a.id = c.entity_id
    left join integration_refs r on r.integration_id = c.integration_id and r.entity_id = c.entity_id;
$$;

revoke execute on function public.claim_outbox_events(integer) from public, anon, authenticated;
grant execute on function public.claim_outbox_events(integer) to service_role;

-- El dispatcher guarda (o borra, con null) el id que devolvió la integración
create or replace function public.save_integration_ref(p_outbox_id bigint, p_external_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v event_outbox;
begin
  select * into v from event_outbox where id = p_outbox_id;
  if not found then
    return;
  end if;

  if p_external_id is null or p_external_id = '' then
    delete from integration_refs where integration_id = v.integration_id and entity_id = v.entity_id;
  else
    insert into integration_refs (organization_id, integration_id, entity_id, external_id)
    values (v.organization_id, v.integration_id, v.entity_id, p_external_id)
    on conflict (integration_id, entity_id) do update
      set external_id = excluded.external_id, updated_at = now();
  end if;
end $$;

revoke execute on function public.save_integration_ref(bigint, text) from public, anon, authenticated;
grant execute on function public.save_integration_ref(bigint, text) to service_role;

-- Al conectar un calendario: enviar los turnos de hoy en adelante
create or replace function public.resync_integration(p_integration uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v integrations;
  v_count integer;
begin
  select * into v from integrations where id = p_integration;
  if not found then
    raise exception 'No existe la integración';
  end if;
  if not (
    case when v.branch_id is null then public.has_network_access(v.organization_id)
         else public.is_branch_admin(v.branch_id) end
  ) then
    raise exception 'Sin permiso sobre esta integración';
  end if;

  insert into event_outbox (organization_id, branch_id, integration_id, event_type, entity_id)
  select a.organization_id, a.branch_id, v.id, 'appointment.saved', a.id
    from appointments a
    join organizations o on o.id = a.organization_id
   where a.organization_id = v.organization_id
     and (v.branch_id is null or a.branch_id = v.branch_id)
     and a.status in ('scheduled', 'completed', 'no_show')
     and (a.scheduled_at at time zone o.timezone)::date >= (now() at time zone o.timezone)::date
  on conflict (integration_id, entity_id) where status = 'pending' do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.resync_integration(uuid) from public, anon;
grant execute on function public.resync_integration(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Cumpleaños de pacientes de la sucursal en una fecha (respeta RLS)
-- ---------------------------------------------------------------------
create or replace function public.birthdays_on(p_branch uuid, p_date date)
returns table (id uuid, first_name text, last_name text, phone text, age integer)
language sql stable security invoker set search_path = public as $$
  select p.id,
         p.first_name,
         p.last_name,
         p.phone,
         date_part('year', age(p_date, p.birth_date))::integer
    from patients p
   where p.home_branch_id = p_branch
     and p.birth_date is not null
     and extract(month from p.birth_date) = extract(month from p_date)
     and extract(day from p.birth_date) = extract(day from p_date)
     and p.marketing_opt_out_at is null
   order by p.first_name
   limit 50;
$$;

grant execute on function public.birthdays_on(uuid, date) to authenticated;
