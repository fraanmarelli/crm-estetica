-- =====================================================================
-- Importar el historial de la planilla de una sucursal (Pacientes → Importar historial).
-- Cada fila de la planilla = una visita atendida. Se puede correr las veces que haga falta:
-- cada fila trae su referencia (external_ref) y la que ya entró se saltea.
-- Lo importado:
--   · no se manda a la planilla, al calendario ni a Klaviyo (enqueue ya saltea external_ref),
--   · no da millas, no crea chequeos de Mercado Pago,
--   · respeta la comisión y el insumo de la planilla (para que Números dé lo mismo),
--   · cuenta en el día de la planilla (completed_at = día del turno, así el recall arranca de ahí).
-- Pacientes nuevas: ficha incompleta y sin consentimiento de recordatorios (no se les manda nada).
-- Solo franquiciado o marca de la sucursal.
-- =====================================================================

-- 1. Insumo: el sistema lo calcula, salvo en la importación (que trae el de la planilla)
create or replace function public.fill_item_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_unit_cost numeric;
begin
  if current_setting('crm.import_cost', true) = 'on' then
    return new;
  end if;
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

-- 2. Millas: los turnos importados no dan millas
create or replace function public.award_loyalty_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rate numeric;
  v_points integer;
begin
  if new.external_ref is not null then
    return null;
  end if;
  if new.status <> 'completed' or coalesce(new.amount_paid, 0) <= 0 then
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

-- 3. Mercado Pago: los cobros importados no se verifican (y tampoco con la función apagada)
create or replace function public.skip_disabled_transfer_checks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.branch_feature_on(new.branch_id, 'mp') then
    return null;
  end if;
  if exists (select 1 from appointments a where a.id = new.appointment_id and a.external_ref is not null) then
    return null;
  end if;
  return new;
end $$;

