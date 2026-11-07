-- Agencia: el gasto se mide en 12 horas y se suma la inversión semanal para la caída del MER.
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
        'fac_7', coalesce(p.fac_7,0), 'fac_7_prev', coalesce(p.fac_7_prev,0), 'inv_7', coalesce(p.inv_7,0), 'inv_7_prev', coalesce(p.inv_7_prev,0),
        'tiendas_vivas', coalesce(v.n,0), 'ult_venta', u.ult_venta, 'dias_sin_venta', v_hoy - u.ult_venta,
        -- Con foto: el gasto no se movió en 12 horas. Sin foto, después del mediodía: hoy sigue en cero.
        'sin_gasto_12h', m.client_id is not null and (case when v_foto is not null then coalesce(o.gasto, 0) <= 0 else v_hora >= 12 and coalesce(p.inv_hoy,0) <= 0 end)
      ) order by c.name)
      from public.clients c
      left join por p on p.client_id = c.id
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
