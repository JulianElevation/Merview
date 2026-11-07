-- Saca todo lo del portal. No toca MER View (clients, store_daily, meta_daily, etc.).
-- OJO: borra tokens e historial; después habría que reconectar cada tienda.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname in ('tn-reconciliar','meta-sync','tn-limpiar','meta-foto');
  end if;
end $$;
update public.clients set kind = 'leads' where id = 'vanskap';
drop function if exists public.portal_historico(text,text,date,date);
drop function if exists public.portal_b2b_marcar(text,text,boolean);
drop function if exists public.portal_alta_cliente(text,text,boolean,text,text,date,text);
drop function if exists public.portal_reactivar_cliente(text,text,date,text);
drop function if exists public.portal_baja_cliente(text,text,date,text);
drop function if exists public.portal_agencia(text);
drop function if exists public.meta_foto_tomar();
drop table if exists public.meta_foto;
drop table if exists public.client_movimientos;
drop function if exists public.portal_link_cliente(text,text,boolean);
drop function if exists public.portal_mi_tablero(text,date,date,integer,integer);
drop function if exists public.portal_cliente(text,text,date,date,integer,integer);
drop function if exists public.portal_cliente_datos(text,date,date,integer,integer);
drop table if exists public.client_links;
drop function if exists public.portal_general(text,date,date);
drop function if exists public.portal_serie(date,date);
drop function if exists public.portal_b2b(date,date);
drop function if exists public.meta_campanas_upsert(jsonb,jsonb);
drop function if exists public.es_b2b(text);
drop table if exists public.meta_campana_dia;
drop table if exists public.meta_campanas;
alter table public.clients drop column if exists separa_b2b;
drop function if exists public.meta_upsert(jsonb);
drop function if exists public.tn_upsert_buyers(jsonb);
drop function if exists public.tn_upsert_orders(jsonb);
drop function if exists public.tn_cuenta_como_venta(text,text);
delete from public.clients where id in ('citypet','libralatina','cezze','auremworld');
alter table public.clients drop column if exists tn_stores_portal;
drop table if exists public.meta_state;
drop table if exists public.meta_live;
drop table if exists public.tn_buyers;
drop table if exists public.tn_orders;
drop table if exists public.tn_installs;
drop table if exists public.tn_config;
