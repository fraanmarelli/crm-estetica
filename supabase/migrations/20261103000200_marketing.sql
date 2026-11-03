-- =====================================================================
-- Marketing: cuentas publicitarias de Meta por sucursal, gasto diario,
-- resumen cruzado con pacientes/facturación y datos del mail semanal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conexiones (una cuenta publicitaria por sucursal)
-- ---------------------------------------------------------------------
create table public.ad_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  provider text not null default 'meta' check (provider in ('meta')),
  ad_account_id text not null,                 -- sin el prefijo act_
  ad_account_name text,
  currency text,
  connected_by uuid references auth.users(id) on delete set null,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (branch_id, provider)
);
create trigger ad_connections_updated_at before update on public.ad_connections
  for each row execute function public.set_updated_at();

-- Tokens: tabla aparte, sin políticas => solo el servidor (service role) la lee
create table public.ad_connection_secrets (
  connection_id uuid primary key references public.ad_connections(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

-- Conexiones a medio terminar (entre el login de Facebook y elegir la cuenta)
create table public.ad_oauth_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  access_token text not null,
  token_expires_at timestamptz,
  accounts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Métricas diarias por campaña
-- ---------------------------------------------------------------------
create table public.ad_insights_daily (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  connection_id uuid not null references public.ad_connections(id) on delete cascade,
  date date not null,
  campaign_id text not null,
  campaign_name text,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  messages bigint not null default 0,          -- conversaciones de WhatsApp/Messenger iniciadas
  leads bigint not null default 0,             -- formularios
  synced_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id),
  unique (connection_id, date, campaign_id)
);
create index ad_insights_branch_date_idx on public.ad_insights_daily (branch_id, date);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.ad_connections        enable row level security;
alter table public.ad_connection_secrets enable row level security;
alter table public.ad_oauth_pending      enable row level security;
alter table public.ad_insights_daily     enable row level security;

-- Marketing lo ven la marca y el franquiciado de cada sucursal (no recepción)
create policy ad_connections_select on public.ad_connections for select to authenticated
  using (public.is_branch_admin(branch_id));
create policy ad_connections_update on public.ad_connections for update to authenticated
  using (public.is_branch_admin(branch_id)) with check (public.is_branch_admin(branch_id));
create policy ad_connections_delete on public.ad_connections for delete to authenticated
  using (public.is_branch_admin(branch_id));

create policy ad_insights_select on public.ad_insights_daily for select to authenticated
  using (public.is_branch_admin(branch_id));

-- ad_connection_secrets y ad_oauth_pending: sin políticas y sin permisos para usuarios.
revoke all on public.ad_connection_secrets, public.ad_oauth_pending from anon, authenticated;
revoke insert, update, delete on public.ad_insights_daily from anon, authenticated;
revoke insert on public.ad_connections from anon, authenticated;

-- ---------------------------------------------------------------------
-- Resumen por sucursal para un período (respeta RLS de quien consulta)
-- ---------------------------------------------------------------------
create or replace function public.marketing_summary(p_org uuid, p_from date, p_to date)
returns table (
  branch_id uuid,
  branch_name text,
  spend numeric,
  impressions bigint,
  clicks bigint,
  messages bigint,
  leads bigint,
  new_patients integer,
  new_patients_social integer,
  new_patients_revenue numeric,
  new_social_revenue numeric
)
language sql stable security invoker set search_path = public as $$
  with o as (
    select timezone from organizations where id = p_org
  ),
  b as (
    select id, name from branches where organization_id = p_org and is_active
  ),
  ads as (
    select i.branch_id,
           sum(i.spend) as spend,
           sum(i.impressions) as impressions,
           sum(i.clicks) as clicks,
           sum(i.messages) as messages,
           sum(i.leads) as leads
      from ad_insights_daily i
     where i.organization_id = p_org and i.date between p_from and p_to
     group by i.branch_id
  ),
  np as (
    select p.id,
           p.home_branch_id,
           coalesce(p.source in ('Instagram', 'Facebook'), false) as social
      from patients p, o
     where p.organization_id = p_org
       and (p.created_at at time zone o.timezone)::date between p_from and p_to
  ),
  rev as (
    select a.patient_id, sum(a.amount_paid) as total
      from appointments a
      join np on np.id = a.patient_id
     where a.status = 'completed'
     group by a.patient_id
  ),
  agg as (
    select np.home_branch_id as branch_id,
           count(*)::integer as new_patients,
           (count(*) filter (where np.social))::integer as new_patients_social,
           coalesce(sum(rev.total), 0) as new_patients_revenue,
           coalesce(sum(rev.total) filter (where np.social), 0) as new_social_revenue
      from np
      left join rev on rev.patient_id = np.id
     group by np.home_branch_id
  )
  select b.id,
         b.name,
         coalesce(ads.spend, 0),
         coalesce(ads.impressions, 0)::bigint,
         coalesce(ads.clicks, 0)::bigint,
         coalesce(ads.messages, 0)::bigint,
         coalesce(ads.leads, 0)::bigint,
         coalesce(agg.new_patients, 0),
         coalesce(agg.new_patients_social, 0),
         coalesce(agg.new_patients_revenue, 0),
         coalesce(agg.new_social_revenue, 0)
    from b
    left join ads on ads.branch_id = b.id
    left join agg on agg.branch_id = b.id
   order by b.name;
$$;

-- Campañas de una sucursal en un período (respeta RLS)
create or replace function public.campaign_summary(p_branch uuid, p_from date, p_to date)
returns table (
  campaign_id text,
  campaign_name text,
  spend numeric,
  impressions bigint,
  clicks bigint,
  messages bigint,
  leads bigint,
  last_date date
)
language sql stable security invoker set search_path = public as $$
  select i.campaign_id,
         (array_agg(i.campaign_name order by i.date desc))[1],
         sum(i.spend),
         sum(i.impressions)::bigint,
         sum(i.clicks)::bigint,
         sum(i.messages)::bigint,
         sum(i.leads)::bigint,
         max(i.date)
    from ad_insights_daily i
   where i.branch_id = p_branch and i.date between p_from and p_to
   group by i.campaign_id
   order by sum(i.spend) desc;
$$;

-- ---------------------------------------------------------------------
-- Funciones para el servidor (service role)
-- ---------------------------------------------------------------------

-- Guarda una conexión elegida por el usuario (verifica que la cuenta esté en su login)
create or replace function public.finalize_ad_connection(p_pending_id uuid, p_user uuid, p_account_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pending ad_oauth_pending;
  v_account jsonb;
  v_connection uuid;
begin
  select * into v_pending
    from ad_oauth_pending
   where id = p_pending_id
     and user_id = p_user
     and created_at > now() - interval '30 minutes';
  if not found then
    raise exception 'La conexión venció. Volvé a tocar "Conectar con Facebook".';
  end if;

  select a into v_account
    from jsonb_array_elements(v_pending.accounts) a
   where a->>'account_id' = p_account_id;
  if v_account is null then
    raise exception 'Esa cuenta publicitaria no está disponible para este usuario.';
  end if;

  -- Si la sucursal cambia de cuenta publicitaria, se borran las métricas de la anterior
  delete from ad_insights_daily i
   using ad_connections c
   where c.branch_id = v_pending.branch_id
     and c.provider = 'meta'
     and c.ad_account_id <> p_account_id
     and i.connection_id = c.id;

  insert into ad_connections
    (organization_id, branch_id, provider, ad_account_id, ad_account_name, currency,
     connected_by, token_expires_at, last_error, is_active)
  values
    (v_pending.organization_id, v_pending.branch_id, 'meta', p_account_id,
     v_account->>'name', v_account->>'currency', p_user, v_pending.token_expires_at, null, true)
  on conflict (branch_id, provider) do update
    set ad_account_id = excluded.ad_account_id,
        ad_account_name = excluded.ad_account_name,
        currency = excluded.currency,
        connected_by = excluded.connected_by,
        token_expires_at = excluded.token_expires_at,
        last_error = null,
        is_active = true
  returning id into v_connection;

  insert into ad_connection_secrets (connection_id, access_token, updated_at)
  values (v_connection, v_pending.access_token, now())
  on conflict (connection_id) do update
    set access_token = excluded.access_token, updated_at = now();

  delete from ad_oauth_pending where id = p_pending_id or created_at < now() - interval '1 day';
  return v_connection;
end $$;

-- Conexiones a sincronizar, con su token
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
   where c.is_active and c.provider = 'meta';
$$;

-- Datos del mail semanal: semana pasada (lunes a domingo) vs la anterior
create or replace function public.weekly_report(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_to date;
  v_from date;
  v_prev_to date;
  v_prev_from date;
  v_result jsonb;
begin
  select timezone into v_tz from organizations where id = p_org;
  v_today := (now() at time zone v_tz)::date;
  v_to := v_today - extract(isodow from v_today)::integer;   -- último domingo
  v_from := v_to - 6;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - 6;

  with b as (
    select id, name from branches where organization_id = p_org and is_active
  ),
  appt as (
    select a.branch_id,
           count(*) filter (where (a.completed_at at time zone v_tz)::date between v_from and v_to) as done,
           coalesce(sum(a.amount_paid) filter (where (a.completed_at at time zone v_tz)::date between v_from and v_to), 0) as revenue,
           count(*) filter (where (a.completed_at at time zone v_tz)::date between v_prev_from and v_prev_to) as done_prev,
           coalesce(sum(a.amount_paid) filter (where (a.completed_at at time zone v_tz)::date between v_prev_from and v_prev_to), 0) as revenue_prev,
           max(a.created_at) as last_loaded
      from appointments a
     where a.organization_id = p_org and a.status = 'completed'
     group by a.branch_id
  ),
  cur as (select * from marketing_summary(p_org, v_from, v_to)),
  prev as (select * from marketing_summary(p_org, v_prev_from, v_prev_to)),
  due as (
    select branch_id, count(*) as due_count
      from recall_queue
     where organization_id = p_org and due_date <= v_to
     group by branch_id
  ),
  contacts as (
    select branch_id,
           count(*) as contacted,
           count(*) filter (where outcome = 'booked') as booked
      from recall_contacts
     where organization_id = p_org
       and (contacted_at at time zone v_tz)::date between v_from and v_to
     group by branch_id
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'branches', coalesce(jsonb_agg(jsonb_build_object(
      'branch_id', b.id,
      'branch', b.name,
      'done', coalesce(appt.done, 0),
      'done_prev', coalesce(appt.done_prev, 0),
      'revenue', coalesce(appt.revenue, 0),
      'revenue_prev', coalesce(appt.revenue_prev, 0),
      'new_patients', coalesce(cur.new_patients, 0),
      'new_patients_prev', coalesce(prev.new_patients, 0),
      'new_social', coalesce(cur.new_patients_social, 0),
      'spend', coalesce(cur.spend, 0),
      'spend_prev', coalesce(prev.spend, 0),
      'messages', coalesce(cur.messages, 0) + coalesce(cur.leads, 0),
      'recall_due', coalesce(due.due_count, 0),
      'recall_contacted', coalesce(contacts.contacted, 0),
      'recall_booked', coalesce(contacts.booked, 0),
      'has_ads', exists (select 1 from ad_connections c where c.branch_id = b.id and c.is_active),
      'last_loaded', appt.last_loaded
    ) order by coalesce(appt.revenue, 0) desc), '[]'::jsonb)
  )
  into v_result
  from b
  left join appt on appt.branch_id = b.id
  left join cur on cur.branch_id = b.id
  left join prev on prev.branch_id = b.id
  left join due on due.branch_id = b.id
  left join contacts on contacts.branch_id = b.id;

  return v_result;
end $$;

-- Destinatarios: la marca recibe todo, cada franquiciado su sucursal
create or replace function public.report_recipients(p_org uuid)
returns table (email text, role public.member_role, branch_id uuid)
language sql stable security definer set search_path = public as $$
  select u.email, m.role, m.branch_id
    from memberships m
    join auth.users u on u.id = m.user_id
   where m.organization_id = p_org
     and m.role in ('network_owner', 'network_admin', 'branch_admin')
     and u.email is not null;
$$;

revoke execute on function public.finalize_ad_connection(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.ad_connections_to_sync() from public, anon, authenticated;
revoke execute on function public.weekly_report(uuid) from public, anon, authenticated;
revoke execute on function public.report_recipients(uuid) from public, anon, authenticated;
grant execute on function public.finalize_ad_connection(uuid, uuid, text) to service_role;
grant execute on function public.ad_connections_to_sync() to service_role;
grant execute on function public.weekly_report(uuid) to service_role;
grant execute on function public.report_recipients(uuid) to service_role;
grant all on public.ad_connection_secrets, public.ad_oauth_pending, public.ad_insights_daily,
  public.ad_connections to service_role;

