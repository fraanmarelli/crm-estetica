-- =====================================================================
-- Pruebas de la plata: cobros (pesos, dólares, seña), insumos, comisión, neto, monotributo,
-- millas y quién ve qué. Cada caso guarda el turno como la app (primero «agendado», después
-- ítems y cobros, al final «atendido»). Corre con: bash supabase/tests/run.sh
-- =====================================================================
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\set QUIET on
begin;

-- Compara con el tipo del dato (830000.00 = 830000) y guarda el texto para mostrarlo si falla
create temp table _r (n serial, label text, ok boolean, got text, expected text);
create function pg_temp.check(p_label text, p_got anyelement, p_expected anyelement) returns void
language sql as $$
  insert into _r (label, ok, got, expected)
  values (p_label, p_got is not distinct from p_expected, p_got::text, p_expected::text)
$$;
\o /dev/null
-- Actuar como un usuario (los permisos y los avisos dependen de quién es)
create function pg_temp.as_user(p_user uuid, p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true),
         set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- ---------------------------------------------------------------------
-- Datos: una red, una sucursal y su equipo
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'marca@prueba.test'),
  ('00000000-0000-0000-0000-00000000aa02', 'franquiciado@prueba.test'),
  ('00000000-0000-0000-0000-00000000aa03', 'recepcion@prueba.test'),
  ('00000000-0000-0000-0000-00000000aa04', 'doctora@prueba.test');
insert into organizations (id, name, slug, loyalty_points_per_1000)
  values ('00000000-0000-0000-0000-0000000000a1', 'Red Prueba', 'red-prueba', 10);
insert into branches (id, organization_id, name)
  values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Centro');
insert into memberships (user_id, organization_id, branch_id, role) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', null, 'network_owner'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'branch_admin'),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'reception'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'professional');
insert into professionals (id, organization_id, branch_id, user_id, full_name, commission_pct) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-00000000aa04', 'Dra. Prueba', 30);
-- Insumos: jeringa de ácido a $50.000, toxina a $2.000 la unidad; la limpieza no usa insumo
insert into supplies (id, organization_id, name, unit, unit_cost) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Jeringa AH', 'jeringa', 50000),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Toxina', 'unidad', 2000);
insert into treatments (id, organization_id, name, supply_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Ácido hialurónico', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Botox', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Limpieza', null);
insert into patients (id, organization_id, home_branch_id, first_name, last_name) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'Ana', 'Prueba');

-- Cuentas de cobro: las genéricas que crea la sucursal nueva; «Mercado Pago» es de una titular con tope
insert into account_holders (id, organization_id, branch_id, name, annual_limit, alert_pct) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   'Titular MP', 1000000, 80)
  on conflict do nothing;
select pg_temp.check('la sucursal nueva arranca con sus cuentas de cobro',
  (select count(*) from payment_accounts where branch_id = '00000000-0000-0000-0000-0000000000b1')::int, 6);
update payment_accounts set holder_id = '00000000-0000-0000-0000-0000000000a9'
 where branch_id = '00000000-0000-0000-0000-0000000000b1' and name = 'Mercado Pago';
select id as efectivo from payment_accounts where branch_id = '00000000-0000-0000-0000-0000000000b1' and name = 'Efectivo' \gset
select id as mp from payment_accounts where branch_id = '00000000-0000-0000-0000-0000000000b1' and name = 'Mercado Pago' \gset
select id as usd from payment_accounts where branch_id = '00000000-0000-0000-0000-0000000000b1' and name = 'Dólares' \gset

-- Lo carga la marca (no genera avisos de cambios)
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa01', 'marca@prueba.test');

-- ---------------------------------------------------------------------
-- 1. Turno en pesos con dos tratamientos y dos formas de pago
-- ---------------------------------------------------------------------
insert into appointments (id, organization_id, branch_id, patient_id, professional_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-10-10 15:00-03');
insert into appointment_items (appointment_id, treatment_id, quantity, price) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 1, 150000),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e2', 20, 100000),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e3', null, 0);
insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000101', :'efectivo', 50000),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000101', :'mp', 200000);
select pg_temp.check('agendado: todavía no tiene comisión',
  (select commission from appointments where id = '00000000-0000-0000-0000-000000000101'), null::numeric);
