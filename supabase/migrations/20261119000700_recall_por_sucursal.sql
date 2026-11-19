-- =====================================================================
-- Recall por sucursal (Ajustes → General → «Recall»): cada cuántos días le toca volver a la paciente
-- según el tratamiento, y el texto del WhatsApp. Lo cambian el franquiciado y la marca (is_branch_admin);
-- recepción y profesionales no.
--   · El catálogo de la marca (treatments.recall_days) es lo que vale si la sucursal no cambió nada.
--   · branch_recall_days guarda solo lo que la sucursal cambió. recall_days null = ese tratamiento no
--     tiene recall en la sucursal.
--   · branches.recall_message: el mensaje de la sucursal (vacío = el de la red o el de siempre).
-- =====================================================================

create table public.branch_recall_days (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  treatment_id uuid not null references public.treatments(id) on delete cascade,
  recall_days integer check (recall_days is null or recall_days between 1 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (branch_id, treatment_id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade
);

alter table public.branch_recall_days enable row level security;

-- Lo lee todo el equipo de la sucursal (la lista de Recall lo usa); lo escribe franquiciado o marca
create policy branch_recall_days_select on public.branch_recall_days
  for select to authenticated using (public.can_access_branch(branch_id));
create policy branch_recall_days_write on public.branch_recall_days
  for all to authenticated
  using (public.is_branch_admin(branch_id))
  with check (public.is_branch_admin(branch_id));

grant select, insert, update, delete on public.branch_recall_days to authenticated;

alter table public.branches add column if not exists recall_message text;

-- Guardar todo junto: mensaje + días (todo o nada)
-- p_days: [{ treatment_id, days }]  days = número de días, o null = sin recall en esta sucursal
create or replace function public.save_recall_settings(p_branch uuid, p_message text, p_days jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  d jsonb;
  v_treatment uuid;
  v_default integer;
  v_days integer;
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca pueden cambiar el recall';
  end if;
  select organization_id into v_org from branches where id = p_branch;

  update branches
     set recall_message = nullif(left(trim(coalesce(p_message, '')), 1000), '')
   where id = p_branch;

  for d in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    v_treatment := (d ->> 'treatment_id')::uuid;
    select recall_days into v_default from treatments where id = v_treatment and organization_id = v_org;
    if not found then
      raise exception 'Tratamiento desconocido';
    end if;
    v_days := nullif(d ->> 'days', '')::integer;
    if v_days is not null and (v_days < 1 or v_days > 3650) then
      raise exception 'Los días tienen que ser entre 1 y 3650';
    end if;
    -- Igual que el catálogo: no se guarda nada (si la marca lo cambia después, la sucursal lo sigue)
    if v_days is not distinct from v_default then
      delete from branch_recall_days where branch_id = p_branch and treatment_id = v_treatment;
    else
      insert into branch_recall_days (organization_id, branch_id, treatment_id, recall_days)
      values (v_org, p_branch, v_treatment, v_days)
      on conflict (branch_id, treatment_id)
      do update set recall_days = excluded.recall_days, updated_at = now(), updated_by = auth.uid();
    end if;
  end loop;
end $$;
revoke execute on function public.save_recall_settings(uuid, text, jsonb) from public, anon;
grant execute on function public.save_recall_settings(uuid, text, jsonb) to authenticated;

-- La lista de Recall usa los días de la sucursal donde se hizo el último tratamiento
create or replace view public.recall_queue with (security_invoker = true) as
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
),
days as (
  select ld.*, t.name as treatment_name,
         case when br.treatment_id is not null then br.recall_days else t.recall_days end as recall_days
    from last_done ld
    join public.treatments t on t.id = ld.treatment_id and t.is_active
    left join public.branch_recall_days br on br.branch_id = ld.last_branch_id and br.treatment_id = ld.treatment_id
)
select
  ld.organization_id,
  ld.last_branch_id as branch_id,
  ld.patient_id,
  ld.treatment_id,
  ld.last_appointment_id,
  ld.last_done_at,
  (ld.last_done_at at time zone o.timezone)::date + ld.recall_days as due_date,
  ld.treatment_name,
  ld.recall_days,
  p.first_name,
  p.last_name,
  p.phone,
  p.consent_marketing_at,
  lc.contacted_at as last_contacted_at,
  lc.outcome      as last_outcome
from days ld
join public.organizations o on o.id = ld.organization_id
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
where ld.recall_days is not null
  and p.marketing_opt_out_at is null
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

grant select on public.recall_queue to authenticated;
