-- =====================================================================
-- Código de lote del insumo usado en cada tratamiento (trazabilidad sanitaria, ANMAT).
-- Se carga en el cobro; el formulario propone el último lote usado en la sucursal para
-- ese tratamiento. Va a la columna «Codigo/s producto/s» de la planilla.
-- =====================================================================

alter table public.appointment_items
  add column lot_code text check (lot_code is null or length(trim(lot_code)) between 1 and 60);
-- appointment_items tiene permisos por columna (el costo no es legible): se habilita la nueva
grant select (lot_code) on public.appointment_items to authenticated;
create index appointment_items_lot_idx on public.appointment_items (lower(lot_code)) where lot_code is not null;

create or replace function public.appointment_event_payload(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select a.*, o.timezone, b.name as branch_name,
           p.first_name, p.last_name, p.phone, p.email, p.dni, p.address,
           p.consent_marketing_at, p.marketing_opt_out_at,
           pr.full_name as professional_name,
           (select sum(ai.cost) from appointment_items ai where ai.appointment_id = a.id) as items_cost,
           (select string_agg(t.name || coalesce(' - ' || ai.zone, ''), ', ' order by t.name)
              from appointment_items ai join treatments t on t.id = ai.treatment_id
             where ai.appointment_id = a.id) as treatments_text,
           (select string_agg(distinct pm.name, ', ')
              from appointment_items ai join promotions pm on pm.id = ai.promotion_id
             where ai.appointment_id = a.id) as promos_text,
           (select string_agg(distinct ai.lot_code, ', ')
              from appointment_items ai
             where ai.appointment_id = a.id and ai.lot_code is not null) as lots_text
      from appointments a
      join organizations o on o.id = a.organization_id
      join branches b on b.id = a.branch_id
      join patients p on p.id = a.patient_id
      left join professionals pr on pr.id = a.professional_id
     where a.id = p_appointment_id
  )
  select jsonb_build_object(
    'id_crm',           base.id,
    'fecha',            to_char(coalesce(base.completed_at, base.scheduled_at) at time zone base.timezone,
                                'YYYY-MM-DD'),
    'fecha_iso',        coalesce(base.completed_at, base.scheduled_at),
    'sucursal',         base.branch_name,
    'sucursal_id',      base.branch_id,
    'paciente',         trim(base.first_name || ' ' || coalesce(base.last_name, '')),
    'paciente_id',      base.patient_id,
    'nombre',           base.first_name,
    'apellido',         base.last_name,
    'telefono',         base.phone,
    'email',            base.email,
    'dni',              base.dni,
    'acepta_marketing', base.consent_marketing_at is not null and base.marketing_opt_out_at is null,
    'tratamiento',      base.treatments_text,
    'promo',            base.promos_text,
    'lotes',            base.lots_text,
    'items',            coalesce((
                          select jsonb_agg(jsonb_build_object(
                            'tratamiento_id', t.id,
                            'tratamiento', t.name,
                            'categoria', t.category,
                            'zona', ai.zone,
                            'cantidad', ai.quantity,
                            'precio', ai.price,
                            'promo', pm.name,
                            'lote', ai.lot_code,
                            'dias_recall', t.recall_days,
                            'proximo_vencimiento',
                              case when t.recall_days is not null then
                                ((coalesce(base.completed_at, base.scheduled_at) at time zone base.timezone)::date
                                  + t.recall_days)
                              end
                          ) order by t.name)
                            from appointment_items ai
                            join treatments t on t.id = ai.treatment_id
                            left join promotions pm on pm.id = ai.promotion_id
                           where ai.appointment_id = base.id
                        ), '[]'::jsonb),
    'profesional',      base.professional_name,
    'monto',            base.amount_paid,
    'medio_de_pago',    base.payment_method,
    'estado',           base.status,
    'notas',            base.notes,
    -- Columnas de la planilla de Córdoba
    'Nombres',                   base.first_name,
    'Apellidos',                 base.last_name,
    'DNI (CUIL/CUIT)',           base.dni,
    'Tratamiento/s realizado/s', base.treatments_text,
    'Medico/a',                  base.professional_name,
    'Comentario',                base.notes,
    'celular',                   base.phone,
    'mail',                      base.email,
    'Domicilio',                 base.address,
    'Promo',                     base.promos_text,
    'Codigo/s producto/s',       base.lots_text,
    'Total',                     base.amount_paid,
    'Comision medica',           base.commission,
    'Insumo',                    base.items_cost,
    'Ingreso Neto',              coalesce(base.amount_paid, 0) - coalesce(base.items_cost, 0)
                                   - coalesce(base.commission, 0)
  )
  || coalesce((
       select jsonb_object_agg(pa.name, s.amount)
         from (
           select p.account_id, sum(p.amount) as amount
             from appointment_payments p
            where p.appointment_id = base.id
            group by p.account_id
         ) s
         join payment_accounts pa on pa.id = s.account_id
     ), '{}'::jsonb)
  from base;
$$;


revoke execute on function public.appointment_event_payload(uuid) from public, anon, authenticated;
grant execute on function public.appointment_event_payload(uuid) to service_role;
