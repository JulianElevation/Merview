-- Portal Elevation: datos en vivo de Tiendanube y Meta. Solo crea objetos nuevos:
-- no modifica clients, store_daily, meta_daily ni las funciones de MER View.
-- Para deshacerlo: supabase/rollback_portal.sql

create table if not exists public.tn_config (key text primary key, value text not null);

create table if not exists public.tn_installs (
  store_id text primary key,
  access_token text,
  scope text,
  store_name text,
  currency text,
  installed_at timestamptz not null default now(),
  uninstalled_at timestamptz,
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  coverage_from date,               -- desde este día las órdenes están completas; antes se usa Master Metrics
  backfill_done boolean not null default false,
  last_error text
);

-- Sin datos personales: buyer_hash es una huella irreversible del mail, solo para saber si la persona ya compró.
create table if not exists public.tn_orders (
  store_id text not null,
  order_id bigint not null,
  number bigint,
  dia date not null,
  total numeric not null default 0,
  subtotal numeric,
  discount numeric,
  shipping_cost numeric,
  currency text,
  payment_status text,
  status text,
  storefront text,
  gateway text,
  payment_method text,
  card_company text,
  installments integer,
  shipping_option text,
  unidades integer,
  items jsonb,
  buyer_hash text,
  created_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz,
  received_at timestamptz not null default now(),
  primary key (store_id, order_id)
);
create index if not exists tn_orders_tienda_dia_idx on public.tn_orders (store_id, dia);
create index if not exists tn_orders_tienda_fecha_idx on public.tn_orders (store_id, created_at desc);

create table if not exists public.tn_buyers (
  store_id text not null,
  buyer_hash text not null,
  first_paid_at timestamptz not null,
  primary key (store_id, buyer_hash)
);

create table if not exists public.meta_live (
  day date not null,
  account_id text not null,
  currency text,
  spend numeric not null default 0,
  impressions bigint,
  clicks bigint,
  messages numeric,
  updated_at timestamptz not null default now(),
  primary key (day, account_id)
);

create table if not exists public.meta_state (
  account_id text primary key,
  last_ok_at timestamptz,
  last_error text,
  backfill_done boolean not null default false
);

alter table public.tn_config enable row level security;
alter table public.tn_installs enable row level security;
alter table public.tn_orders enable row level security;
alter table public.tn_buyers enable row level security;
alter table public.meta_live enable row level security;
alter table public.meta_state enable row level security;
revoke all on public.tn_config, public.tn_installs, public.tn_orders, public.tn_buyers, public.meta_live, public.meta_state from anon, authenticated;

-- Definición de "venta" en un solo lugar.
create or replace function public.tn_cuenta_como_venta(p_payment text, p_status text)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce(p_payment = 'paid' and coalesce(p_status,'') <> 'cancelled', false)
$$;
revoke all on function public.tn_cuenta_como_venta(text,text) from public, anon, authenticated;

