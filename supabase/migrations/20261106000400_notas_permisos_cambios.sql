-- =====================================================================
-- 1) Notas de la historia clínica: varias por sesión o sueltas (un llamado,
--    un WhatsApp), con autora y fecha. No se editan: si algo estaba mal se
--    agrega otra nota (como en una historia clínica en papel).
-- 2) Profesionales: solo ven. Turnos, cobros, ítems, pacientes y millas los
--    escriben marca, franquiciado y recepción.
-- 3) Cambios de recepción para revisar: cobro editado de un turno ya
--    atendido, turno atendido que deja de estarlo y millas cargadas a mano.
--    El franquiciado los ve en Números → Cambios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Notas
-- ---------------------------------------------------------------------
alter table public.clinical_notes drop constraint clinical_notes_appointment_id_key;
alter table public.clinical_notes alter column appointment_id drop not null;
alter table public.clinical_notes add column author_name text;
create index clinical_notes_appointment_idx on public.clinical_notes (appointment_id);

create or replace function public.prepare_clinical_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a appointments%rowtype;
  v_org uuid;
begin
  if new.appointment_id is not null then
    -- Nota de una sesión: sucursal, paciente y organización salen del turno
    select * into a from appointments where id = new.appointment_id;
    if a.id is null then
      raise exception 'El turno no existe';
    end if;
    new.organization_id := a.organization_id;
    new.branch_id := a.branch_id;
    new.patient_id := a.patient_id;
  else
    -- Nota suelta: la paciente tiene que ser de la organización de la sucursal
    select b.organization_id into v_org from branches b where b.id = new.branch_id;
    if v_org is null or not exists (
      select 1 from patients p where p.id = new.patient_id and p.organization_id = v_org
    ) then
      raise exception 'La paciente no es de esta sucursal';
    end if;
    new.organization_id := v_org;
  end if;
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  new.created_at := now();
  new.author_name := coalesce(
    (select pr.full_name from professionals pr
      where pr.user_id = auth.uid() and pr.organization_id = new.organization_id
      order by pr.is_active desc limit 1),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Equipo'
  );
  return new;
end $$;
revoke execute on function public.prepare_clinical_note() from public, anon, authenticated;
drop trigger clinical_notes_prepare on public.clinical_notes;
create trigger clinical_notes_prepare before insert on public.clinical_notes
  for each row execute function public.prepare_clinical_note();

-- No se editan
drop policy clinical_notes_update on public.clinical_notes;
revoke update on public.clinical_notes from authenticated;

-- ---------------------------------------------------------------------
-- 2) Quién opera (turnos, cobros, pacientes, millas): marca, franquiciado y recepción
-- ---------------------------------------------------------------------
create or replace function public.can_operate_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_branch_admin(p_branch)
      or exists (
        select 1 from memberships m
         where m.user_id = auth.uid() and m.branch_id = p_branch and m.role = 'reception'
      );
$$;
revoke execute on function public.can_operate_branch(uuid) from public, anon;
grant execute on function public.can_operate_branch(uuid) to authenticated;

create or replace function public.can_edit_patients(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_network_access(p_org)
      or exists (
        select 1 from memberships m
         where m.user_id = auth.uid() and m.organization_id = p_org and m.role in ('branch_admin', 'reception')
      );
$$;
revoke execute on function public.can_edit_patients(uuid) from public, anon;
grant execute on function public.can_edit_patients(uuid) to authenticated;

-- Turnos
drop policy appointments_insert on public.appointments;
drop policy appointments_update on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.can_operate_branch(branch_id));
create policy appointments_update on public.appointments for update to authenticated
  using (public.can_operate_branch(branch_id))
  with check (public.can_operate_branch(branch_id));

-- Ítems: ver = cualquiera de la sucursal; escribir = quien opera
drop policy appointment_items_all on public.appointment_items;
create policy appointment_items_select on public.appointment_items for select to authenticated
  using (exists (
    select 1 from public.appointments a where a.id = appointment_id and public.can_access_branch(a.branch_id)
  ));
