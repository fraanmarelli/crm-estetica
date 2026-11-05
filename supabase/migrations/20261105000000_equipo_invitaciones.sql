-- =====================================================================
-- Equipo e invitaciones, sin depender del mail de Supabase.
-- Quien administra genera una invitación (link personal, 7 días, un uso) y la
-- manda por WhatsApp o mail. Al abrirla, la persona elige su contraseña (o, si
-- ya tenía cuenta, la invitación se suma a su usuario). El alta la hace el
-- servidor con service role después de validar el token.
--   Marca: invita marca, franquiciados y equipo de cualquier sucursal; crea sucursales.
--   Franquiciado: invita recepción y profesionales de su sucursal.
-- =====================================================================

create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role public.member_role not null,
  professional_id uuid references public.professionals(id) on delete set null,
  token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  check (
    (role in ('network_owner', 'network_admin') and branch_id is null)
    or (role not in ('network_owner', 'network_admin') and branch_id is not null)
  )
);
create index member_invites_branch_idx on public.member_invites (organization_id, branch_id, created_at desc);

-- ¿Puede este usuario invitar (o quitar) ese rol en esa sucursal?
create or replace function public.can_manage_role(p_org uuid, p_branch uuid, p_role public.member_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_role in ('network_owner', 'network_admin', 'branch_admin') then public.has_network_access(p_org)
    else p_branch is not null and public.is_branch_admin(p_branch)
  end;
$$;
revoke execute on function public.can_manage_role(uuid, uuid, public.member_role) from public, anon;
grant execute on function public.can_manage_role(uuid, uuid, public.member_role) to authenticated;

alter table public.member_invites enable row level security;
create policy member_invites_select on public.member_invites for select to authenticated
  using (
    public.has_network_access(organization_id)
    or (branch_id is not null and public.is_branch_admin(branch_id))
  );
create policy member_invites_insert on public.member_invites for insert to authenticated
  with check (public.can_manage_role(organization_id, branch_id, role));
-- Solo para anularla (revoked_at); la acepta el servidor
create policy member_invites_update on public.member_invites for update to authenticated
  using (public.can_manage_role(organization_id, branch_id, role))
  with check (public.can_manage_role(organization_id, branch_id, role));

-- Equipo de una sucursal (o de la marca si p_branch es null), con su email
create or replace function public.team_members(p_org uuid, p_branch uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role public.member_role,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_branch is null and not public.has_network_access(p_org) then
    raise exception 'Solo la marca ve su equipo';
  end if;
  if p_branch is not null and not public.is_branch_admin(p_branch) then
    raise exception 'Solo el franquiciado o la marca ven el equipo de la sucursal';
  end if;
  return query
    select m.id, m.user_id, u.email::text, m.role, m.created_at, u.last_sign_in_at
      from memberships m
      join auth.users u on u.id = m.user_id
     where m.organization_id = p_org
       and m.branch_id is not distinct from p_branch
     order by m.role, u.email;
end $$;
revoke execute on function public.team_members(uuid, uuid) from public, anon;
grant execute on function public.team_members(uuid, uuid) to authenticated;

-- Franquiciados de cada sucursal (para la pantalla de la marca)
create or replace function public.branch_owners(p_org uuid)
returns table (branch_id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_network_access(p_org) then
    raise exception 'Solo la marca';
  end if;
  return query
    select m.branch_id, u.email::text
      from memberships m join auth.users u on u.id = m.user_id
     where m.organization_id = p_org and m.role = 'branch_admin'
     order by u.email;
end $$;
revoke execute on function public.branch_owners(uuid) from public, anon;
grant execute on function public.branch_owners(uuid) to authenticated;

-- Quitar el acceso de alguien (nunca el propio, ni el último dueño de la marca)
create or replace function public.remove_membership(p_membership uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m memberships%rowtype;
begin
  select * into m from memberships where id = p_membership;
  if m.id is null then
    raise exception 'No existe ese acceso';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'No podés quitarte el acceso a vos misma/o';
  end if;
  if not public.can_manage_role(m.organization_id, m.branch_id, m.role) then
    raise exception 'No tenés permiso para quitar este acceso';
  end if;
  if m.role = 'network_owner' and (
    select count(*) from memberships where organization_id = m.organization_id and role = 'network_owner'
  ) <= 1 then
    raise exception 'La marca necesita al menos un dueño';
  end if;
  delete from memberships where id = p_membership;
  -- Si era profesional, su ficha deja de estar vinculada a ese usuario
  update professionals set user_id = null
   where user_id = m.user_id and organization_id = m.organization_id
     and (branch_id is null or branch_id = m.branch_id);
end $$;
revoke execute on function public.remove_membership(uuid) from public, anon;
grant execute on function public.remove_membership(uuid) to authenticated;

-- Para el servidor al aceptar una invitación: ¿ya existe un usuario con ese mail?
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- Cuentas de cobro iniciales de una sucursal nueva (cada franquiciado las ajusta)
create or replace function public.seed_branch_accounts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into payment_accounts (organization_id, branch_id, name, currency, sort_order)
  select new.organization_id, new.id, v.name, v.currency, v.sort_order
    from (values ('Efectivo', 'ARS', 10), ('Transferencia', 'ARS', 20), ('Mercado Pago', 'ARS', 30),
                 ('Tarjeta de débito', 'ARS', 40), ('Tarjeta de crédito', 'ARS', 50), ('Dólares', 'USD', 60)
         ) as v(name, currency, sort_order)
  on conflict (branch_id, name) do nothing;
  return null;
end $$;
revoke execute on function public.seed_branch_accounts() from public, anon, authenticated;

create trigger branches_seed_accounts after insert on public.branches
  for each row execute function public.seed_branch_accounts();
