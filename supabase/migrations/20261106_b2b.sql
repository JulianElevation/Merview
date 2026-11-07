-- Campañas B2B o de mensajes: en los clientes marcados, se separan de la inversión de la tienda.
-- Se reconocen por el nombre en Meta: (B2B) o (MSJ). El MER tienda no las cuenta; la inversión total sigue completa.
alter table public.clients add column if not exists separa_b2b boolean not null default false;

create table if not exists public.meta_campanas (
  campaign_id text primary key,
  account_id text not null,
  name text not null,
  objective text,
  updated_at timestamptz not null default now()
);
create table if not exists public.meta_campana_dia (
  day date not null,
  campaign_id text not null,
  account_id text not null,
  currency text,
  spend numeric not null default 0,
  messages numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, campaign_id)
);
create index if not exists meta_campana_dia_cuenta_idx on public.meta_campana_dia (account_id, day);
alter table public.meta_campanas enable row level security;
alter table public.meta_campana_dia enable row level security;
revoke all on table public.meta_campanas from public, anon, authenticated;
revoke all on table public.meta_campana_dia from public, anon, authenticated;
alter table public.meta_state add column if not exists campanas_historia boolean not null default false;
alter table public.meta_state add column if not exists campanas_error text;

create or replace function public.es_b2b(p_nombre text)
returns boolean language sql immutable as $$
  select coalesce(p_nombre operator(pg_catalog.~*) '\(\s*(b2b|msj)\s*\)', false)
$$;
revoke all on function public.es_b2b(text) from public, anon, authenticated;

