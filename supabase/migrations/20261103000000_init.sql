-- =====================================================================
-- CRM Estética — esquema inicial v1
-- Multi-tenant: organización (red) -> sucursales -> usuarios con roles.
-- Toda tabla tiene RLS. Las automatizaciones salen por event_outbox.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role as enum (
  'network_owner',   -- dueño de la red (ve y administra todo)
  'network_admin',   -- administración central de la red
  'branch_admin',    -- franquiciado / encargado de sucursal
  'reception',       -- recepción
  'professional'     -- médico/a
);

create type public.appointment_status as enum ('scheduled', 'completed', 'no_show', 'cancelled');

create type public.recall_outcome as enum (
  'no_answer', 'booked', 'later', 'not_interested', 'wrong_number', 'opted_out'
);

create type public.outbox_status as enum ('pending', 'sent', 'failed');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Organizaciones (cada red/cliente del CRM)
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  currency text not null default 'ARS',
  loyalty_points_per_1000 numeric(10,2) not null default 0,  -- millas por cada 1.000 de moneda
  settings jsonb not null default '{}'::jsonb,               -- módulos activos, textos, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Sucursales
-- ---------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  whatsapp text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfiles y membresías
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique nulls not distinct (user_id, organization_id, branch_id),
  check (
    (role in ('network_owner', 'network_admin') and branch_id is null)
    or (role not in ('network_owner', 'network_admin') and branch_id is not null)
  )
);
create index memberships_user_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------
-- Helpers de permisos (security definer: evitan recursión de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.organization_id = p_org
  );
$$;

create or replace function public.has_network_access(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.organization_id = p_org
      and m.role in ('network_owner', 'network_admin')
  );
$$;

create or replace function public.can_access_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join branches b on b.organization_id = m.organization_id
    where b.id = p_branch
      and m.user_id = auth.uid()
      and (m.branch_id = p_branch or m.role in ('network_owner', 'network_admin'))
  );
$$;

create or replace function public.is_branch_admin(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join branches b on b.organization_id = m.organization_id
    where b.id = p_branch
      and m.user_id = auth.uid()
      and (
        (m.branch_id = p_branch and m.role = 'branch_admin')
        or m.role in ('network_owner', 'network_admin')
      )
  );
$$;

create or replace function public.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships me
    join memberships other on other.organization_id = me.organization_id
    where me.user_id = auth.uid() and other.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------------
-- Profesionales
-- ---------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,                                   -- null = atiende en varias sucursales
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  license_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id)
);
create trigger professionals_updated_at before update on public.professionals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Catálogo de tratamientos (recall_days = cada cuántos días se repite)
-- ---------------------------------------------------------------------
create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text,
  recall_days integer check (recall_days is null or recall_days > 0),
  default_price numeric(12,2),
  unit_label text,                                  -- unidades, ml, sesión, hilos...
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger treatments_updated_at before update on public.treatments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Pacientes (pertenecen a la red; home_branch = sucursal de origen)
-- ---------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  home_branch_id uuid,
  first_name text not null,
  last_name text,
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),   -- E.164 sin "+", ej 5491155551234
  email text,
  dni text,
  birth_date date,
  source text,                                      -- instagram, referido, google, paso por la puerta...
  notes text,
  consent_data_at timestamptz,                      -- consentimiento Ley 25.326
  consent_marketing_at timestamptz,                 -- acepta comunicaciones
  marketing_opt_out_at timestamptz,                 -- pidió no ser contactado
  external_ref text,                                -- id de origen en importaciones
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (home_branch_id, organization_id) references public.branches(id, organization_id)
);
-- Normaliza teléfonos argentinos al formato de WhatsApp: 549 + característica + número
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then
    return null;
  end if;
  if d like '00%' then
    d := substr(d, 3);
  elsif d like '0%' then
    d := substr(d, 2);
  end if;
  -- Formato local con "15" (ej. 11 15 5555-1234): se quita el 15
  if length(d) = 12 and d not like '54%' then
    for a in 2..4 loop
      if substr(d, a + 1, 2) = '15' then
        d := substr(d, 1, a) || substr(d, a + 3);
        exit;
      end if;
    end loop;
  end if;
  if length(d) = 10 then
    d := '549' || d;
  elsif d like '54%' and d not like '549%' and length(d) = 12 then
    d := '549' || substr(d, 3);
  end if;
  return d;