-- 4. La importación
-- p_rows: [{ ref, date (AAAA-MM-DD), first_name, last_name, dni, phone, email, address,
--            patient_key, professional, raw, comment, items: [{treatment, zone, quantity, price, lot}],
--            payments: [{account, amount}], commission, supplies }]
--   treatment: nombre exacto del catálogo, o «Control» / «Otro (de la planilla)» (se crean inactivos)
--   account: nombre de la cuenta de cobro, «__usd__» (la de dólares) o «__sin__» (sin detallar)
create or replace function public.import_sheet_rows(p_branch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  r jsonb;
  it jsonb;
  pay jsonb;
  v_patient uuid;
  v_prof uuid;
  v_appt uuid;
  v_treatment uuid;
  v_account uuid;
  v_first_item uuid;
  v_item uuid;
  v_day date;
  v_at timestamptz;
  v_phone text;
  v_dni text;
  v_tz text;
  n_new int := 0;
  n_dupe int := 0;
  n_crm int := 0;
  n_patients int := 0;
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca pueden importar el historial';
  end if;
  select b.organization_id, o.timezone into v_org, v_tz
    from branches b join organizations o on o.id = b.organization_id where b.id = p_branch;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    -- Ya importada
    if exists (select 1 from appointments where organization_id = v_org and external_ref = r ->> 'ref') then
      n_dupe := n_dupe + 1;
      continue;
    end if;

    v_day := (r ->> 'date')::date;
    v_at := (v_day::text || ' 12:00')::timestamp at time zone v_tz;
    v_dni := nullif(regexp_replace(coalesce(r ->> 'dni', ''), '\D', '', 'g'), '');
    v_phone := public.normalize_phone(nullif(r ->> 'phone', ''));
    if v_phone is not null and v_phone !~ '^[0-9]{8,15}$' then
      v_phone := null;
    end if;

    -- Paciente: por DNI, por celular o por la clave de la planilla (nombre)
    v_patient := null;
    if v_dni is not null then
      select id into v_patient from patients where organization_id = v_org and dni = v_dni order by created_at limit 1;
    end if;
    if v_patient is null and v_phone is not null then
      select id into v_patient from patients where organization_id = v_org and phone = v_phone order by created_at limit 1;
    end if;
    if v_patient is null then
      select id into v_patient from patients where organization_id = v_org and external_ref = r ->> 'patient_key';
    end if;
    if v_patient is null then
      insert into patients (organization_id, home_branch_id, first_name, last_name, phone, email, dni, address,
                            external_ref, created_at)
      values (v_org, p_branch, coalesce(nullif(r ->> 'first_name', ''), 'Sin nombre'), nullif(r ->> 'last_name', ''),
              v_phone, nullif(r ->> 'email', ''), v_dni, nullif(r ->> 'address', ''), r ->> 'patient_key', v_at)
      returning id into v_patient;
      n_patients := n_patients + 1;
    else
      -- Completa solo lo que falta; nunca pisa lo cargado
      update patients
         set phone = coalesce(phone, v_phone),
             email = coalesce(email, nullif(r ->> 'email', '')),
             dni = coalesce(dni, v_dni),
             address = coalesce(address, nullif(r ->> 'address', '')),
             created_at = least(created_at, v_at)
       where id = v_patient;
    end if;

    -- Ese día ya tiene un turno cargado en el CRM (la fila la escribió el CRM en la planilla)
    if exists (
      select 1 from appointments a
       where a.patient_id = v_patient and a.external_ref is null and a.status <> 'cancelled'
         and (a.scheduled_at at time zone v_tz)::date = v_day
    ) then
      n_crm := n_crm + 1;
      continue;
    end if;

    -- Médico/a: por nombre (o el que empieza igual: «Ulma Irina Feser» = «Ulma»); si no, se crea inactivo
    v_prof := null;
    if nullif(r ->> 'professional', '') is not null then
      select id into v_prof from professionals
       where organization_id = v_org and (branch_id is null or branch_id = p_branch)
         and (lower(full_name) = lower(r ->> 'professional')
              or lower(r ->> 'professional') like lower(full_name) || ' %')
       order by is_active desc, length(full_name) desc limit 1;
      if v_prof is null then
        insert into professionals (organization_id, branch_id, full_name, is_active)
        values (v_org, p_branch, r ->> 'professional', false)
        returning id into v_prof;
      end if;
    end if;

    insert into appointments (organization_id, branch_id, patient_id, professional_id, scheduled_at,
                              duration_minutes, status, notes, external_ref)
    values (v_org, p_branch, v_patient, v_prof, v_at, 30, 'scheduled',
            left(nullif('De la planilla: ' || coalesce(r ->> 'raw', ''), 'De la planilla: '), 1000), r ->> 'ref')
    returning id into v_appt;

    -- Tratamientos (el insumo de la planilla va en el primero)
    perform set_config('crm.import_cost', 'on', true);
    v_first_item := null;
    for it in select * from jsonb_array_elements(coalesce(r -> 'items', '[]'::jsonb)) loop
      select id into v_treatment from treatments where organization_id = v_org and name = it ->> 'treatment';
      if v_treatment is null then
        insert into treatments (organization_id, name, category, is_active, sort_order)
        values (v_org, it ->> 'treatment', 'De la planilla', false, 900)
        on conflict (organization_id, name) do update set name = excluded.name
        returning id into v_treatment;
      end if;
      insert into appointment_items (appointment_id, treatment_id, zone, quantity, price, lot_code, cost)
      values (v_appt, v_treatment, nullif(it ->> 'zone', ''), (it ->> 'quantity')::numeric,
              coalesce((it ->> 'price')::numeric, 0), left(nullif(it ->> 'lot', ''), 60),
              case when v_first_item is null then (r ->> 'supplies')::numeric end)
      returning id into v_item;
      v_first_item := coalesce(v_first_item, v_item);
    end loop;
    perform set_config('crm.import_cost', 'off', true);

    -- Cobro, cuenta por cuenta
    for pay in select * from jsonb_array_elements(coalesce(r -> 'payments', '[]'::jsonb)) loop
      if coalesce((pay ->> 'amount')::numeric, 0) <= 0 then
        continue;
      end if;
      v_account := null;
      if pay ->> 'account' = '__usd__' then
        select id into v_account from payment_accounts
         where branch_id = p_branch and currency = 'USD' order by is_active desc, sort_order limit 1;
      elsif pay ->> 'account' <> '__sin__' then
        select id into v_account from payment_accounts
         where branch_id = p_branch and lower(name) = lower(pay ->> 'account') limit 1;
      end if;
      if v_account is null then
        select id into v_account from payment_accounts where branch_id = p_branch and name = 'Sin detallar (planilla)';
        if v_account is null then
          insert into payment_accounts (organization_id, branch_id, name, currency, is_active, sort_order)
          values (v_org, p_branch, 'Sin detallar (planilla)', 'ARS', false, 999)
          returning id into v_account;
        end if;
      end if;
      insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount)
      values (v_org, p_branch, v_appt, v_account, (pay ->> 'amount')::numeric);
    end loop;

    -- Atendido, en el día de la planilla, con la comisión de la planilla (o 0)
    update appointments set status = 'completed', completed_at = v_at where id = v_appt;
    perform set_config('crm.allow_commission', 'on', true);
    update appointments
       set commission = coalesce((r ->> 'commission')::numeric, 0), commission_manual = true
     where id = v_appt;
    perform set_config('crm.allow_commission', 'off', true);

    -- «Comentario» de la planilla: nota clínica de esa visita (no la ve recepción)
    if nullif(trim(coalesce(r ->> 'comment', '')), '') is not null then
      insert into clinical_notes (appointment_id, body) values (v_appt, left(trim(r ->> 'comment'), 4000));
      update clinical_notes set created_at = v_at, author_name = 'Planilla' where appointment_id = v_appt;
    end if;

    n_new := n_new + 1;
  end loop;

  return jsonb_build_object('imported', n_new, 'already', n_dupe, 'crm', n_crm, 'patients', n_patients);
end $$;
revoke execute on function public.import_sheet_rows(uuid, jsonb) from public, anon;
grant execute on function public.import_sheet_rows(uuid, jsonb) to authenticated;
