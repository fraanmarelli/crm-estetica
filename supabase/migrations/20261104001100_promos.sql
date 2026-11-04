-- =====================================================================
-- Promos: un tratamiento a precio fijo o un combo de varios tratamientos
-- con precio total. La marca crea promos para toda la red (branch_id null)
-- o para una sucursal; el franquiciado, solo para la suya.
-- Al elegir una promo en el turno, el precio se precarga (se puede cambiar)
-- y cada ítem queda marcado con la promo (columna «Promo» de la planilla).
-- =====================================================================

alter table public.treatments
  add constraint treatments_id_org_key unique (id, organization_id);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,                                  -- null = toda la red
  name text not null check (length(trim(name)) > 0),
  price numeric(12,2) not null check (price >= 0),
  valid_until date,                                -- null = sin vencimiento
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create index promotions_org_idx on public.promotions (organization_id, branch_id);

create table public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  promotion_id uuid not null,
  treatment_id uuid not null,
  zone text,
  sort_order integer not null default 0,
  foreign key (promotion_id, organization_id)
    references public.promotions(id, organization_id) on delete cascade,
  foreign key (treatment_id, organization_id)
    references public.treatments(id, organization_id)
);
create index promotion_items_promo_idx on public.promotion_items (promotion_id);

-- Quién puede crear o pausar una promo
create or replace function public.can_manage_promotion(p_org uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_branch is null then public.has_network_access(p_org)
    else public.is_branch_admin(p_branch)
  end;
$$;
revoke execute on function public.can_manage_promotion(uuid, uuid) from public, anon;
grant execute on function public.can_manage_promotion(uuid, uuid) to authenticated;

alter table public.promotions enable row level security;
create policy promotions_select on public.promotions for select to authenticated
  using (public.is_org_member(organization_id)
         and (branch_id is null or public.can_access_branch(branch_id)));
create policy promotions_insert on public.promotions for insert to authenticated
  with check (public.can_manage_promotion(organization_id, branch_id));
create policy promotions_update on public.promotions for update to authenticated
  using (public.can_manage_promotion(organization_id, branch_id))
  with check (public.can_manage_promotion(organization_id, branch_id));
create policy promotions_delete on public.promotions for delete to authenticated
  using (public.can_manage_promotion(organization_id, branch_id));

alter table public.promotion_items enable row level security;
create policy promotion_items_select on public.promotion_items for select to authenticated
  using (exists (select 1 from public.promotions p where p.id = promotion_id));
create policy promotion_items_write on public.promotion_items for all to authenticated
  using (exists (select 1 from public.promotions p
                  where p.id = promotion_id
                    and public.can_manage_promotion(p.organization_id, p.branch_id)))
  with check (exists (select 1 from public.promotions p
                       where p.id = promotion_id
                         and p.organization_id = promotion_items.organization_id
                         and public.can_manage_promotion(p.organization_id, p.branch_id)));

-- ---------------------------------------------------------------------
-- Cada ítem del turno puede venir de una promo
-- ---------------------------------------------------------------------
alter table public.appointment_items
  add column promotion_id uuid references public.promotions(id) on delete set null;
-- appointment_items tiene permisos por columna (el costo no es legible): se habilita la nueva
grant select (promotion_id) on public.appointment_items to authenticated;

create or replace function public.check_item_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.promotion_id is not null and not exists (
    select 1
      from appointments a
      join promotions p on p.organization_id = a.organization_id
     where a.id = new.appointment_id
       and p.id = new.promotion_id
       and (p.branch_id is null or p.branch_id = a.branch_id)
  ) then
    raise exception 'La promo no corresponde a la sucursal del turno';
  end if;
  return new;
end $$;

create trigger appointment_items_promotion before insert or update on public.appointment_items
  for each row execute function public.check_item_promotion();

-- ---------------------------------------------------------------------
-- Lo que sale a la planilla: se suma la columna «Promo» y la promo de cada ítem
-- ---------------------------------------------------------------------
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
             where ai.appointment_id = a.id) as promos_text
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
    'items',            coalesce((
                          select jsonb_agg(jsonb_build_object(
                            'tratamiento_id', t.id,
                            'tratamiento', t.name,
                            'categoria', t.category,
                            'zona', ai.zone,
                            'cantidad', ai.quantity,
                            'precio', ai.price,
                            'promo', pm.name,
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
