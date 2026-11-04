-- =====================================================================
-- Verificación automática de transferencias en Mercado Pago (anti comprobante falso).
-- Cada cuenta de cobro de MP se conecta por OAuth (solo lectura). Cuando se carga
-- un cobro en una cuenta conectada se crea un chequeo «pendiente»; la función
-- mp-verify (cada minuto) busca en MP una transferencia entrante por el monto exacto,
-- idealmente del DNI de la paciente, y lo marca verificado. Una transferencia de MP
-- valida un solo cobro.
-- Los chequeos van en tabla aparte (y no en appointment_payments) porque al editar un
-- turno los cobros se borran y se vuelven a crear: el chequeo se reconoce por
-- (turno, cuenta, monto, seña) y sobrevive a esas ediciones. Solo el servidor los escribe.
-- =====================================================================

create table public.mp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  account_id uuid not null,
  mp_user_id text not null,
  mp_nickname text,
  connected_by uuid references auth.users(id) on delete set null,
  token_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (account_id, branch_id)
    references public.payment_accounts(id, branch_id) on delete cascade,
  unique (account_id)
);

alter table public.mp_connections enable row level security;
-- Recepción ve qué cuentas están conectadas; conectar y desconectar lo hace el servidor
-- (con service role) después de verificar que es el franquiciado o la marca.
create policy mp_connections_select on public.mp_connections for select to authenticated
  using (public.can_access_branch(branch_id));

-- Tokens: sin políticas y sin permisos => solo service role
create table public.mp_connection_secrets (
  connection_id uuid primary key references public.mp_connections(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  updated_at timestamptz not null default now()
);
alter table public.mp_connection_secrets enable row level security;
revoke all on public.mp_connection_secrets from anon, authenticated;

create table public.transfer_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  appointment_id uuid not null,
  account_id uuid not null,
  amount numeric(12,2) not null,
  is_deposit boolean not null default false,
  -- pending: esperando que aparezca · verified: llegó · review: hay que mirarlo · not_found: no llegó en 72 h
  status text not null default 'pending' check (status in ('pending', 'verified', 'review', 'not_found')),
  mp_payment_id text unique,
  matched_by text check (matched_by in ('dni', 'amount')),
  transfer_at timestamptz,
  note text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (appointment_id, branch_id)
    references public.appointments(id, branch_id) on delete cascade,
  foreign key (account_id, branch_id)
    references public.payment_accounts(id, branch_id) on delete cascade,
  unique (appointment_id, account_id, amount, is_deposit)
);
create index transfer_checks_pending_idx on public.transfer_checks (account_id) where status = 'pending';

alter table public.transfer_checks enable row level security;
create policy transfer_checks_select on public.transfer_checks for select to authenticated
  using (public.can_access_branch(branch_id));
revoke insert, update, delete on public.transfer_checks from anon, authenticated;

-- Al cargar un cobro en una cuenta de MP conectada se crea su chequeo (si no existía igual)
create or replace function public.enqueue_transfer_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from mp_connections c
     where c.account_id = new.account_id and c.is_active
  ) then
    insert into transfer_checks (organization_id, branch_id, appointment_id, account_id, amount, is_deposit)
    values (new.organization_id, new.branch_id, new.appointment_id, new.account_id, new.amount, new.is_deposit)
    on conflict (appointment_id, account_id, amount, is_deposit) do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.enqueue_transfer_check() from public, anon, authenticated;

create trigger appointment_payments_transfer_check after insert on public.appointment_payments
  for each row execute function public.enqueue_transfer_check();

-- Chequeos cuyo cobro ya no existe (se editó el monto o la cuenta), con 5 minutos de gracia
-- porque al guardar un turno los cobros se borran y se vuelven a crear. Lo llama mp-verify.
create or replace function public.cleanup_transfer_checks()
returns integer language sql security definer set search_path = public as $$
  with gone as (
    delete from transfer_checks tc
     using appointments a
     where a.id = tc.appointment_id
       and a.updated_at < now() - interval '5 minutes'
       and tc.created_at < now() - interval '5 minutes'
       and not exists (
         select 1 from appointment_payments p
          where p.appointment_id = tc.appointment_id
            and p.account_id = tc.account_id
            and p.amount = tc.amount
            and p.is_deposit = tc.is_deposit
       )
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke execute on function public.cleanup_transfer_checks() from public, anon, authenticated;
grant execute on function public.cleanup_transfer_checks() to service_role;
