-- =====================================================================
-- Antecedentes de la paciente (fijo arriba de la historia clínica): alergias,
-- medicación, condiciones y tratamientos o cirugías previas. Uno por paciente
-- (es de la organización, como la paciente). Lo ven y editan profesionales,
-- franquiciado y marca; recepción no.
-- =====================================================================

-- ¿Puede ver la historia clínica de esta paciente? Marca, o franquiciado/profesional de la red con acceso a ella.
create or replace function public.can_view_clinical_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from patients p
     where p.id = p_patient
       and public.can_access_patient(p.id)
       and (
         public.has_network_access(p.organization_id)
         or exists (
           select 1 from memberships m
            where m.user_id = auth.uid() and m.organization_id = p.organization_id
              and m.role in ('branch_admin', 'professional')
         )
       )
  );
$$;
revoke execute on function public.can_view_clinical_patient(uuid) from public, anon;
grant execute on function public.can_view_clinical_patient(uuid) to authenticated;

create table public.clinical_background (
  patient_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allergies text check (length(allergies) <= 1000),
  medications text check (length(medications) <= 1000),
  conditions text check (length(conditions) <= 1000),
  previous_treatments text check (length(previous_treatments) <= 1000),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade
);

-- Quién y cuándo lo actualizó (lo pone la base)
create or replace function public.prepare_clinical_background()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.organization_id into new.organization_id from patients p where p.id = new.patient_id;
  new.updated_by := auth.uid();
  new.updated_at := now();
  new.updated_by_name := coalesce(
    (select pr.full_name from professionals pr
      where pr.user_id = auth.uid() and pr.organization_id = new.organization_id
      order by pr.is_active desc limit 1),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Equipo'
  );
  return new;
end $$;
revoke execute on function public.prepare_clinical_background() from public, anon, authenticated;
create trigger clinical_background_prepare before insert or update on public.clinical_background
  for each row execute function public.prepare_clinical_background();

alter table public.clinical_background enable row level security;
create policy clinical_background_select on public.clinical_background for select to authenticated
  using (public.can_view_clinical_patient(patient_id));
create policy clinical_background_insert on public.clinical_background for insert to authenticated
  with check (public.can_view_clinical_patient(patient_id));
create policy clinical_background_update on public.clinical_background for update to authenticated
  using (public.can_view_clinical_patient(patient_id)) with check (public.can_view_clinical_patient(patient_id));
