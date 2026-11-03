-- =====================================================================
-- Cada minuto llama a la Edge Function "dispatch-events", que envía
-- los eventos pendientes (por ahora: turnos -> Google Sheets).
--
-- Requiere dos secretos en Vault (ver README, paso 6):
--   project_url     -> https://<tu-proyecto>.supabase.co
--   dispatch_secret -> la misma clave que DISPATCH_SECRET de la función
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('dispatch-events')
 where exists (select 1 from cron.job where jobname = 'dispatch-events');

select cron.schedule(
  'dispatch-events',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/dispatch-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from public.event_outbox where status = 'pending' and next_attempt_at <= now());
  $$
);
