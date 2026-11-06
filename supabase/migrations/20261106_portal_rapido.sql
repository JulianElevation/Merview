-- Rangos largos: el límite de anon es 3 s y portal_serie tardaba 10 s con 400 días.
-- 1. Sin SET search_path, Postgres integra esta función en la consulta en vez de llamarla por cada orden.
--    Los operadores van con pg_catalog para que el resultado no dependa del search_path de quien la llama.
create or replace function public.tn_cuenta_como_venta(p_payment text, p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_payment operator(pg_catalog.=) 'paid'
    and coalesce(p_status,'') operator(pg_catalog.<>) 'cancelled', false)
$$;
revoke all on function public.tn_cuenta_como_venta(text,text) from public, anon, authenticated;

-- 2. Primero se suman las órdenes por tienda y día, y después se cruzan con los clientes.
create or replace function public.portal_serie(p_since date, p_until date)
returns table (client_id text, day date, revenue numeric, orders bigint, spend_ars numeric, messages numeric)
language sql stable security definer set search_path to '' as $$
  with fx as (select coalesce((select value::numeric from public.settings where key = 'usd_ars'), 1) as usd),
  tiendas as (
    select c.id as client_id, s.store_id, i.coverage_from
    from public.clients c
    cross join lateral unnest(c.tn_stores || c.tn_stores_portal) as s(store_id)
    left join public.tn_installs i on i.store_id = s.store_id and i.access_token is not null
    where c.active
  ),
  tn_dia as (
    select o.store_id, o.dia,
      sum(o.total) filter (where public.tn_cuenta_como_venta(o.payment_status, o.status)) as revenue,
      count(*) filter (where public.tn_cuenta_como_venta(o.payment_status, o.status)) as orders
    from public.tn_orders o
    where o.dia between p_since and p_until
    group by 1,2
  ),
  tn_vivo as (
    select t.client_id, o.dia as day, sum(o.revenue) as revenue, sum(o.orders)::bigint as orders
    from tiendas t join tn_dia o on o.store_id = t.store_id
    where t.coverage_from is not null and o.dia >= t.coverage_from
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
