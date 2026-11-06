-- Vista de cliente: comparación, productos vendidos, ranking y series por mes.
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
    'unidades', (select coalesce(sum(unidades),0) from ventas),
    'prev', (select jsonb_build_object('revenue',p.revenue,'orders',p.orders,'spend',p.spend,'messages',p.messages,
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
revoke all on function public.portal_cliente(text,text,date,date,integer,integer) from public;
grant execute on function public.portal_cliente(text,text,date,date,integer,integer) to anon, authenticated;
