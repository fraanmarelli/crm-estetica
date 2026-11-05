-- =====================================================================
-- Leads de los anuncios con formulario de Meta (formularios instantáneos).
-- Cada sucursal conecta su página de Facebook; Meta avisa por webhook cada
-- formulario nuevo y el servidor lo guarda acá. Un lead NO es paciente: recién
-- cuando saca turno se crea la paciente (o se vincula, si el celular ya existía).
-- =====================================================================

-- Página de Facebook conectada por sucursal (sus formularios generan leads)
create table public.lead_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  page_id text not null unique,
  page_name text,
  connected_by uuid references auth.users(id) on delete set null,
  last_lead_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);
alter table public.lead_pages enable row level security;
create policy lead_pages_select on public.lead_pages for select to authenticated
  using (public.can_access_branch(branch_id));
create policy lead_pages_delete on public.lead_pages for delete to authenticated
  using (public.is_branch_admin(branch_id));

-- Token de la página: sin políticas => solo service role
create table public.lead_page_secrets (
  lead_page_id uuid primary key references public.lead_pages(id) on delete cascade,
  page_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.lead_page_secrets enable row level security;
revoke all on public.lead_page_secrets from anon, authenticated;

-- Conexiones a medio terminar (entre el login de Facebook y elegir la página)
create table public.lead_oauth_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  pages jsonb not null default '[]'::jsonb,   -- [{id, name, access_token}]
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);
alter table public.lead_oauth_pending enable row level security;
revoke all on public.lead_oauth_pending from anon, authenticated;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  source text not null default 'meta_form',
  external_id text not null,                  -- leadgen_id de Meta
  created_at timestamptz not null default now(),  -- cuándo completó el formulario
  full_name text,
  phone text,
  email text,
  answers jsonb not null default '[]'::jsonb, -- [{pregunta, respuesta}] del formulario
  form_id text,
  form_name text,
  ad_id text,
  ad_name text,
  campaign_id text,
  campaign_name text,
  platform text,                              -- fb / ig
  -- new: sin contactar · contacted: se le escribió · booked: sacó turno · lost: no le interesa / no responde
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'lost')),
  patient_id uuid references public.patients(id) on delete set null,
  contacted_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (organization_id, external_id)
);
create index leads_branch_idx on public.leads (branch_id, status, created_at desc);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- Celular normalizado (549...) y, si ya es paciente, queda vinculado
create or replace function public.prepare_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null then
    new.phone := public.normalize_phone(new.phone);
  end if;
  if new.patient_id is null and new.phone is not null then
    select p.id into new.patient_id
      from patients p
     where p.organization_id = new.organization_id and p.phone = new.phone
     limit 1;
  end if;
  return new;
end $$;
revoke execute on function public.prepare_lead() from public, anon, authenticated;
create trigger leads_prepare before insert or update of phone on public.leads
  for each row execute function public.prepare_lead();

alter table public.leads enable row level security;
-- Recepción trabaja los leads de su sucursal (los crea el servidor desde Meta)
create policy leads_select on public.leads for select to authenticated
  using (public.can_access_branch(branch_id));
create policy leads_update on public.leads for update to authenticated
  using (public.can_access_branch(branch_id)) with check (public.can_access_branch(branch_id));