create policy appointment_items_write on public.appointment_items for insert to authenticated
  with check (exists (
    select 1 from public.appointments a where a.id = appointment_id and public.can_operate_branch(a.branch_id)
  ));
create policy appointment_items_update on public.appointment_items for update to authenticated
  using (exists (
    select 1 from public.appointments a where a.id = appointment_id and public.can_operate_branch(a.branch_id)
  ))
  with check (exists (
    select 1 from public.appointments a where a.id = appointment_id and public.can_operate_branch(a.branch_id)
  ));
create policy appointment_items_delete on public.appointment_items for delete to authenticated
  using (exists (
    select 1 from public.appointments a where a.id = appointment_id and public.can_operate_branch(a.branch_id)
  ));

-- Cobros
drop policy appointment_payments_all on public.appointment_payments;
create policy appointment_payments_select on public.appointment_payments for select to authenticated
  using (public.can_access_branch(branch_id));
create policy appointment_payments_insert on public.appointment_payments for insert to authenticated
  with check (public.can_operate_branch(branch_id));
create policy appointment_payments_update on public.appointment_payments for update to authenticated
  using (public.can_operate_branch(branch_id)) with check (public.can_operate_branch(branch_id));
create policy appointment_payments_delete on public.appointment_payments for delete to authenticated
  using (public.can_operate_branch(branch_id));

-- Pacientes: las profesionales las ven pero no las cargan ni editan
drop policy patients_insert on public.patients;
drop policy patients_update on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (
    public.can_edit_patients(organization_id)
    and (public.has_network_access(organization_id) or public.can_access_branch(home_branch_id))
  );
create policy patients_update on public.patients for update to authenticated
  using (
    public.can_edit_patients(organization_id)
    and (
      public.has_network_access(organization_id)
      or public.can_access_branch(home_branch_id)
      or exists (
        select 1 from public.appointments a
         where a.patient_id = patients.id and public.can_access_branch(a.branch_id)
      )
    )
  )
  with check (public.is_org_member(organization_id));

-- Millas
drop policy loyalty_insert on public.loyalty_transactions;
create policy loyalty_insert on public.loyalty_transactions for insert to authenticated
  with check (public.can_operate_branch(branch_id) and public.can_access_patient(patient_id));

-- ---------------------------------------------------------------------
-- 3) Cambios para revisar
-- ---------------------------------------------------------------------
create table public.change_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  -- payment_edited: cambió el cobro de un turno ya atendido · completed_reverted: un turno atendido dejó
  -- de estarlo · loyalty_manual: millas sumadas o canjeadas a mano
  kind text not null check (kind in ('payment_edited', 'completed_reverted', 'loyalty_manual')),
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  before jsonb,
  after jsonb,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);
create index change_alerts_branch_idx on public.change_alerts (branch_id, reviewed_at, created_at desc);
alter table public.change_alerts enable row level security;
-- Las crea la base (triggers); el franquiciado y la marca las ven y las marcan como revisadas
create policy change_alerts_select on public.change_alerts for select to authenticated
  using (public.is_branch_admin(branch_id));
create policy change_alerts_update on public.change_alerts for update to authenticated
  using (public.is_branch_admin(branch_id)) with check (public.is_branch_admin(branch_id));
revoke insert, delete on public.change_alerts from authenticated;
revoke update on public.change_alerts from authenticated;
grant update (reviewed_at, reviewed_by) on public.change_alerts to authenticated;

-- Quién cuenta como «alguien a revisar»: un usuario que no es franquiciado ni marca de esa sucursal
create or replace function public.change_needs_review(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.is_branch_admin(p_branch);
$$;
revoke execute on function public.change_needs_review(uuid) from public, anon, authenticated;

-- Cobro de un turno, por cuenta: {"MP Marian": 70000, ...} + total
create or replace function public.payment_snapshot(p_appointment uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cuentas', coalesce((
      select jsonb_object_agg(pa.name, s.amount)
        from (select account_id, sum(amount) as amount from appointment_payments
               where appointment_id = p_appointment group by account_id) s
        join payment_accounts pa on pa.id = s.account_id
    ), '{}'::jsonb),
    'total', coalesce((select sum(amount) from appointment_payments where appointment_id = p_appointment), 0)
  );
