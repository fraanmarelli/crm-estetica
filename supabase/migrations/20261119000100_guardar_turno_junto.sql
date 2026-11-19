-- =====================================================================
-- Guardar un turno en un solo paso: datos del turno, tratamientos, cobro, estado y comisión a mano
-- van juntos en una transacción. Si algo falla (mala señal, un cobro inválido, una promo de otra
-- sucursal), no queda nada a medias: el turno queda como estaba antes de tocar «Guardar».
-- El orden adentro es el de siempre: el turno nuevo entra «agendado», después tratamientos y
-- cobros, y al final el estado, para que las integraciones reciban el turno completo.
-- security invoker: corre con los permisos de quien guarda (RLS y avisos de cambios iguales que antes).
-- =====================================================================

create or replace function public.save_appointment(
  p_id uuid,
  p_branch uuid,
  p_patient uuid,
  p_professional uuid,
  p_scheduled_at timestamptz,
  p_duration integer,
  p_notes text,
  p_status text,
  p_items jsonb,
  p_payments jsonb,
  p_set_commission boolean default false,
  p_commission numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_org uuid;
  v_branch uuid;
begin
  if p_status not in ('scheduled', 'completed', 'no_show', 'cancelled') then
    raise exception 'Estado inválido';
  end if;

  if p_id is null then
    select b.organization_id into v_org from branches b where b.id = p_branch;
    if v_org is null then
      raise exception 'No se encontró la sucursal';
    end if;
    insert into appointments (organization_id, branch_id, patient_id, professional_id, scheduled_at,
                              duration_minutes, notes, status)
    values (v_org, p_branch, p_patient, p_professional, p_scheduled_at, p_duration, p_notes, 'scheduled')
    returning id, branch_id into v_id, v_branch;
  else
    update appointments
       set patient_id = p_patient,
           professional_id = p_professional,
           scheduled_at = p_scheduled_at,
           duration_minutes = p_duration,
           notes = p_notes
     where id = p_id
    returning id, organization_id, branch_id into v_id, v_org, v_branch;
    if v_id is null then
      raise exception 'No se encontró el turno';
    end if;
  end if;

  delete from appointment_items where appointment_id = v_id;
  insert into appointment_items (appointment_id, treatment_id, zone, quantity, price, promotion_id, lot_code)
  select v_id, x.treatment_id, x.zone, x.quantity, x.price, x.promotion_id, x.lot_code
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
         as x(treatment_id uuid, zone text, quantity numeric, price numeric, promotion_id uuid, lot_code text);

  delete from appointment_payments where appointment_id = v_id;
  insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount, exchange_rate, is_deposit)
  select v_org, v_branch, v_id, x.account_id, x.amount, x.exchange_rate, coalesce(x.is_deposit, false)
    from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb))
         as x(account_id uuid, amount numeric, exchange_rate numeric, is_deposit boolean);

  update appointments set status = p_status::appointment_status where id = v_id;

  -- Comisión a mano (o vuelta a automática): set_commission vuelve a verificar que sea marca o franquiciado
  if p_set_commission then
    perform set_commission(v_id, p_commission);
  end if;

  return v_id;
end $$;

revoke execute on function public.save_appointment(uuid, uuid, uuid, uuid, timestamptz, integer, text, text, jsonb, jsonb, boolean, numeric)
  from public, anon;
grant execute on function public.save_appointment(uuid, uuid, uuid, uuid, timestamptz, integer, text, text, jsonb, jsonb, boolean, numeric)
  to authenticated;
