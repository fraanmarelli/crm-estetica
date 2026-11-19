-- =====================================================================
-- Transferencias que no llegaron o hay que revisar, en «Pendientes» de Hoy (de cualquier día).
-- El aviso se va cuando el franquiciado (o la marca) lo marca «Ya lo revisé», o solo, si el cobro
-- se corrige (cambia la cuenta o el monto: cleanup_transfer_checks borra el chequeo viejo).
-- Recepción ve el aviso para ir a buscar a la paciente, pero no lo puede sacar: el control es
-- justamente sobre los comprobantes que muestran en recepción.
-- Los chequeos siguen escribiéndolos solo el servidor; esto agrega una sola marca, por función.
-- =====================================================================

alter table public.transfer_checks
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references auth.users(id) on delete set null,
  add column if not exists dismissed_by_name text;

create index if not exists transfer_checks_open_idx
  on public.transfer_checks (branch_id)
  where status in ('review', 'not_found') and dismissed_at is null;

create or replace function public.dismiss_transfer_check(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from transfer_checks where id = p_id;
  if v_branch is null or not public.is_branch_admin(v_branch) then
    raise exception 'Solo el franquiciado o la marca marcan una transferencia como revisada';
  end if;
  update transfer_checks
     set dismissed_at = now(),
         dismissed_by = auth.uid(),
         dismissed_by_name = coalesce(
           nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
           auth.jwt() ->> 'email'
         )
   where id = p_id
     and status in ('review', 'not_found')
     and dismissed_at is null;
end $$;

revoke execute on function public.dismiss_transfer_check(uuid) from public, anon;
grant execute on function public.dismiss_transfer_check(uuid) to authenticated;