$$;
revoke execute on function public.payment_snapshot(uuid) from public, anon, authenticated;

-- Antes de tocar el cobro de un turno atendido: abre (o reusa) el aviso con cómo estaba.
-- Guardar un turno borra y vuelve a cargar las partes en varios pasos: todo lo que haga la misma
-- persona en 3 minutos sobre el mismo turno es un solo cambio.
create or replace function public.alert_payment_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_appt uuid := coalesce(new.appointment_id, old.appointment_id);
  a appointments%rowtype;
begin
  select * into a from appointments where id = v_appt;
  if a.id is null or a.status <> 'completed' or not public.change_needs_review(a.branch_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from change_alerts
     where appointment_id = v_appt and kind = 'payment_edited' and actor_id = auth.uid()
       and updated_at > now() - interval '3 minutes'
  ) then
    insert into change_alerts (organization_id, branch_id, kind, appointment_id, patient_id, actor_id, actor_email, before, after)
    values (a.organization_id, a.branch_id, 'payment_edited', a.id, a.patient_id, auth.uid(),
            auth.jwt() ->> 'email', public.payment_snapshot(a.id), public.payment_snapshot(a.id));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.alert_payment_before() from public, anon, authenticated;

-- Después: actualiza cómo quedó
create or replace function public.alert_payment_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_appt uuid := coalesce(new.appointment_id, old.appointment_id);
begin
  update change_alerts
     set after = public.payment_snapshot(v_appt), updated_at = now()
   where appointment_id = v_appt and kind = 'payment_edited' and actor_id = auth.uid()
     and updated_at > now() - interval '3 minutes';
  return null;
end $$;
revoke execute on function public.alert_payment_after() from public, anon, authenticated;

create trigger appointment_payments_alert_before before insert or update or delete on public.appointment_payments
  for each row execute function public.alert_payment_before();
create trigger appointment_payments_alert_after after insert or update or delete on public.appointment_payments
  for each row execute function public.alert_payment_after();

-- Un turno atendido que pasa a otro estado (deja de contar como cobrado)
create or replace function public.alert_completed_reverted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'completed' and new.status <> 'completed' and public.change_needs_review(new.branch_id) then
    insert into change_alerts (organization_id, branch_id, kind, appointment_id, patient_id, actor_id, actor_email, before, after)
    values (new.organization_id, new.branch_id, 'completed_reverted', new.id, new.patient_id, auth.uid(),
            auth.jwt() ->> 'email',
            jsonb_build_object('estado', old.status, 'cobrado', old.amount_paid),
            jsonb_build_object('estado', new.status, 'cobrado', new.amount_paid));
  end if;
  return null;
end $$;
revoke execute on function public.alert_completed_reverted() from public, anon, authenticated;
create trigger appointments_alert_reverted after update of status on public.appointments
  for each row execute function public.alert_completed_reverted();

-- Millas a mano (las de un turno las suma la base sola y no se avisan)
create or replace function public.alert_loyalty_manual()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.appointment_id is null and public.change_needs_review(new.branch_id) then
    insert into change_alerts (organization_id, branch_id, kind, patient_id, actor_id, actor_email, after, detail)
    values (new.organization_id, new.branch_id, 'loyalty_manual', new.patient_id, auth.uid(),
            auth.jwt() ->> 'email', jsonb_build_object('millas', new.points), new.reason);
  end if;
  return null;
end $$;
revoke execute on function public.alert_loyalty_manual() from public, anon, authenticated;
create trigger loyalty_alert_manual after insert on public.loyalty_transactions
  for each row execute function public.alert_loyalty_manual();
