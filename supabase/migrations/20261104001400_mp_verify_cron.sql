-- ---------------------------------------------------------------------
-- mp-verify cada minuto: busca en Mercado Pago las transferencias de los cobros
-- pendientes de verificar. Si no hay pendientes, la función termina sin llamar a MP.
-- Usa los mismos secretos de Vault que dispatch-events.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname = 'mp-verify';

select cron.schedule(
  'mp-verify',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/mp-verify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