-- Carga idempotente: los webhooks llegan repetidos y desordenados, y lo viejo nunca pisa a lo nuevo.
create or replace function public.tn_upsert_orders(p_rows jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with r as (
    select x.* from jsonb_to_recordset(p_rows) as x(store_id text, order_id bigint, number bigint, total numeric,
      subtotal numeric, discount numeric, shipping_cost numeric, currency text, payment_status text, status text,
      storefront text, gateway text, payment_method text, card_company text, installments integer, shipping_option text,
      unidades integer, items jsonb, buyer_hash text, created_at timestamptz, paid_at timestamptz,
      cancelled_at timestamptz, updated_at timestamptz)
  )
  insert into public.tn_orders (store_id, order_id, number, dia, total, subtotal, discount, shipping_cost, currency,
    payment_status, status, storefront, gateway, payment_method, card_company, installments, shipping_option,
    unidades, items, buyer_hash, created_at, paid_at, cancelled_at, updated_at)
  select store_id, order_id, number, (created_at at time zone 'America/Argentina/Buenos_Aires')::date, total, subtotal,
    discount, shipping_cost, currency, payment_status, status, storefront, gateway, payment_method, card_company,
    installments, shipping_option, unidades, items, buyer_hash, created_at, paid_at, cancelled_at, updated_at
  from r
  on conflict (store_id, order_id) do update set
    number = excluded.number, total = excluded.total, subtotal = excluded.subtotal, discount = excluded.discount,
    shipping_cost = excluded.shipping_cost, currency = excluded.currency, payment_status = excluded.payment_status,
    status = excluded.status, storefront = excluded.storefront, gateway = excluded.gateway,
    payment_method = excluded.payment_method, card_company = excluded.card_company, installments = excluded.installments,
    shipping_option = excluded.shipping_option, unidades = excluded.unidades, items = excluded.items,
    buyer_hash = excluded.buyer_hash, paid_at = excluded.paid_at, cancelled_at = excluded.cancelled_at,
    updated_at = excluded.updated_at
  where public.tn_orders.updated_at is null or excluded.updated_at >= public.tn_orders.updated_at;
  get diagnostics n = row_count;

  insert into public.tn_buyers (store_id, buyer_hash, first_paid_at)
  select x.store_id, x.buyer_hash, min(x.created_at)
  from jsonb_to_recordset(p_rows) as x(store_id text, buyer_hash text, created_at timestamptz, payment_status text, status text)
  where x.buyer_hash is not null and public.tn_cuenta_como_venta(x.payment_status, x.status)
  group by 1,2
  on conflict (store_id, buyer_hash) do update set first_paid_at = least(public.tn_buyers.first_paid_at, excluded.first_paid_at);
  return n;
end $$;
revoke all on function public.tn_upsert_orders(jsonb) from public, anon, authenticated;
grant execute on function public.tn_upsert_orders(jsonb) to service_role;

create or replace function public.meta_upsert(p_rows jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  insert into public.meta_live (day, account_id, currency, spend, impressions, clicks, messages, updated_at)
  select x.day, x.account_id, x.currency, x.spend, x.impressions, x.clicks, x.messages, now()
  from jsonb_to_recordset(p_rows) as x(day date, account_id text, currency text, spend numeric, impressions bigint, clicks bigint, messages numeric)
  on conflict (day, account_id) do update set currency = excluded.currency, spend = excluded.spend,
    impressions = excluded.impressions, clicks = excluded.clicks, messages = excluded.messages, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.meta_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.meta_upsert(jsonb) to service_role;

-- Serie diaria por cliente. Cada dato sale de la fuente en vivo si existe; si no, de lo que carga Master Metrics.
create or replace function public.portal_serie(p_since date, p_until date)
returns table (client_id text, day date, revenue numeric, orders bigint, spend_ars numeric, messages numeric)
language sql stable security definer set search_path to '' as $$
  with fx as (select coalesce((select value::numeric from public.settings where key = 'usd_ars'), 1) as usd),
  tiendas as (
    select c.id as client_id, s.store_id, i.coverage_from
    from public.clients c
    cross join lateral unnest(c.tn_stores) as s(store_id)
    left join public.tn_installs i on i.store_id = s.store_id and i.access_token is not null
    where c.active
  ),
  tn_vivo as (
    select t.client_id, o.dia as day,
      sum(o.total) filter (where public.tn_cuenta_como_venta(o.payment_status, o.status)) as revenue,
      count(*) filter (where public.tn_cuenta_como_venta(o.payment_status, o.status)) as orders
    from tiendas t join public.tn_orders o on o.store_id = t.store_id
    where t.coverage_from is not null and o.dia >= t.coverage_from and o.dia between p_since and p_until
    group by 1,2
  ),
  tn_mm as (
    select t.client_id, d.day, sum(d.revenue) as revenue
    from tiendas t join public.store_daily d on d.source = 'tiendanube' and d.store_id = t.store_id
    where d.day between p_since and p_until and (t.coverage_from is null or d.day < t.coverage_from)
    group by 1,2
  ),
  woo as (
    select c.id as client_id, d.day, sum(d.revenue) as revenue
    from public.clients c cross join lateral unnest(c.woo_shops) as s(shop)
    join public.store_daily d on d.source = 'woocommerce' and d.store_id = s.shop
    where c.active and d.day between p_since and p_until
    group by 1,2
  ),
  gasto as (
    select coalesce(l.day, m.day) as day, coalesce(l.account_id, m.account_id) as account_id,
      case when coalesce(l.currency, m.currency) = 'USD' then coalesce(l.spend, m.spend) * (select usd from fx)
           else coalesce(l.spend, m.spend) end as spend,
      coalesce(l.messages, m.messages) as messages
    from (select * from public.meta_live where day between p_since and p_until) l
    full join (select * from public.meta_daily where day between p_since and p_until) m
      on m.day = l.day and m.account_id = l.account_id
  ),
  meta as (
    select c.id as client_id, g.day, sum(g.spend) as spend, sum(g.messages) as messages
    from public.clients c cross join lateral unnest(c.meta_accounts) as a(account_id)
    join gasto g on g.account_id = a.account_id
    where c.active group by 1,2
  ),
  fac as (
    select client_id, day, sum(revenue) as revenue, sum(orders)::bigint as orders from (
      select client_id, day, revenue, orders from tn_vivo
      union all select client_id, day, revenue, null::bigint from tn_mm
      union all select client_id, day, revenue, null::bigint from woo
    ) u group by 1,2
  )
  select coalesce(f.client_id, m.client_id), coalesce(f.day, m.day), coalesce(f.revenue,0), f.orders,
         coalesce(m.spend,0), coalesce(m.messages,0)
  from fac f full join meta m on m.client_id = f.client_id and m.day = f.day
$$;
revoke all on function public.portal_serie(date,date) from public, anon, authenticated;

-- Tablero general y Agencia.
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
  por_cliente as (
    select c.id, c.name, c.kind, c.tn_stores, c.woo_shops, c.meta_accounts,
      coalesce(sum(s.revenue),0) as revenue, sum(s.orders)::bigint as orders,
      coalesce(sum(s.spend_ars),0) as spend, coalesce(sum(s.messages),0) as messages,
      exists (select 1 from activos a where a.client_id = c.id) as activo,
      (select count(*) from unnest(c.tn_stores) t(store_id) join public.tn_installs i on i.store_id = t.store_id
        where i.access_token is not null and i.coverage_from is not null) as tiendas_vivo,
      (select max(i.last_error) from unnest(c.tn_stores) t(store_id) join public.tn_installs i on i.store_id = t.store_id) as error_tienda
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

-- Vista por cliente: serie, cortes y órdenes.
create or replace function public.portal_cliente(p_key text, p_client text, p_since date, p_until date, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_stores text[];
  v_res jsonb;
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  if p_until - p_since > 400 or p_until < p_since then raise exception 'rango_invalido'; end if;
  select c.tn_stores into v_stores from public.clients c where c.id = p_client and c.active;
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
    select s.day, s.revenue, s.orders, s.spend_ars as spend, s.messages, d.nuevos, d.recurrentes
    from public.portal_serie(p_since, p_until) s left join por_dia d on d.day = s.day
    where s.client_id = p_client
  )
  select jsonb_build_object(
    'ahora', now(),
    'cliente', (select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'tn_stores',c.tn_stores,'woo_shops',c.woo_shops,'meta_accounts',c.meta_accounts)
                from public.clients c where c.id = p_client),
    'tiendas', coalesce((select jsonb_agg(jsonb_build_object('store_id',t.store_id,'conectada',i.access_token is not null,
                  'coverage_from',i.coverage_from,'last_sync_at',i.last_sync_at,'last_webhook_at',i.last_webhook_at,'last_error',i.last_error))
                from unnest(v_stores) t(store_id) left join public.tn_installs i on i.store_id = t.store_id), '[]'::jsonb),
    'meta_sync', (select max(m.last_ok_at) from public.meta_state m join public.clients c on c.id = p_client and m.account_id = any(c.meta_accounts)),
    'dias', coalesce((select jsonb_agg(to_jsonb(s) order by s.day) from serie s), '[]'::jsonb),
    'pendiente', (select jsonb_build_object('total',coalesce(sum(total),0),'ordenes',count(*)) from ord where payment_status = 'pending' and coalesce(status,'') <> 'cancelled'),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select tipo as k, count(*) n, sum(total) t from ventas where tipo is not null group by 1) x), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(payment_method,'sin_dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'pasarelas', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(gateway,'Sin dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'cuotas', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by k) from (select coalesce(installments,1) as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'envios', coalesce((select jsonb_agg(jsonb_build_object('k',k,'ventas',n,'total',t) order by t desc) from (select coalesce(shipping_option,'Sin dato') as k, count(*) n, sum(total) t from ventas group by 1) x), '[]'::jsonb),
    'ordenes_total', (select count(*) from ord),
    'ordenes', coalesce((select jsonb_agg(to_jsonb(p)) from (
        select o.number, o.total, o.currency, o.payment_status, o.status, o.created_at, o.paid_at, o.gateway, o.payment_method,
               o.installments, o.shipping_option, o.unidades, o.items, o.discount, o.tipo
        from ord o order by o.created_at desc limit least(p_limit, 500) offset greatest(p_offset, 0)) p), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.portal_cliente(text,text,date,date,integer,integer) from public;
grant execute on function public.portal_cliente(text,text,date,date,integer,integer) to anon, authenticated;
