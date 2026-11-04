-- =====================================================================
-- Ficha de ingreso: la paciente carga sus datos desde un link de un solo uso
-- (celular de la clínica o el suyo con QR). Recepción genera el link.
-- La carga pública la hace el servidor (service role) después de validar el
-- token; nadie sin sesión puede leer ni escribir pacientes.
-- =====================================================================

create table public.patient_intakes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  token text not null unique,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '60 minutes',
  used_at timestamptz,
  patient_id uuid references public.patients(id) on delete set null,
  already_existed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);
create index patient_intakes_branch_idx on public.patient_intakes (branch_id, created_at desc);

alter table public.patient_intakes enable row level security;

create policy patient_intakes_select on public.patient_intakes for select to authenticated
  using (public.can_access_branch(branch_id));
create policy patient_intakes_insert on public.patient_intakes for insert to authenticated
  with check (public.can_access_branch(branch_id));
create policy patient_intakes_delete on public.patient_intakes for delete to authenticated
  using (public.can_access_branch(branch_id));

revoke all on public.patient_intakes from anon;
grant all on public.patient_intakes to service_role;