end $$;

create or replace function public.patients_normalize()
returns trigger language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.dni := nullif(regexp_replace(coalesce(new.dni, ''), '\D', '', 'g'), '');
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  return new;
end $$;

create trigger patients_normalize before insert or update on public.patients
  for each row execute function public.patients_normalize();

create index patients_org_phone_idx on public.patients (organization_id, phone);
create index patients_org_dni_idx on public.patients (organization_id, dni);
create index patients_name_trgm_idx on public.patients
  using gin (lower(first_name || ' ' || coalesce(last_name, '')) extensions.gin_trgm_ops);
create unique index patients_external_ref_uq on public.patients (organization_id, external_ref)
  where external_ref is not null;
create trigger patients_updated_at before update on public.patients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  professional_id uuid,
  scheduled_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  completed_at timestamptz,
  amount_paid numeric(12,2),
  payment_method text,
  notes text,
  external_ref text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (professional_id, organization_id)
    references public.professionals(id, organization_id),
  check (status <> 'completed' or completed_at is not null)
);
create index appointments_branch_date_idx on public.appointments (branch_id, scheduled_at);
create index appointments_patient_idx on public.appointments (patient_id);
create index appointments_status_completed_idx on public.appointments (status, completed_at);
create unique index appointments_external_ref_uq on public.appointments (organization_id, external_ref)
  where external_ref is not null;

create or replace function public.appointments_before_write()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger appointments_before_write before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

-- Ítems del turno (un turno puede tener varios tratamientos)
create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  treatment_id uuid not null references public.treatments(id),
  zone text,
  quantity numeric(10,2),
  price numeric(12,2),
  notes text,
  created_at timestamptz not null default now()
);
create index appointment_items_appointment_idx on public.appointment_items (appointment_id);
create index appointment_items_treatment_idx on public.appointment_items (treatment_id);

create or replace function public.check_item_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1
    from appointments a
    join treatments t on t.organization_id = a.organization_id
    where a.id = new.appointment_id and t.id = new.treatment_id
  ) then
    raise exception 'El tratamiento no pertenece a la misma organización que el turno';
  end if;
  return new;
end $$;

create trigger appointment_items_tenant before insert or update on public.appointment_items
  for each row execute function public.check_item_tenant();

-- Cambiar ítems "toca" el turno para que dispare eventos de actualización
create or replace function public.touch_parent_appointment()
returns trigger language plpgsql as $$
begin
  update public.appointments
     set updated_at = now()
   where id = coalesce(new.appointment_id, old.appointment_id);
  return null;
end $$;

create trigger appointment_items_touch after insert or update or delete on public.appointment_items
  for each row execute function public.touch_parent_appointment();

-- ---------------------------------------------------------------------
-- Recall: registro de contactos
-- ---------------------------------------------------------------------
create table public.recall_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  treatment_id uuid references public.treatments(id),
  channel text not null default 'whatsapp_manual',
  outcome public.recall_outcome not null,
  notes text,
  resulting_appointment_id uuid references public.appointments(id) on delete set null,
  contacted_by uuid default auth.uid() references auth.users(id) on delete set null,
  contacted_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade
);
create index recall_contacts_patient_idx on public.recall_contacts (patient_id, treatment_id, contacted_at desc);

create or replace function public.recall_contact_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outcome = 'opted_out' then
    update patients
       set marketing_opt_out_at = coalesce(marketing_opt_out_at, now())
     where id = new.patient_id;
  end if;
  return null;
end $$;

create trigger recall_contacts_after_insert after insert on public.recall_contacts
  for each row execute function public.recall_contact_after_insert();

