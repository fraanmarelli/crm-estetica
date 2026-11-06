-- =====================================================================
-- Historia clínica: nota de cada sesión atendida (qué se hizo, observaciones,
-- próximo paso). La ven y escriben las profesionales de la sucursal, el
-- franquiciado y la marca. Recepción NO (datos de salud).
-- Trazabilidad de lotes: a qué pacientes se les aplicó un lote (ANMAT).
-- =====================================================================

-- ¿Puede ver la historia clínica de esta sucursal? Profesional de la sucursal, franquiciado o marca.
create or replace function public.can_view_clinical(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_branch_admin(p_branch)
      or exists (
        select 1 from memberships m
         where m.user_id = auth.uid() and m.branch_id = p_branch and m.role = 'professional'
      );
$$;
revoke execute on function public.can_view_clinical(uuid) from public, anon;
grant execute on function public.can_view_clinical(uuid) to authenticated;

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade
);
create index clinical_notes_patient_idx on public.clinical_notes (patient_id, created_at desc);
create trigger clinical_notes_updated_at before update on public.clinical_notes
  for each row execute function public.set_updated_at();

-- La nota es del turno: sucursal, paciente y organización salen del turno (no se confía en lo que manda la app)
create or replace function public.prepare_clinical_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a appointments%rowtype;
begin
  select * into a from appointments where id = new.appointment_id;
  if a.id is null then
    raise exception 'El turno no existe';
  end if;
  new.organization_id := a.organization_id;
  new.branch_id := a.branch_id;
  new.patient_id := a.patient_id;
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke execute on function public.prepare_clinical_note() from public, anon, authenticated;
create trigger clinical_notes_prepare before insert or update on public.clinical_notes
  for each row execute function public.prepare_clinical_note();

alter table public.clinical_notes enable row level security;
create policy clinical_notes_select on public.clinical_notes for select to authenticated
  using (public.can_view_clinical(branch_id));
create policy clinical_notes_insert on public.clinical_notes for insert to authenticated
  with check (public.can_view_clinical(branch_id));
create policy clinical_notes_update on public.clinical_notes for update to authenticated
  using (public.can_view_clinical(branch_id)) with check (public.can_view_clinical(branch_id));
create policy clinical_notes_delete on public.clinical_notes for delete to authenticated
  using (public.is_branch_admin(branch_id));

-- Trazabilidad: a quién se le aplicó un lote (p_branch null = toda la red, solo la marca)
create or replace function public.lot_trace(p_org uuid, p_branch uuid, p_lot text)
returns table (
  appointment_id uuid,
  scheduled_at timestamptz,
  branch_name text,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  treatment text,
  professional_name text,
  lot_code text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_branch is null and not public.has_network_access(p_org) then
    raise exception 'Solo la marca busca en toda la red';
  end if;
  if p_branch is not null and not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca buscan lotes';
  end if;
  if length(trim(coalesce(p_lot, ''))) < 2 then
    return;
  end if;
  return query
    select a.id, a.scheduled_at, b.name,
           p.id, trim(p.first_name || ' ' || coalesce(p.last_name, '')), p.phone,
           t.name, pr.full_name, ai.lot_code
      from appointment_items ai
      join appointments a on a.id = ai.appointment_id
      join branches b on b.id = a.branch_id
      join patients p on p.id = a.patient_id
      join treatments t on t.id = ai.treatment_id
      left join professionals pr on pr.id = a.professional_id
     where a.organization_id = p_org
       and (p_branch is null or a.branch_id = p_branch)
       and a.status = 'completed'
       and ai.lot_code ilike '%' || trim(p_lot) || '%'
     order by a.scheduled_at desc
     limit 500;
end $$;
revoke execute on function public.lot_trace(uuid, uuid, text) from public, anon;
grant execute on function public.lot_trace(uuid, uuid, text) to authenticated;
