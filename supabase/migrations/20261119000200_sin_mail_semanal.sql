-- =====================================================================
-- Mail semanal apagado (nov 2026): hoy es una sola sucursal y todo está en Números y en Hoy.
-- La función weekly-report nunca se publicó, así que el cron de los lunes solo dejaba errores.
-- Para volver a prenderlo (con 2 o más sucursales y Resend configurado), repetir el cron.schedule
-- de 20261103000300_marketing_cron.sql en una migración nueva.
-- =====================================================================

select cron.unschedule('weekly-report') where exists (select 1 from cron.job where jobname = 'weekly-report');
