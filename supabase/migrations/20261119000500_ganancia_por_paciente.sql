-- =====================================================================
-- Lo que dejó cada paciente (ficha → «Como paciente»): facturado − insumos − comisión de sus turnos
-- atendidos, solo de las sucursales donde quien mira ve costos (marca: todas; franquiciado: la suya).
-- Recepción y profesionales no lo ven (no hay fila).
-- =====================================================================

create or replace function public.patient_financials(p_patient uuid)
returns table (visits integer, revenue numeric, supplies numeric, commission numeric, net numeric)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select a.id, coalesce(a.amount_paid, 0) as paid, coalesce(a.commission, 0) as commission
      from appointments a
     where a.patient_id = p_patient
       and a.status = 'completed'
       and public.can_see_costs(a.branch_id)
  ), costs as (
    select coalesce(sum(i.cost), 0) as supplies
      from appointment_items i
     where i.appointment_id in (select id from mine)
  )
  select count(*)::int,
         coalesce(sum(m.paid), 0),
         (select supplies from costs),
         coalesce(sum(m.commission), 0),
         coalesce(sum(m.paid), 0) - (select supplies from costs) - coalesce(sum(m.commission), 0)
    from mine m
  having exists (select 1 from appointments a where a.patient_id = p_patient and public.can_see_costs(a.branch_id));
$$;
revoke execute on function public.patient_financials(uuid) from public, anon;
grant execute on function public.patient_financials(uuid) to authenticated;
