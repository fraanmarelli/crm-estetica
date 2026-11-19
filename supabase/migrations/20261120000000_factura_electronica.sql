-- =====================================================================
-- Factura electrónica de ARCA (Factura C y Nota de Crédito C, monotributo).
-- Nada automático: se factura desde el turno atendido («Facturar») o suelta (Números → Facturación).
-- Cada titular (account_holders) factura con su CUIT y su propio certificado:
--   · arca_connections: los datos públicos de la conexión (los ve el equipo que factura).
--   · arca_secrets: clave privada, certificado y acceso de ARCA. Solo el servidor (service role).
--   · invoices: lo emitido. Lo escribe solo el servidor, después de verificar permisos y pedir el CAE.
-- Facturan marca, franquiciado y recepción (can_operate_branch); configuran marca y franquiciado.
-- =====================================================================

create table public.arca_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  holder_id uuid not null,
  environment text not null default 'test' check (environment in ('test', 'prod')),
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  business_name text not null check (length(trim(business_name)) > 0),
  address text not null check (length(trim(address)) > 0),
  iibb text,
  activity_start date,
  point_of_sale integer not null check (point_of_sale between 1 and 99998),
  -- needs_cert: falta subir el certificado · ready: probado y andando · error: la última prueba falló
  status text not null default 'needs_cert' check (status in ('needs_cert', 'ready', 'error')),
  cert_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (holder_id, branch_id) references public.account_holders(id, branch_id) on delete cascade,
  unique (holder_id),
  unique (id, branch_id)
);

alter table public.arca_connections enable row level security;
create policy arca_connections_select on public.arca_connections
  for select to authenticated using (public.can_operate_branch(branch_id));
grant select on public.arca_connections to authenticated;

create table public.arca_secrets (
  connection_id uuid primary key references public.arca_connections(id) on delete cascade,
  private_key text not null,
  csr text not null,
  certificate text,
  token text,
  sign text,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.arca_secrets enable row level security;
revoke all on public.arca_secrets from anon, authenticated;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  holder_id uuid not null,
  connection_id uuid references public.arca_connections(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  environment text not null check (environment in ('test', 'prod')),
  cuit text not null,
  cbte_tipo smallint not null check (cbte_tipo in (11, 13)),
  point_of_sale integer not null,
  number bigint,
  -- pending: se está pidiendo el CAE · issued: emitida · failed: ARCA la rechazó (no existe en ARCA)
  status text not null default 'pending' check (status in ('pending', 'issued', 'failed')),
  issue_date date not null,
  concept smallint not null check (concept in (1, 2, 3)),
  service_from date,
  service_to date,
  doc_type smallint not null,
  doc_number text,
  iva_condition smallint not null,
  receiver_name text,
  total numeric(14,2) not null check (total > 0),
  lines jsonb not null default '[]'::jsonb,
  issuer jsonb not null default '{}'::jsonb,
  cae text,
  cae_due date,
  cancels_invoice_id uuid references public.invoices(id) on delete set null,
  error text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (holder_id, branch_id) references public.account_holders(id, branch_id) on delete cascade
);

create unique index invoices_number_key on public.invoices (environment, cuit, point_of_sale, cbte_tipo, number)
  where number is not null and status <> 'failed';
-- Una factura solo se anula una vez
create unique index invoices_cancels_key on public.invoices (cancels_invoice_id)
  where cancels_invoice_id is not null and status <> 'failed';
create index invoices_branch_date_idx on public.invoices (branch_id, issue_date desc);
create index invoices_appointment_idx on public.invoices (appointment_id) where appointment_id is not null;

alter table public.invoices enable row level security;
create policy invoices_select on public.invoices
  for select to authenticated using (public.can_operate_branch(branch_id));
grant select on public.invoices to authenticated;

-- Lo facturado por titular en un período (Números → Facturación). Las notas de crédito restan.
create or replace function public.invoiced_by_holder(p_branch uuid, p_from date, p_to date)
returns table (holder_id uuid, invoices_count bigint, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca ven la facturación';
  end if;
  return query
    select i.holder_id,
           count(*) filter (where i.cbte_tipo = 11),
           coalesce(sum(case when i.cbte_tipo = 13 then -i.total else i.total end), 0)
      from invoices i
     where i.branch_id = p_branch and i.status = 'issued' and i.environment = 'prod'
       and i.issue_date between p_from and p_to
     group by i.holder_id;
end $$;
revoke execute on function public.invoiced_by_holder(uuid, date, date) from public, anon;
grant execute on function public.invoiced_by_holder(uuid, date, date) to authenticated;
