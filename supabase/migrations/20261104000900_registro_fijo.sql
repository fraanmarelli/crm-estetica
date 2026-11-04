-- =====================================================================
-- Registro de pacientes con link fijo por sucursal (/registro/<token>).
-- Reemplaza la ficha de un solo uso: el link queda abierto en el celular del
-- local o impreso como QR. Solo permite CREAR pacientes, nunca leerlas.
-- El franquiciado puede cambiar el link si se filtra.
-- =====================================================================

alter table public.branches
  add column intake_token text not null unique default replace(gen_random_uuid()::text, '-', '');

-- Marca de las pacientes que se registraron solas
alter table public.patients add column self_registered_at timestamptz;
create index patients_self_registered_idx on public.patients (home_branch_id, self_registered_at)
  where self_registered_at is not null;

-- Cambiar el link de la sucursal (el anterior deja de funcionar)
create or replace function public.rotate_intake_token(p_branch uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_branch_admin(p_branch) then
    raise exception 'Solo la marca o el franquiciado pueden cambiar el link';
  end if;
  update branches set intake_token = v_token where id = p_branch;
  return v_token;
end $$;

revoke execute on function public.rotate_intake_token(uuid) from public, anon;
grant execute on function public.rotate_intake_token(uuid) to authenticated;
