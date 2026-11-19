-- =====================================================================
-- Funciones por sede: la marca prende o apaga, para cada sucursal, partes de la app.
-- Todas prendidas por defecto (branches.disabled_features vacío). Apagada = desaparece de esa
-- sede (menú, pestañas, Pendientes, Ajustes) y la base deja de hacerla; lo ya cargado queda guardado.
--   ads          → Anuncios y leads (Facebook): no entran leads nuevos ni se sincronizan anuncios
--   mp           → Verificar transferencias de Mercado Pago: no se crean chequeos nuevos
--   promos       → Promos propias de la sede (las de la red siguen): el franquiciado no las crea
--   integrations → Planilla, calendario y Klaviyo: no se encolan envíos
-- Solo la marca escribe branches (política branches_write), así que el franquiciado no puede
-- prenderse lo que la marca apagó.
-- =====================================================================

alter table public.branches
  add column if not exists disabled_features text[] not null default '{}';

alter table public.branches drop constraint if exists branches_disabled_features_check;
alter table public.branches add constraint branches_disabled_features_check
  check (disabled_features <@ array['ads', 'mp', 'promos', 'integrations']::text[]);

-- ¿Esta función está prendida en esta sede? (sin sede = de la red: prendida)
create or replace function public.branch_feature_on(p_branch uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select not (p_key = any (b.disabled_features)) from branches b where b.id = p_branch), true);
$$;
revoke execute on function public.branch_feature_on(uuid, text) from public, anon;
grant execute on function public.branch_feature_on(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- La base deja de hacer lo apagado (sin tocar las funciones programadas)
-- ---------------------------------------------------------------------

-- Leads de Facebook (webhook y leads-sync insertan acá)
create or replace function public.skip_disabled_leads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.branch_feature_on(new.branch_id, 'ads') then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.skip_disabled_leads() from public, anon, authenticated;
drop trigger if exists leads_feature_guard on public.leads;
create trigger leads_feature_guard before insert on public.leads
  for each row execute function public.skip_disabled_leads();

-- Anuncios: meta-sync solo trae las sedes con Anuncios prendido
create or replace function public.ad_connections_to_sync()
returns table (
  connection_id uuid,
  organization_id uuid,
  branch_id uuid,
  ad_account_id text,
  access_token text,
  last_synced_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.organization_id, c.branch_id, c.ad_account_id, s.access_token, c.last_synced_at
    from ad_connections c
    join ad_connection_secrets s on s.connection_id = c.id
   where c.is_active and c.provider = 'meta'
     and public.branch_feature_on(c.branch_id, 'ads');
$$;

-- Mercado Pago: no se crean chequeos nuevos
create or replace function public.skip_disabled_transfer_checks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.branch_feature_on(new.branch_id, 'mp') then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.skip_disabled_transfer_checks() from public, anon, authenticated;
drop trigger if exists transfer_checks_feature_guard on public.transfer_checks;
create trigger transfer_checks_feature_guard before insert on public.transfer_checks
  for each row execute function public.skip_disabled_transfer_checks();

-- Planilla, calendario y Klaviyo: no se encolan envíos de esa sede
create or replace function public.skip_disabled_outbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null and not public.branch_feature_on(new.branch_id, 'integrations') then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.skip_disabled_outbox() from public, anon, authenticated;
drop trigger if exists event_outbox_feature_guard on public.event_outbox;
create trigger event_outbox_feature_guard before insert on public.event_outbox
  for each row execute function public.skip_disabled_outbox();

-- Promos propias: con la función apagada solo la marca crea o pausa promos de esa sede
create or replace function public.can_manage_promotion(p_org uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_branch is null then public.has_network_access(p_org)
    else public.is_branch_admin(p_branch)
         and (public.has_network_access(p_org) or public.branch_feature_on(p_branch, 'promos'))
  end;
$$;

-- ---------------------------------------------------------------------
-- Información de cada franquiciado para la ventana de Sucursales (solo la marca)
-- ---------------------------------------------------------------------
create or replace function public.franchisee_overview(p_org uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  last_sign_in_at timestamptz,
  branch_id uuid,
  team_count integer,
  mp_accounts integer,
  has_facebook boolean,
  has_ads boolean,
  integrations integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_network_access(p_org) then
    raise exception 'Solo la marca';
  end if;
  return query
    select u.id,
           u.email::text,
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           u.last_sign_in_at,
           m.branch_id,
           (select count(*)::int from memberships t where t.branch_id = m.branch_id),
           (select count(*)::int from mp_connections c where c.branch_id = m.branch_id and c.is_active),
           exists (select 1 from lead_pages lp where lp.branch_id = m.branch_id),
           exists (select 1 from ad_connections ac where ac.branch_id = m.branch_id and ac.is_active),
           (select count(*)::int from integrations i where i.branch_id = m.branch_id and i.is_active)
      from memberships m
      join auth.users u on u.id = m.user_id
     where m.organization_id = p_org and m.role = 'branch_admin'
     order by u.email;
end $$;
revoke execute on function public.franchisee_overview(uuid) from public, anon;
grant execute on function public.franchisee_overview(uuid) to authenticated;
