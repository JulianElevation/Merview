-- Tareas automáticas del portal. Se aplica después de 20261106_portal.sql.
create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.tn_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Tiendanube: reconciliación y carga de historial, cada 5 minutos.
select cron.schedule('tn-reconciliar', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select value from public.tn_config where key = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$job$);

-- Meta: inversión de los últimos 3 días, cada 5 minutos.
select cron.schedule('meta-sync', '2-57/5 * * * *', $job$
  select net.http_post(
    url := 'https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/meta-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select value from public.tn_config where key = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$job$);

-- Se conservan 14 meses de órdenes.
select cron.schedule('tn-limpiar', '30 7 * * *', $job$
  delete from public.tn_orders where created_at < now() - interval '14 months';
$job$);
