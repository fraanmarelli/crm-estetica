-- =====================================================================
-- Revisión de leads cada 5 minutos (además del webhook).
-- Mientras la app de Meta no esté publicada, Meta no manda los avisos de
-- formularios reales; la función leads-sync los busca con el token de cada
-- página. Cuando la app se publique, el webhook los trae al instante y esta
-- revisión queda como respaldo (no duplica: el lead es único por id de Meta).
-- =====================================================================

alter table public.lead_pages add column last_synced_at timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname = 'leads-sync';

select cron.schedule(
  'leads-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/leads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