create or replace function public.meta_campanas_upsert(p_campanas jsonb, p_filas jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  insert into public.meta_campanas (campaign_id, account_id, name, objective, updated_at)
  select x.campaign_id, x.account_id, x.name, x.objective, now()
  from jsonb_to_recordset(p_campanas) as x(campaign_id text, account_id text, name text, objective text)
  on conflict (campaign_id) do update set name = excluded.name, objective = excluded.objective, account_id = excluded.account_id, updated_at = now();
  insert into public.meta_campana_dia (day, campaign_id, account_id, currency, spend, messages, updated_at)
  select x.day, x.campaign_id, x.account_id, x.currency, x.spend, x.messages, now()
  from jsonb_to_recordset(p_filas) as x(day date, campaign_id text, account_id text, currency text, spend numeric, messages numeric)
  on conflict (day, campaign_id) do update set currency = excluded.currency, spend = excluded.spend, messages = excluded.messages, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.meta_campanas_upsert(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.meta_campanas_upsert(jsonb,jsonb) to service_role;

-- Inversión y conversaciones de las campañas etiquetadas, por cliente marcado y día.
create or replace function public.portal_b2b(p_since date, p_until date)
returns table (client_id text, day date, spend_ars numeric, messages numeric)
language sql stable security definer set search_path to '' as $$
  select c.id, d.day,
    sum(case when d.currency = 'USD' then d.spend * (select coalesce((select value::numeric from public.settings where key = 'usd_ars'), 1)) else d.spend end),
    sum(d.messages)
  from public.clients c
  cross join lateral unnest(c.meta_accounts) as a(account_id)
  join public.meta_campana_dia d on d.account_id = a.account_id and d.day between p_since and p_until
  join public.meta_campanas n on n.campaign_id = d.campaign_id and public.es_b2b(n.name)
  where c.active and c.separa_b2b
  group by 1,2
$$;
revoke all on function public.portal_b2b(date,date) from public, anon, authenticated;

create or replace function public.portal_b2b_marcar(p_key text, p_client text, p_marcado boolean)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  update public.clients set separa_b2b = p_marcado where id = p_client and active;
  if not found then raise exception 'cliente_inexistente'; end if;
end $$;
revoke all on function public.portal_b2b_marcar(text,text,boolean) from public;
grant execute on function public.portal_b2b_marcar(text,text,boolean) to anon, authenticated;

create or replace function public.portal_general(p_key text, p_since date, p_until date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_len integer := p_until - p_since + 1;
  v_res jsonb;
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  if p_until - p_since > 400 or p_until < p_since then raise exception 'rango_invalido'; end if;

  with s as (select * from public.portal_serie(p_since, p_until)),
  prev as (select * from public.portal_serie((p_since - v_len)::date, (p_since - 1)::date)),
  activos as (
    select distinct client_id from public.portal_serie((current_date - 30)::date, current_date) where spend_ars > 0
  ),
  b2b as (select client_id, sum(spend_ars) as spend, sum(messages) as messages from public.portal_b2b(p_since, p_until) group by 1),
  por_cliente as (
    select c.id, c.name, c.kind, c.separa_b2b,
      coalesce((select b.spend from b2b b where b.client_id = c.id),0) as spend_b2b,
      coalesce((select b.messages from b2b b where b.client_id = c.id),0) as messages_b2b, c.tn_stores || c.tn_stores_portal as tn_stores, c.woo_shops, c.meta_accounts,
      coalesce(sum(s.revenue),0) as revenue, sum(s.orders)::bigint as orders,
      coalesce(sum(s.spend_ars),0) as spend, coalesce(sum(s.messages),0) as messages,
      exists (select 1 from activos a where a.client_id = c.id) as activo,
      (select count(*) from unnest(c.tn_stores || c.tn_stores_portal) t(store_id) join public.tn_installs i on i.store_id = t.store_id
        where i.access_token is not null and i.coverage_from is not null) as tiendas_vivo,
      (select max(i.last_error) from unnest(c.tn_stores || c.tn_stores_portal) t(store_id) join public.tn_installs i on i.store_id = t.store_id) as error_tienda
    from public.clients c left join s on s.client_id = c.id
    where c.active
    group by c.id
  ),
  dias as (
    select s.day, sum(s.revenue) as revenue, sum(s.orders)::bigint as orders, sum(s.spend_ars) as spend
    from s join public.clients c on c.id = s.client_id
    where c.kind <> 'leads' group by 1
  )
  select jsonb_build_object(
    'ahora', now(),
    'app_id', (select value from public.tn_config where key = 'app_id'),
    'clientes', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from por_cliente p), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from dias d), '[]'::jsonb),
    'prev', (select jsonb_build_object('revenue', coalesce(sum(p.revenue),0), 'spend', coalesce(sum(p.spend_ars),0))
             from prev p join public.clients c on c.id = p.client_id where c.kind <> 'leads'),
    'estado', jsonb_build_object(
      'tn_ultima_venta', (select max(received_at) from public.tn_orders),
      'tn_ultima_sync', (select max(last_sync_at) from public.tn_installs),
      'meta_ultima_sync', (select max(last_ok_at) from public.meta_state),
      'meta_errores', (select count(*) from public.meta_state where last_error is not null),
      'mm_ultima_sync', (select max(ran_at) from public.sync_runs)
    )
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.portal_general(text,date,date) from public;
grant execute on function public.portal_general(text,date,date) to anon, authenticated;

create or replace function public.portal_cliente_datos(p_client text, p_since date, p_until date, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_stores text[];
  v_res jsonb;
begin
  if p_until - p_since > 400 or p_until < p_since then raise exception 'rango_invalido'; end if;
  select c.tn_stores || c.tn_stores_portal into v_stores from public.clients c where c.id = p_client and c.active;
  if v_stores is null then raise exception 'cliente_inexistente'; end if;

  with ord as (
    select o.*, public.tn_cuenta_como_venta(o.payment_status, o.status) as venta,
      case when o.buyer_hash is null then null
           when b.first_paid_at is null or o.created_at <= b.first_paid_at then 'Nuevo' else 'Recurrente' end as tipo
    from public.tn_orders o
    left join public.tn_buyers b on b.store_id = o.store_id and b.buyer_hash = o.buyer_hash
    where o.store_id = any(v_stores) and o.dia between p_since and p_until
  ),
  ventas as (select * from ord where venta),
  por_dia as (
    select dia as day, count(*) filter (where tipo = 'Nuevo') as nuevos, count(*) filter (where tipo = 'Recurrente') as recurrentes
    from ventas group by 1
  ),
  serie as (
    select s.day, s.revenue, s.orders, s.spend_ars as spend, s.messages, d.nuevos, d.recurrentes,
      coalesce(b.spend_ars,0) as spend_b2b, coalesce(b.messages,0) as messages_b2b
    from public.portal_serie(p_since, p_until) s left join por_dia d on d.day = s.day
    left join public.portal_b2b(p_since, p_until) b on b.client_id = s.client_id and b.day = s.day
    where s.client_id = p_client
  ),
  prev_b2b as (
    select coalesce(sum(b.spend_ars),0) as spend from public.portal_b2b((p_since - (p_until - p_since + 1))::date, (p_since - 1)::date) b where b.client_id = p_client
  ),
  campanas as (
    select d.campaign_id, coalesce(n.name, d.campaign_id) as nombre, n.objective,
      sum(case when d.currency = 'USD' then d.spend * (select coalesce((select value::numeric from public.settings where key = 'usd_ars'), 1)) else d.spend end) as spend,
      sum(d.messages) as messages
    from public.meta_campana_dia d left join public.meta_campanas n on n.campaign_id = d.campaign_id
    where d.day between p_since and p_until
      and d.account_id = any(coalesce((select c.meta_accounts from public.clients c where c.id = p_client and c.separa_b2b), '{}'::text[]))
    group by 1,2,3 having sum(d.spend) > 0
  ),
  prev_serie as (
    select coalesce(sum(s.revenue),0) as revenue, sum(s.orders)::bigint as orders,
           coalesce(sum(s.spend_ars),0) as spend, coalesce(sum(s.messages),0) as messages
    from public.portal_serie((p_since - (p_until - p_since + 1))::date, (p_since - 1)::date) s
    where s.client_id = p_client
  ),
  prev_ord as (
    select coalesce(sum(o.unidades),0) as unidades,
      count(*) filter (where o.buyer_hash is not null and (b.first_paid_at is null or o.created_at <= b.first_paid_at)) as nuevos
    from public.tn_orders o
    left join public.tn_buyers b on b.store_id = o.store_id and b.buyer_hash = o.buyer_hash
    where o.store_id = any(v_stores) and o.dia between (p_since - (p_until - p_since + 1))::date and (p_since - 1)::date
      and public.tn_cuenta_como_venta(o.payment_status, o.status)
  ),
  productos as (
    select regexp_replace(coalesce(i.item->>'n','Sin nombre'), '\s*\([^)]*\)\s*$', '') as nombre,
      sum(coalesce((i.item->>'q')::numeric,0)) as unidades,
      sum(coalesce((i.item->>'q')::numeric,0) * coalesce((i.item->>'p')::numeric,0)) as total
    from ventas v cross join lateral jsonb_array_elements(case when jsonb_typeof(v.items) = 'array' then v.items else '[]'::jsonb end) as i(item)
    group by 1
  ),
  mes_ord as (
    select to_char(o.dia,'YYYY-MM') as mes, o.total, o.payment_method, o.installments,
      case when o.buyer_hash is null then null
           when b.first_paid_at is null or o.created_at <= b.first_paid_at then 'Nuevo' else 'Recurrente' end as tipo
    from public.tn_orders o
    left join public.tn_buyers b on b.store_id = o.store_id and b.buyer_hash = o.buyer_hash
    where o.store_id = any(v_stores)
      and o.dia >= (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') - interval '11 months')::date
      and public.tn_cuenta_como_venta(o.payment_status, o.status)
  )
  select jsonb_build_object(
    'ahora', now(),
    'cliente', (select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'separa_b2b',c.separa_b2b,'tn_stores',c.tn_stores || c.tn_stores_portal,'woo_shops',c.woo_shops,'meta_accounts',c.meta_accounts)
                from public.clients c where c.id = p_client),
    'tiendas', coalesce((select jsonb_agg(jsonb_build_object('store_id',t.store_id,'conectada',i.access_token is not null,
                  'coverage_from',i.coverage_from,'buyers_done',coalesce(i.buyers_done,false),'last_sync_at',i.last_sync_at,'last_webhook_at',i.last_webhook_at,'last_error',i.last_error))
                from unnest(v_stores) t(store_id) left join public.tn_installs i on i.store_id = t.store_id), '[]'::jsonb),
    'meta_sync', (select max(m.last_ok_at) from public.meta_state m join public.clients c on c.id = p_client and m.account_id = any(c.meta_accounts)),
    'dias', coalesce((select jsonb_agg(to_jsonb(s) order by s.day) from serie s), '[]'::jsonb),
    'pendiente', (select jsonb_build_object('total',coalesce(sum(total),0),'ordenes',count(*)) from ord where payment_status in ('pending','partially_paid') and coalesce(status,'') <> 'cancelled'),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select tipo as k, count(*) n, sum(total) t from ventas where tipo is not null group by 1) x), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(payment_method,'sin_dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'pasarelas', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(gateway,'Sin dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'cuotas', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by k) from (select coalesce(installments,1) as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'envios', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(shipping_option,'Sin dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'campanas', coalesce((select jsonb_agg(jsonb_build_object('id',x.campaign_id,'nombre',x.nombre,'objetivo',x.objective,'spend',x.spend,'messages',x.messages,
        'b2b',public.es_b2b(x.nombre),
        -- Pista para no olvidarse la etiqueta: objetivo que no es de ventas, o muchas conversaciones.
        'parece_mensajes',not public.es_b2b(x.nombre) and (coalesce(x.objective,'') <> 'OUTCOME_SALES' or x.messages >= 100)) order by x.spend desc) from campanas x), '[]'::jsonb),
    'unidades', (select coalesce(sum(unidades),0) from ventas),
    'prev', (select jsonb_build_object('revenue',p.revenue,'orders',p.orders,'spend',p.spend,'spend_b2b',(select spend from prev_b2b),'messages',p.messages,
                'unidades',(select unidades from prev_ord),'nuevos',(select nuevos from prev_ord)) from prev_serie p),
    'productos', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from productos order by unidades desc, total desc limit 15) x), '[]'::jsonb),
    'meses', coalesce((select jsonb_agg(to_jsonb(x) order by x.mes) from (
        select mes, count(*) as ventas, sum(total) as revenue,
          count(*) filter (where tipo = 'Nuevo') as nuevos, count(*) filter (where tipo = 'Recurrente') as recurrentes
        from mes_ord group by mes) x), '[]'::jsonb),
    'meses_pagos', coalesce((select jsonb_agg(jsonb_build_object('mes',mes,'k',k,'ventas',n)) from (
        select mes, coalesce(payment_method,'sin_dato') as k, count(*) as n from mes_ord group by 1,2) x), '[]'::jsonb),
    'meses_cuotas', coalesce((select jsonb_agg(jsonb_build_object('mes',mes,'k',k,'ventas',n)) from (
        select mes, coalesce(installments,1) as k, count(*) as n from mes_ord group by 1,2) x), '[]'::jsonb),
    'ordenes_total', (select count(*) from ord),
    'ordenes', coalesce((select jsonb_agg(to_jsonb(p)) from (
        select o.number, o.total, o.currency, o.payment_status, o.status, o.created_at, o.paid_at, o.gateway, o.payment_method,
               o.installments, o.shipping_option, o.unidades, o.items, o.discount, o.tipo
        from ord o order by o.created_at desc limit least(p_limit, 500) offset greatest(p_offset, 0)) p), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.portal_cliente_datos(text,date,date,integer,integer) from public, anon, authenticated;

create or replace function public.portal_agencia(p_key text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_foto timestamptz;
  v_desde date;
  v_hora integer := extract(hour from now() at time zone 'America/Argentina/Buenos_Aires');
  v_res jsonb;
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  select max(f.tomada_at) into v_foto from public.meta_foto f
    where f.tomada_at between now() - interval '13 hours' and now() - interval '12 hours';
  v_desde := (v_foto at time zone 'America/Argentina/Buenos_Aires')::date - 1;

  with s as (select * from public.portal_serie((v_hoy - 30)::date, v_hoy)),
  por as (
    select s.client_id,
      coalesce(sum(s.spend_ars) filter (where s.day = v_hoy),0) as inv_hoy,
      coalesce(sum(s.spend_ars) filter (where s.day = v_hoy - 1),0) as inv_ayer,
      coalesce(sum(s.spend_ars),0) as inv_30,
      coalesce(sum(s.revenue) filter (where s.day > v_hoy - 7),0) as fac_7,
      coalesce(sum(s.revenue) filter (where s.day <= v_hoy - 7 and s.day > v_hoy - 14),0) as fac_7_prev,
      coalesce(sum(s.spend_ars) filter (where s.day > v_hoy - 7),0) as inv_7,
      coalesce(sum(s.spend_ars) filter (where s.day <= v_hoy - 7 and s.day > v_hoy - 14),0) as inv_7_prev
    from s group by 1
  ),
  b7 as (select b.client_id,
      coalesce(sum(b.spend_ars) filter (where b.day > v_hoy - 7),0) as ahora,
      coalesce(sum(b.spend_ars) filter (where b.day <= v_hoy - 7),0) as antes
    from public.portal_b2b((v_hoy - 13)::date, v_hoy) b group by 1),
  tiendas as (
    select c.id as client_id, t.store_id
    from public.clients c cross join lateral unnest(c.tn_stores || c.tn_stores_portal) as t(store_id)
    join public.tn_installs i on i.store_id = t.store_id and i.access_token is not null and i.coverage_from is not null
    where c.active
  ),
  ventas as (
    select t.client_id, max(o.dia) as ult_venta
    from tiendas t join public.tn_orders o on o.store_id = t.store_id
    where public.tn_cuenta_como_venta(o.payment_status, o.status)
    group by 1
  ),
  vivas as (select client_id, count(*) as n from tiendas group by 1),
  -- Solo cuentas que Meta está leyendo bien: si no, no se puede afirmar que no gastaron.
  cuentas as (
    select c.id as client_id, a.account_id
    from public.clients c cross join lateral unnest(c.meta_accounts) as a(account_id)
    join public.meta_state m on m.account_id = a.account_id and m.last_error is null and m.last_ok_at > now() - interval '1 hour'
    where c.active
  ),
  doce as (
    select c.client_id,
      sum(coalesce((select sum(l.spend) from public.meta_live l where l.account_id = c.account_id and l.day >= v_desde),0)
        - coalesce((select sum(f.spend) from public.meta_foto f where f.account_id = c.account_id and f.tomada_at = v_foto),0)) as gasto
    from cuentas c where v_foto is not null group by 1
  ),
  medibles as (select distinct client_id from cuentas)
  select jsonb_build_object(
    'ahora', now(),
    'gasto_medible', v_foto is not null or v_hora >= 12,
    'clientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'kind', c.kind,
        'con_meta', cardinality(c.meta_accounts) > 0,
        'inv_hoy', coalesce(p.inv_hoy,0), 'inv_ayer', coalesce(p.inv_ayer,0), 'inv_30', coalesce(p.inv_30,0),
        'fac_7', coalesce(p.fac_7,0), 'fac_7_prev', coalesce(p.fac_7_prev,0), 'inv_7', coalesce(p.inv_7,0) - coalesce(b.ahora,0), 'inv_7_prev', coalesce(p.inv_7_prev,0) - coalesce(b.antes,0),
        'tiendas_vivas', coalesce(v.n,0), 'ult_venta', u.ult_venta, 'dias_sin_venta', v_hoy - u.ult_venta,
        -- Con foto: el gasto no se movió en 12 horas. Sin foto, después del mediodía: hoy sigue en cero.
        'sin_gasto_12h', m.client_id is not null and (case when v_foto is not null then coalesce(o.gasto, 0) <= 0 else v_hora >= 12 and coalesce(p.inv_hoy,0) <= 0 end)
      ) order by c.name)
      from public.clients c
      left join por p on p.client_id = c.id
      left join b7 b on b.client_id = c.id
      left join vivas v on v.client_id = c.id
      left join ventas u on u.client_id = c.id
      left join doce o on o.client_id = c.id
      left join medibles m on m.client_id = c.id
      where c.active), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'client_id', x.client_id, 'name', x.name, 'tipo', x.tipo, 'fecha', x.fecha, 'motivo', x.motivo) order by x.fecha desc, x.id desc)
      from (select m.id, m.client_id, c.name, m.tipo, m.fecha, m.motivo from public.client_movimientos m join public.clients c on c.id = m.client_id
            order by m.fecha desc, m.id desc limit 100) x), '[]'::jsonb),
    'inactivos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.clients c where not c.active), '[]'::jsonb),
    'tiendas_libres', coalesce((select jsonb_agg(jsonb_build_object('id', i.store_id, 'name', i.store_name) order by i.store_name)
      from public.tn_installs i
      where i.access_token is not null
        and not exists (select 1 from public.clients c where i.store_id = any(c.tn_stores || c.tn_stores_portal))), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.portal_agencia(text) from public;
grant execute on function public.portal_agencia(text) to anon, authenticated;