-- ---------------------------------------------------------------------
-- Beauty Millas (libro mayor: nunca se edita, se corrige con otro movimiento)
-- ---------------------------------------------------------------------
create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  branch_id uuid not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  points integer not null check (points <> 0),      -- positivo suma, negativo canje
  reason text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade
);
create index loyalty_patient_idx on public.loyalty_transactions (patient_id);

-- ---------------------------------------------------------------------
-- Integraciones y outbox de eventos (base de todas las automatizaciones)
-- ---------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,                                    -- null = aplica a toda la red
  type text not null,                                -- 'google_sheets' (más tipos en el futuro)
  name text not null,
  config jsonb not null default '{}'::jsonb,         -- google_sheets: {"url": "https://script.google.com/..."}
  secret text,                                       -- token que valida el receptor
  events text[] not null default array['appointment.completed', 'appointment.updated'],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

create table public.event_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  event_type text not null,
  entity_id uuid not null,
  status public.outbox_status not null default 'pending',
  requeued boolean not null default false,           -- hubo cambios mientras se enviaba
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index event_outbox_pending_uq on public.event_outbox (integration_id, entity_id)
  where status = 'pending';
create index event_outbox_due_idx on public.event_outbox (next_attempt_at)
  where status = 'pending';

-- Encola eventos de turnos. Los importados (external_ref) no se sincronizan:
-- ya están en la planilla.
create or replace function public.enqueue_appointment_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event text;
begin
  if new.external_ref is not null then
    return new;
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    v_event := 'appointment.completed';
  elsif tg_op = 'UPDATE' and old.status = 'completed' then
    v_event := 'appointment.updated';
  else
    return new;
  end if;

  insert into event_outbox (organization_id, branch_id, integration_id, event_type, entity_id)
  select new.organization_id, new.branch_id, i.id, v_event, new.id
    from integrations i
   where i.organization_id = new.organization_id
     and i.is_active
     and (i.branch_id is null or i.branch_id = new.branch_id)
     and v_event = any (i.events)
  on conflict (integration_id, entity_id) where status = 'pending'
  do update set requeued = event_outbox.requeued or event_outbox.attempts > 0;

  return new;
end $$;

create trigger appointments_enqueue_events after insert or update on public.appointments
  for each row execute function public.enqueue_appointment_events();

-- Payload plano para Google Sheets (las claves coinciden con los encabezados)
create or replace function public.appointment_event_payload(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id_crm',        a.id,
    'fecha',         to_char(coalesce(a.completed_at, a.scheduled_at) at time zone o.timezone,
                             'YYYY-MM-DD"T"HH24:MI'),
    'sucursal',      b.name,
    'paciente',      trim(p.first_name || ' ' || coalesce(p.last_name, '')),
    'telefono',      p.phone,
    'email',         p.email,
    'dni',           p.dni,
    'tratamiento',   (
                       select string_agg(t.name || coalesce(' - ' || ai.zone, ''), ', ' order by t.name)
                         from appointment_items ai
                         join treatments t on t.id = ai.treatment_id
                        where ai.appointment_id = a.id
                     ),
    'profesional',   pr.full_name,
    'monto',         a.amount_paid,
    'medio_de_pago', a.payment_method,
    'estado',        a.status,
    'notas',         a.notes
  )
  from appointments a
  join organizations o on o.id = a.organization_id
  join branches b on b.id = a.branch_id
  join patients p on p.id = a.patient_id
  left join professionals pr on pr.id = a.professional_id
  where a.id = p_appointment_id;
$$;

-- El dispatcher toma eventos pendientes (lease de 5 min) con el payload ya armado
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
         case when c.event_type like 'appointment.%'
              then public.appointment_event_payload(c.entity_id)
              else '{}'::jsonb end
    from claimed c
    join integrations i on i.id = c.integration_id;
$$;

