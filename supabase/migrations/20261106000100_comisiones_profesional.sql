-- =====================================================================
-- Comisiones por turno: la profesional ve las suyas; franquiciado y marca,
-- las de todas las profesionales de la sucursal. La comisión sigue sin ser
-- legible directo (columna sin SELECT): se lee solo con esta función.
-- =====================================================================

create or replace function public.professional_commissions(
  p_branch uuid,
  p_professional uuid,   -- null = todas (solo franquiciado y marca)
  p_from date,
  p_to date               -- inclusive
)
returns table (
  appointment_id uuid,
  scheduled_at timestamptz,
  professional_id uuid,
  professional_name text,
  patient_name text,
  treatments text,
  amount_paid numeric,
  commission numeric,
  commission_manual boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (
    public.is_branch_admin(p_branch)
    or (
      p_professional is not null
      and public.can_access_branch(p_branch)
      and exists (select 1 from professionals pr where pr.id = p_professional and pr.user_id = auth.uid())
    )
  ) then
    raise exception 'No tenés permiso para ver estas comisiones';
  end if;

  return query
    select a.id,
           a.scheduled_at,
           pr.id,
           pr.full_name,
           trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
           (select string_agg(coalesce(t.name, 'Tratamiento'), ' + ' order by ai.created_at)
              from appointment_items ai left join treatments t on t.id = ai.treatment_id
             where ai.appointment_id = a.id),
           coalesce(a.amount_paid, 0),
           coalesce(a.commission, 0),
           a.commission_manual
      from appointments a
      join professionals pr on pr.id = a.professional_id
      join patients p on p.id = a.patient_id
     where a.branch_id = p_branch
       and a.status = 'completed'
       and (p_professional is null or a.professional_id = p_professional)
       and a.scheduled_at >= (p_from::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and a.scheduled_at < ((p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
     order by a.scheduled_at desc;
end $$;
revoke execute on function public.professional_commissions(uuid, uuid, date, date) from public, anon;
grant execute on function public.professional_commissions(uuid, uuid, date, date) to authenticated;
