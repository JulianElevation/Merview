-- Fichas solo del portal: tiendas conectadas que no están en Master Metrics.
-- tn_stores_portal no lo lee la carga de MER View. Se usa kind 'sin_tienda' para que MER View no les calcule MER en 0.
alter table public.clients add column if not exists tn_stores_portal text[] not null default '{}';

insert into public.clients (id, name, kind, meta_accounts, tn_stores, woo_shops, tn_stores_portal, active) values
  ('citypet','City Pet','sin_tienda',array['3827791330884949'],'{}','{}',array['8429303'],true),
  ('libralatina','Libralatina','sin_tienda','{}','{}','{}',array['1725892'],true),
  ('cezze','Cezzé','sin_tienda','{}','{}','{}',array['7370814'],true)
on conflict (id) do nothing;

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
    select c.id, c.name, c.kind, c.tn_stores || c.tn_stores_portal as tn_stores, c.woo_shops, c.meta_accounts,
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

create or replace function public.portal_cliente(p_key text, p_client text, p_since date, p_until date, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_stores text[];
  v_res jsonb;
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
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
    select s.day, s.revenue, s.orders, s.spend_ars as spend, s.messages, d.nuevos, d.recurrentes
    from public.portal_serie(p_since, p_until) s left join por_dia d on d.day = s.day
    where s.client_id = p_client
  )
  select jsonb_build_object(
    'ahora', now(),
    'cliente', (select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'tn_stores',c.tn_stores || c.tn_stores_portal,'woo_shops',c.woo_shops,'meta_accounts',c.meta_accounts)
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