-- El dispatcher informa el resultado de cada envío
create or replace function public.finish_outbox_event(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update event_outbox
       set status = case when requeued then 'pending'::outbox_status else 'sent'::outbox_status end,
           sent_at = case when requeued then null else now() end,
           next_attempt_at = now(),
           attempts = 0,
           requeued = false,
           last_error = null
     where id = p_id;
  else
    update event_outbox
       set status = case when attempts >= 10 then 'failed'::outbox_status else 'pending'::outbox_status end,
           next_attempt_at = now() + make_interval(mins => least(attempts * attempts, 360)),
           last_error = left(coalesce(p_error, 'error desconocido'), 1000)
     where id = p_id;
  end if;
end $$;

-- Funciones internas: solo el service role (Edge Function) puede llamarlas
revoke execute on function public.appointment_event_payload(uuid) from public, anon, authenticated;
revoke execute on function public.claim_outbox_events(integer) from public, anon, authenticated;
revoke execute on function public.finish_outbox_event(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.appointment_event_payload(uuid) to service_role;
grant execute on function public.claim_outbox_events(integer) to service_role;
grant execute on function public.finish_outbox_event(bigint, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- Búsqueda de pacientes en toda la red (para no duplicar)
-- Devuelve datos mínimos aunque el paciente sea de otra sucursal.
-- ---------------------------------------------------------------------
create or replace function public.find_patients(p_org uuid, p_phone text default null, p_dni text default null)
returns table (id uuid, display_name text, home_branch text)
language sql stable security definer set search_path = public as $$
  select p.id,
         p.first_name || ' ' || left(coalesce(p.last_name, ''), 1) || '.',
         b.name
    from patients p
    left join branches b on b.id = p.home_branch_id
   where p.organization_id = p_org
     and public.is_org_member(p_org)
     and (
       (p_phone is not null and p.phone = public.normalize_phone(p_phone))
       or (p_dni is not null and p.dni = regexp_replace(p_dni, '\D', '', 'g'))
     )
   limit 5;
$$;

-- Nombre corto de un paciente de la red (para agendarle un turno en otra sucursal)
create or replace function public.patient_brief(p_patient uuid)
returns table (id uuid, display_name text, organization_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id,
         p.first_name || ' ' || coalesce(p.last_name, ''),
         p.organization_id
    from patients p
   where p.id = p_patient
     and public.is_org_member(p.organization_id);
$$;

-- Alta de accesos: se corre desde el SQL Editor de Supabase (no desde la app)
create or replace function public.grant_membership(
  p_email text,
  p_org_slug text,
  p_role public.member_role,
  p_branch_name text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_org uuid;
  v_branch uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No existe el usuario %. Crealo primero en Authentication > Users.', p_email;
  end if;

  select id into v_org from organizations where slug = p_org_slug;
  if v_org is null then
    raise exception 'No existe la organización %', p_org_slug;
  end if;

  if p_branch_name is not null then
    select id into v_branch from branches where organization_id = v_org and name = p_branch_name;
    if v_branch is null then
      raise exception 'No existe la sucursal % en %', p_branch_name, p_org_slug;
    end if;
  end if;

  insert into memberships (user_id, organization_id, branch_id, role)
  values (v_user, v_org, v_branch, p_role)
  on conflict (user_id, organization_id, branch_id) do update set role = excluded.role;

  return format('OK: %s es %s en %s%s', p_email, p_role, p_org_slug,
                coalesce(' / ' || p_branch_name, ''));
end $$;

revoke execute on function public.grant_membership(text, text, public.member_role, text)
  from public, anon, authenticated;

-- Millas automáticas al completar un turno pagado
create or replace function public.award_loyalty_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric;
  v_points integer;
begin
  if new.status <> 'completed' or coalesce(new.amount_paid, 0) <= 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
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

create trigger appointments_award_loyalty after insert or update on public.appointments
  for each row execute function public.award_loyalty_points();

-- Usado por políticas de tablas que referencian pacientes ya existentes
create or replace function public.can_access_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from patients p
     where p.id = p_patient
       and (
         public.has_network_access(p.organization_id)
         or (p.home_branch_id is not null and public.can_access_branch(p.home_branch_id))
         or exists (
           select 1 from appointments a
            where a.patient_id = p.id and public.can_access_branch(a.branch_id)
         )
       )
  );
$$;

-- ---------------------------------------------------------------------
-- Vistas (security_invoker: respetan RLS del usuario)
-- ---------------------------------------------------------------------
create view public.recall_queue with (security_invoker = true) as
with last_done as (
  select distinct on (a.patient_id, ai.treatment_id)
         a.organization_id,
         a.patient_id,
         ai.treatment_id,
         a.branch_id   as last_branch_id,
         a.id          as last_appointment_id,
         a.completed_at as last_done_at
    from public.appointments a
    join public.appointment_items ai on ai.appointment_id = a.id
   where a.status = 'completed'
   order by a.patient_id, ai.treatment_id, a.completed_at desc
)
select
  ld.organization_id,
  ld.last_branch_id as branch_id,
  ld.patient_id,
  ld.treatment_id,
  ld.last_appointment_id,
  ld.last_done_at,
  (ld.last_done_at at time zone o.timezone)::date + t.recall_days as due_date,
  t.name as treatment_name,
  t.recall_days,
  p.first_name,
  p.last_name,
  p.phone,
  p.consent_marketing_at,
  lc.contacted_at as last_contacted_at,
  lc.outcome      as last_outcome
from last_done ld
join public.organizations o on o.id = ld.organization_id
join public.treatments t on t.id = ld.treatment_id and t.recall_days is not null and t.is_active
join public.patients p on p.id = ld.patient_id
left join lateral (
  select rc.contacted_at, rc.outcome
    from public.recall_contacts rc
   where rc.patient_id = ld.patient_id
     and rc.treatment_id = ld.treatment_id
     and rc.contacted_at >= ld.last_done_at
   order by rc.contacted_at desc
   limit 1
) lc on true
where p.marketing_opt_out_at is null
  and p.phone is not null
  and not exists (
    select 1
      from public.appointments a2
      join public.appointment_items ai2 on ai2.appointment_id = a2.id
     where a2.patient_id = ld.patient_id
       and ai2.treatment_id = ld.treatment_id
       and a2.status = 'scheduled'
       and a2.scheduled_at >= now()
  );

create view public.patient_loyalty_balance with (security_invoker = true) as
select organization_id, patient_id, sum(points)::integer as balance
  from public.loyalty_transactions
 group by organization_id, patient_id;

create view public.branch_monthly_stats with (security_invoker = true) as
select
  a.organization_id,
  a.branch_id,
  date_trunc('month', coalesce(a.completed_at, a.scheduled_at) at time zone o.timezone)::date as month,
  count(*) filter (where a.status = 'completed')                    as completed,
  count(*) filter (where a.status = 'no_show')                      as no_shows,
  count(*) filter (where a.status = 'cancelled')                    as cancelled,
  coalesce(sum(a.amount_paid) filter (where a.status = 'completed'), 0) as revenue,
  count(distinct a.patient_id) filter (where a.status = 'completed') as unique_patients
from public.appointments a
join public.organizations o on o.id = a.organization_id
group by a.organization_id, a.branch_id, 3;

create view public.recall_due_by_branch with (security_invoker = true) as
select organization_id, branch_id, count(*)::integer as due_count
  from public.recall_queue
 where due_date <= current_date
 group by organization_id, branch_id;

grant select on public.recall_queue, public.patient_loyalty_balance, public.branch_monthly_stats,
  public.recall_due_by_branch to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.branches             enable row level security;
alter table public.profiles             enable row level security;
alter table public.memberships          enable row level security;
alter table public.professionals        enable row level security;
alter table public.treatments           enable row level security;
alter table public.patients             enable row level security;
alter table public.appointments         enable row level security;
alter table public.appointment_items    enable row level security;
alter table public.recall_contacts      enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.integrations         enable row level security;
alter table public.event_outbox         enable row level security;

-- Organizaciones
create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_network_access(id)) with check (public.has_network_access(id));

-- Sucursales
create policy branches_select on public.branches for select to authenticated
  using (public.is_org_member(organization_id));
create policy branches_write on public.branches for all to authenticated
  using (public.has_network_access(organization_id))
  with check (public.has_network_access(organization_id));

-- Perfiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Membresías (altas/bajas solo desde el servidor con service role)
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_network_access(organization_id)
    or (branch_id is not null and public.is_branch_admin(branch_id))
  );

-- Profesionales
create policy professionals_select on public.professionals for select to authenticated
  using (public.is_org_member(organization_id));
create policy professionals_write on public.professionals for all to authenticated
  using (
    public.has_network_access(organization_id)
    or (branch_id is not null and public.is_branch_admin(branch_id))
  )
  with check (
    public.has_network_access(organization_id)
    or (branch_id is not null and public.is_branch_admin(branch_id))
  );

-- Tratamientos (catálogo de la red)
create policy treatments_select on public.treatments for select to authenticated
  using (public.is_org_member(organization_id));
create policy treatments_write on public.treatments for all to authenticated
  using (public.has_network_access(organization_id))
  with check (public.has_network_access(organization_id));

-- Pacientes
create policy patients_select on public.patients for select to authenticated
  using (
    public.has_network_access(organization_id)
    or public.can_access_branch(home_branch_id)
    or exists (
      select 1 from public.appointments a
       where a.patient_id = patients.id and public.can_access_branch(a.branch_id)
    )
  );
create policy patients_insert on public.patients for insert to authenticated
  with check (
    public.has_network_access(organization_id)
    or public.can_access_branch(home_branch_id)
  );
create policy patients_update on public.patients for update to authenticated
  using (
    public.has_network_access(organization_id)
    or public.can_access_branch(home_branch_id)
    or exists (
      select 1 from public.appointments a
       where a.patient_id = patients.id and public.can_access_branch(a.branch_id)
    )
  )
  with check (public.is_org_member(organization_id));
create policy patients_delete on public.patients for delete to authenticated
  using (public.has_network_access(organization_id));

-- Turnos
create policy appointments_select on public.appointments for select to authenticated
  using (public.can_access_branch(branch_id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.can_access_branch(branch_id));
create policy appointments_update on public.appointments for update to authenticated
  using (public.can_access_branch(branch_id))
  with check (public.can_access_branch(branch_id));
create policy appointments_delete on public.appointments for delete to authenticated
  using (public.is_branch_admin(branch_id));

-- Ítems de turno
create policy appointment_items_all on public.appointment_items for all to authenticated
  using (exists (
    select 1 from public.appointments a
     where a.id = appointment_id and public.can_access_branch(a.branch_id)
  ))
  with check (exists (
    select 1 from public.appointments a
     where a.id = appointment_id and public.can_access_branch(a.branch_id)
  ));

-- Recall
create policy recall_select on public.recall_contacts for select to authenticated
  using (public.can_access_branch(branch_id));
create policy recall_insert on public.recall_contacts for insert to authenticated
  with check (public.can_access_branch(branch_id));
create policy recall_modify on public.recall_contacts for update to authenticated
  using (public.is_branch_admin(branch_id)) with check (public.is_branch_admin(branch_id));
create policy recall_delete on public.recall_contacts for delete to authenticated
  using (public.is_branch_admin(branch_id));

-- Millas
create policy loyalty_select on public.loyalty_transactions for select to authenticated
  using (public.can_access_patient(patient_id));
create policy loyalty_insert on public.loyalty_transactions for insert to authenticated
  with check (public.can_access_branch(branch_id) and public.can_access_patient(patient_id));
create policy loyalty_delete on public.loyalty_transactions for delete to authenticated
  using (public.has_network_access(organization_id));

-- Integraciones
create policy integrations_all on public.integrations for all to authenticated
  using (
    case when branch_id is null then public.has_network_access(organization_id)
         else public.is_branch_admin(branch_id) end
  )
  with check (
    case when branch_id is null then public.has_network_access(organization_id)
         else public.is_branch_admin(branch_id) end
  );

-- Outbox (solo lectura para la red, para ver errores de sincronización)
create policy outbox_select on public.event_outbox for select to authenticated
  using (public.has_network_access(organization_id));
