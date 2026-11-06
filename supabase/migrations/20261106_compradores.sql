-- Historial completo de compradores: alcanza con la huella de cada uno, sin guardar más órdenes.
alter table public.tn_installs add column if not exists buyers_until date;
alter table public.tn_installs add column if not exists buyers_done boolean not null default false;

create or replace function public.tn_upsert_buyers(p_rows jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  insert into public.tn_buyers (store_id, buyer_hash, first_paid_at)
  select x.store_id, x.buyer_hash, min(x.first_paid_at)
  from jsonb_to_recordset(p_rows) as x(store_id text, buyer_hash text, first_paid_at timestamptz)
  where x.buyer_hash is not null
  group by 1,2
  on conflict (store_id, buyer_hash) do update set first_paid_at = least(public.tn_buyers.first_paid_at, excluded.first_paid_at);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.tn_upsert_buyers(jsonb) from public, anon, authenticated;
grant execute on function public.tn_upsert_buyers(jsonb) to service_role;

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