update appointments set status = 'completed' where id = '00000000-0000-0000-0000-000000000101';

select pg_temp.check('1. cobrado = suma de las partes', (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000101'), 250000::numeric);
select pg_temp.check('1. sin dólares', (select amount_usd from appointments where id = '00000000-0000-0000-0000-000000000101'), null::numeric);
select pg_temp.check('1. forma de pago en el orden de las cuentas',
  (select payment_method from appointments where id = '00000000-0000-0000-0000-000000000101'), 'Efectivo + Mercado Pago');
select pg_temp.check('1. insumo del ácido = 1 jeringa × $50.000',
  (select cost from appointment_items where appointment_id = '00000000-0000-0000-0000-000000000101' and treatment_id = '00000000-0000-0000-0000-0000000000e1'), 50000::numeric);
select pg_temp.check('1. insumo del botox = 20 unidades × $2.000',
  (select cost from appointment_items where appointment_id = '00000000-0000-0000-0000-000000000101' and treatment_id = '00000000-0000-0000-0000-0000000000e2'), 40000::numeric);
select pg_temp.check('1. tratamiento sin insumo: costo vacío (no cero)',
  (select cost from appointment_items where appointment_id = '00000000-0000-0000-0000-000000000101' and treatment_id = '00000000-0000-0000-0000-0000000000e3'), null::numeric);
select pg_temp.check('1. comisión 30% de lo cobrado', (select commission from appointments where id = '00000000-0000-0000-0000-000000000101'), 75000::numeric);
select pg_temp.check('1. millas: 10 por cada $1.000',
  (select sum(points) from loyalty_transactions where appointment_id = '00000000-0000-0000-0000-000000000101')::int, 2500);

-- El insumo queda congelado: si la marca cambia el costo, los turnos ya cargados no cambian
update supplies set unit_cost = 99999 where id = '00000000-0000-0000-0000-0000000000c1';
update appointment_items set price = 160000
 where appointment_id = '00000000-0000-0000-0000-000000000101' and treatment_id = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check('1. costo congelado aunque cambie el precio de venta',
  (select cost from appointment_items where appointment_id = '00000000-0000-0000-0000-000000000101' and treatment_id = '00000000-0000-0000-0000-0000000000e1'), 50000::numeric);
update supplies set unit_cost = 50000 where id = '00000000-0000-0000-0000-0000000000c1';

-- Cobro corregido después de atender: se recalculan total y comisión
update appointment_payments set amount = 60000
 where appointment_id = '00000000-0000-0000-0000-000000000101' and account_id = :'efectivo';
select pg_temp.check('1. cobro corregido: nuevo total', (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000101'), 260000::numeric);
select pg_temp.check('1. cobro corregido: nueva comisión', (select commission from appointments where id = '00000000-0000-0000-0000-000000000101'), 78000::numeric);
select pg_temp.check('1. la marca corrige sin generar aviso de cambios',
  (select count(*) from change_alerts where appointment_id = '00000000-0000-0000-0000-000000000101')::int, 0);

-- ---------------------------------------------------------------------
-- 2. Seña al agendar + resto en pesos y dólares (con y sin cotización)
-- ---------------------------------------------------------------------
insert into appointments (id, organization_id, branch_id, patient_id, professional_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-10-20 11:00-03');
insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount, is_deposit) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000102', :'mp', 30000, true);
select pg_temp.check('2. con la seña cargada, cobrado = seña', (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000102'), 30000::numeric);
select pg_temp.check('2. la seña no da comisión mientras está agendado', (select commission from appointments where id = '00000000-0000-0000-0000-000000000102'), null::numeric);
select pg_temp.check('2. la seña no da millas mientras está agendado',
  (select count(*) from loyalty_transactions where appointment_id = '00000000-0000-0000-0000-000000000102')::int, 0);

insert into appointment_items (appointment_id, treatment_id, quantity, price) values
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e1', 2, 210000);
insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount, exchange_rate) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000102', :'usd', 100, 1200),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000102', :'usd', 50, null);
update appointments set status = 'completed' where id = '00000000-0000-0000-0000-000000000102';

select pg_temp.check('2. cobrado = seña + dólares cotizados (los sin cotización no suman)',
  (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000102'), 150000::numeric);
select pg_temp.check('2. dólares = todos los dólares', (select amount_usd from appointments where id = '00000000-0000-0000-0000-000000000102'), 150::numeric);
select pg_temp.check('2. forma de pago: la seña primero',
  (select payment_method like 'Seña Mercado Pago + %' from appointments where id = '00000000-0000-0000-0000-000000000102'), true);
select pg_temp.check('2. forma de pago: los dólares con su cotización (o sin)',
  (select payment_method like '%Dólares (US$ 100 a $1200)%' and payment_method like '%Dólares (US$ 50 sin cotización)%'
     from appointments where id = '00000000-0000-0000-0000-000000000102'), true);
select pg_temp.check('2. comisión sobre lo cobrado en pesos', (select commission from appointments where id = '00000000-0000-0000-0000-000000000102'), 45000::numeric);
select pg_temp.check('2. insumo: 2 jeringas', (select sum(cost) from appointment_items where appointment_id = '00000000-0000-0000-0000-000000000102'), 100000::numeric);

-- Comisión a mano (marca/franquiciado): no la pisa una corrección del cobro; vacía vuelve a ser automática
do $$ begin perform set_commission('00000000-0000-0000-0000-000000000102', 10000); end $$;
update appointment_payments set exchange_rate = 1300
 where appointment_id = '00000000-0000-0000-0000-000000000102' and account_id = :'usd' and exchange_rate = 1200;
select pg_temp.check('2. comisión a mano se mantiene', (select commission from appointments where id = '00000000-0000-0000-0000-000000000102'), 10000::numeric);
do $$ begin perform set_commission('00000000-0000-0000-0000-000000000102', null); end $$;
update appointment_payments set exchange_rate = 1200
 where appointment_id = '00000000-0000-0000-0000-000000000102' and account_id = :'usd' and exchange_rate = 1300;
select pg_temp.check('2. comisión vuelve a ser automática', (select commission from appointments where id = '00000000-0000-0000-0000-000000000102'), 45000::numeric);

-- ---------------------------------------------------------------------
-- 3. Turno del 31 a la noche registrado al día siguiente: cuenta en octubre en todas las pantallas
--    (01:00 UTC del 1/11 = 22:00 del 31/10 en Argentina)
-- ---------------------------------------------------------------------
insert into appointments (id, organization_id, branch_id, patient_id, professional_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '2026-11-01 01:00+00');
insert into appointment_items (appointment_id, treatment_id, quantity, price) values
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000e3', null, 600000);
insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000103', :'mp', 600000);
update appointments set status = 'completed', completed_at = '2026-11-01 10:00-03'
 where id = '00000000-0000-0000-0000-000000000103';

-- Ventas de octubre (como la marca)
select branch_financials('00000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31') as oct \gset
select branch_financials('00000000-0000-0000-0000-0000000000b1', '2026-11-01', '2026-11-30') as nov \gset
select pg_temp.check('Ventas octubre: turnos', (:'oct'::jsonb ->> 'turnos')::int, 3);
select pg_temp.check('Ventas octubre: facturado', (:'oct'::jsonb ->> 'facturado')::numeric, 1010000::numeric);
select pg_temp.check('Ventas octubre: insumos', (:'oct'::jsonb ->> 'costo')::numeric, 190000::numeric);
select pg_temp.check('Ventas octubre: comisión', (:'oct'::jsonb ->> 'comision')::numeric, 303000::numeric);
select pg_temp.check('Ventas octubre: neto = facturado − insumos − comisión', (:'oct'::jsonb ->> 'ingreso_neto')::numeric, 517000::numeric);
select pg_temp.check('Ventas octubre: dólares', (:'oct'::jsonb ->> 'dolares')::numeric, 150::numeric);
select pg_temp.check('Ventas octubre: dólares sin cotizar', (:'oct'::jsonb ->> 'dolares_sin_cotizar')::numeric, 50::numeric);
select pg_temp.check('Ventas octubre: ítems sin insumo', (:'oct'::jsonb ->> 'items_sin_costo')::int, 2);
select pg_temp.check('Ventas noviembre: el turno del 31 no aparece', (:'nov'::jsonb ->> 'turnos')::int, 0);
select pg_temp.check('Ventas octubre: por profesional suma lo mismo',
  (select sum((x ->> 'facturado')::numeric) from jsonb_array_elements(:'oct'::jsonb -> 'por_profesional') x), 1010000::numeric);
select pg_temp.check('Ventas octubre: por cuenta (Mercado Pago)',
  (select (x ->> 'monto')::numeric from jsonb_array_elements(:'oct'::jsonb -> 'por_cuenta') x where x ->> 'cuenta' = 'Mercado Pago'), 830000::numeric);

select pg_temp.check('Comisiones octubre: misma comisión que Ventas',
  (select sum(commission) from professional_commissions('00000000-0000-0000-0000-0000000000b1', null, '2026-10-01', '2026-10-31')),
  303000::numeric);
select pg_temp.check('Comisiones noviembre: vacío',
  (select count(*) from professional_commissions('00000000-0000-0000-0000-0000000000b1', null, '2026-11-01', '2026-11-30'))::int, 0);

select pg_temp.check('Facturación octubre: Mercado Pago',
  (select total_ars from billing_by_account('00000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31') where account_name = 'Mercado Pago'),
  830000::numeric);
select pg_temp.check('Facturación octubre: dólares en pesos (solo los cotizados)',
  (select total_ars from billing_by_account('00000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31') where account_name = 'Dólares'),
  120000::numeric);
select pg_temp.check('Facturación octubre: dólares en dólares (todos)',
  (select total_usd from billing_by_account('00000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31') where account_name = 'Dólares'),
  150::numeric);
select pg_temp.check('Facturación noviembre: vacío',
  (select sum(total_ars) from billing_by_account('00000000-0000-0000-0000-0000000000b1', '2026-11-01', '2026-11-30')), 0::numeric);

-- Monotributo: solo cuentan las cuentas con titular; $830.000 de $1.000.000 con alerta al 80% = aviso
select pg_temp.check('Monotributo octubre: lo del mes',
  (select month_total from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-10-01')), 830000::numeric);
select pg_temp.check('Monotributo octubre: últimos 12 meses',
  (select last12_total from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-10-01')), 830000::numeric);
select pg_temp.check('Monotributo octubre: pasó el 80% del tope → aviso',
  (select level from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-10-01')), 'warn');
select pg_temp.check('Monotributo noviembre: el mes arranca en cero',
  (select month_total from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-11-01')), 0::numeric);
select pg_temp.check('Monotributo noviembre: los 12 meses siguen sumando octubre',
  (select last12_total from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-11-01')), 830000::numeric);
insert into appointment_payments (organization_id, branch_id, appointment_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000103', :'mp', 170000);
select pg_temp.check('Monotributo: al llegar al tope pasa a «over»',
  (select level from holder_status('00000000-0000-0000-0000-0000000000b1', '2026-10-01')), 'over');
delete from appointment_payments
 where appointment_id = '00000000-0000-0000-0000-000000000103' and amount = 170000;
select pg_temp.check('Borrar una parte del cobro recalcula el total',
  (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000103'), 600000::numeric);

-- ---------------------------------------------------------------------
-- 4. Quién ve y quién corrige
-- ---------------------------------------------------------------------
-- Recepción corrige el cobro de un turno ya atendido: queda el aviso con antes y después
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa03', 'recepcion@prueba.test');
set local role authenticated;
update appointment_payments set amount = 65000
 where appointment_id = '00000000-0000-0000-0000-000000000101' and account_id = :'efectivo';
reset role;
select pg_temp.check('Recepción corrige un cobro atendido: el total cambia',
  (select amount_paid from appointments where id = '00000000-0000-0000-0000-000000000101'), 265000::numeric);
select pg_temp.check('Recepción corrige un cobro atendido: queda un aviso',
  (select count(*) from change_alerts where appointment_id = '00000000-0000-0000-0000-000000000101' and kind = 'payment_edited')::int, 1);
select pg_temp.check('El aviso guarda el total de antes',
  (select (before ->> 'total')::numeric from change_alerts where appointment_id = '00000000-0000-0000-0000-000000000101'), 260000::numeric);
select pg_temp.check('El aviso guarda el total de después',
  (select (after ->> 'total')::numeric from change_alerts where appointment_id = '00000000-0000-0000-0000-000000000101'), 265000::numeric);

-- Recepción y profesional no ven costos ni comisiones (ni con la API)
do $$
begin
  perform set_config('t.costo', 'visible', true);
  set local role authenticated;
  begin
    perform cost from appointment_items limit 1;
  exception when insufficient_privilege then
    perform set_config('t.costo', 'oculto', true);
  end;
  reset role;
end $$;
select pg_temp.check('Recepción no puede leer el costo de los ítems', current_setting('t.costo'), 'oculto');
do $$
begin
  perform set_config('t.comision', 'visible', true);
  set local role authenticated;
  begin
    perform commission from appointments limit 1;
  exception when insufficient_privilege then
    perform set_config('t.comision', 'oculto', true);
  end;
  reset role;
end $$;
select pg_temp.check('Recepción no puede leer la comisión', current_setting('t.comision'), 'oculto');

do $$
begin
  perform set_config('t.ventas', 'visible', true);
  begin
    perform branch_financials('00000000-0000-0000-0000-0000000000b1', '2026-10-01', '2026-10-31');
  exception when others then
    perform set_config('t.ventas', 'bloqueado', true);
  end;
  perform set_config('t.carga', 'pudo', true);
  begin
    perform set_commission('00000000-0000-0000-0000-000000000101', 1);
  exception when others then
    perform set_config('t.carga', 'no pudo', true);
  end;
end $$;
select pg_temp.check('Recepción no ve Ventas', current_setting('t.ventas'), 'bloqueado');
select pg_temp.check('Recepción no carga comisiones a mano', current_setting('t.carga'), 'no pudo');

-- La profesional ve sus comisiones, no las de otras
select pg_temp.as_user('00000000-0000-0000-0000-00000000aa04', 'doctora@prueba.test');
select pg_temp.check('La profesional ve sus comisiones de octubre',
  (select sum(commission) from professional_commissions('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', '2026-10-01', '2026-10-31')),
  (select sum(commission) from appointments where professional_id = '00000000-0000-0000-0000-0000000000d1'
     and status = 'completed' and scheduled_at < '2026-11-01 00:00-03'));
do $$
begin
  perform set_config('t.todas', 'visible', true);
  begin
    perform professional_commissions('00000000-0000-0000-0000-0000000000b1', null, '2026-10-01', '2026-10-31');
  exception when others then
    perform set_config('t.todas', 'bloqueado', true);
  end;
end $$;
select pg_temp.check('La profesional no ve las comisiones de todas', current_setting('t.todas'), 'bloqueado');

-- ---------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------
\o
select case when ok then '  ✓ ' || label
            else '  ✕ ' || label || '  (dio ' || coalesce(got, 'vacío') || ', se esperaba ' || coalesce(expected, 'vacío') || ')' end
  from _r order by n;
select format('%s de %s bien', count(*) filter (where ok), count(*)) from _r;
do $$
begin
  if exists (select 1 from _r where not ok) then
    raise exception 'Hay cuentas que no dan';
  end if;
end $$;
rollback;
