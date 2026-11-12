-- MS Kompasset – kør notifikationsserveren hvert minut.
-- Kør ÉN gang i Supabase: SQL Editor → New query → indsæt → Run.
-- Erstat ERSTAT_MED_CRON_SECRET med den samme tilfældige tekst, som du gemmer som
-- hemmeligheden CRON_SECRET under Edge Functions → Secrets (se docs/OPSAETNING.md).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Gem hemmeligheden i Supabase Vault (krypteret).
select vault.create_secret('ERSTAT_MED_CRON_SECRET', 'msk_cron_secret', 'Hemmelighed til notify-funktionen');

-- Fjern et evt. tidligere job med samme navn, og opret det igen.
select cron.unschedule('msk-notify') where exists (select 1 from cron.job where jobname = 'msk-notify');
select cron.schedule('msk-notify', '* * * * *', $$
  select net.http_post(
    url := 'https://zkicdizuvkkcjowbvrvj.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'msk_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- Tjek bagefter at jobbet kører (svar fra funktionen):
-- select status_code, content, created from net._http_response order by created desc limit 5;
