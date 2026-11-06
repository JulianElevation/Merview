-- Agencia: alertas (sin gasto, sin ventas, caída) y registro de altas y bajas.
-- Una baja es active=false: sale de General, MER View y las cargas, y conserva el historial. Se revierte con un alta.
create table if not exists public.client_movimientos (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete cascade,
  tipo text not null check (tipo in ('alta','baja')),
  fecha date not null,
  motivo text,
  created_at timestamptz not null default now()
);
alter table public.client_movimientos enable row level security;
revoke all on table public.client_movimientos from public, anon, authenticated;

-- Foto del gasto acumulado cada 30 minutos: Meta da el gasto por día, y así se puede medir "últimas 8 horas".
create table if not exists public.meta_foto (
  tomada_at timestamptz not null,
  day date not null,
  account_id text not null,
  spend numeric not null,
  primary key (tomada_at, day, account_id)
);
alter table public.meta_foto enable row level security;
revoke all on table public.meta_foto from public, anon, authenticated;

create or replace function public.meta_foto_tomar()
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_ahora timestamptz := now();
begin
  insert into public.meta_foto (tomada_at, day, account_id, spend)
  select v_ahora, l.day, l.account_id, l.spend from public.meta_live l
  where l.day >= ((v_ahora at time zone 'America/Argentina/Buenos_Aires')::date - 1);
  delete from public.meta_foto where tomada_at < v_ahora - interval '3 days';
end $$;
revoke all on function public.meta_foto_tomar() from public, anon, authenticated;

create or replace function public.portal_agencia(p_key text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_foto timestamptz;
  v_desde date;
  v_res jsonb;
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  select max(f.tomada_at) into v_foto from public.meta_foto f
    where f.tomada_at between now() - interval '9 hours' and now() - interval '8 hours';
  v_desde := (v_foto at time zone 'America/Argentina/Buenos_Aires')::date - 1;

  with s as (select * from public.portal_serie((v_hoy - 30)::date, v_hoy)),
  por as (
    select s.client_id,
      coalesce(sum(s.spend_ars) filter (where s.day = v_hoy),0) as inv_hoy,
      coalesce(sum(s.spend_ars) filter (where s.day = v_hoy - 1),0) as inv_ayer,
      coalesce(sum(s.spend_ars),0) as inv_30,
      coalesce(sum(s.revenue) filter (where s.day > v_hoy - 7),0) as fac_7,
      coalesce(sum(s.revenue) filter (where s.day <= v_hoy - 7 and s.day > v_hoy - 14),0) as fac_7_prev
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
  ocho as (
    select c.client_id,
      sum(coalesce((select sum(l.spend) from public.meta_live l where l.account_id = c.account_id and l.day >= v_desde),0)
        - coalesce((select sum(f.spend) from public.meta_foto f where f.account_id = c.account_id and f.tomada_at = v_foto),0)) as gasto
    from cuentas c where v_foto is not null group by 1
  )
  select jsonb_build_object(
    'ahora', now(),
    'foto_lista', v_foto is not null,
    'clientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'kind', c.kind,
        'con_meta', cardinality(c.meta_accounts) > 0,
        'inv_hoy', coalesce(p.inv_hoy,0), 'inv_ayer', coalesce(p.inv_ayer,0), 'inv_30', coalesce(p.inv_30,0),
        'fac_7', coalesce(p.fac_7,0), 'fac_7_prev', coalesce(p.fac_7_prev,0),
        'tiendas_vivas', coalesce(v.n,0), 'ult_venta', u.ult_venta, 'dias_sin_venta', v_hoy - u.ult_venta,
        'sin_gasto_8h', o.gasto is not null and o.gasto <= 0
      ) order by c.name)
      from public.clients c
      left join por p on p.client_id = c.id
      left join vivas v on v.client_id = c.id
      left join ventas u on u.client_id = c.id
      left join ocho o on o.client_id = c.id
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

create or replace function public.portal_baja_cliente(p_key text, p_client text, p_fecha date default null, p_motivo text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  update public.clients set active = false where id = p_client and active;
  if not found then raise exception 'cliente_inexistente'; end if;
  insert into public.client_movimientos (client_id, tipo, fecha, motivo)
  values (p_client, 'baja', coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date), nullif(left(trim(p_motivo), 300), ''));
end $$;
revoke all on function public.portal_baja_cliente(text,text,date,text) from public;
grant execute on function public.portal_baja_cliente(text,text,date,text) to anon, authenticated;

create or replace function public.portal_reactivar_cliente(p_key text, p_client text, p_fecha date default null, p_motivo text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  update public.clients set active = true where id = p_client and not active;
  if not found then raise exception 'cliente_inexistente'; end if;
  insert into public.client_movimientos (client_id, tipo, fecha, motivo)
  values (p_client, 'alta', coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date), nullif(left(trim(p_motivo), 300), ''));
end $$;
revoke all on function public.portal_reactivar_cliente(text,text,date,text) from public;
grant execute on function public.portal_reactivar_cliente(text,text,date,text) to anon, authenticated;

-- Cliente nuevo: va como las fichas solo del portal, para no tocar la carga de tiendas de MER View.
create or replace function public.portal_alta_cliente(p_key text, p_nombre text, p_leads boolean default false, p_tienda text default null, p_meta text default null, p_fecha date default null, p_motivo text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_id text;
  v_tienda text := nullif(trim(coalesce(p_tienda, '')), '');
  v_meta text := regexp_replace(coalesce(p_meta, ''), '[^0-9]', '', 'g');
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  v_id := trim(both '-' from regexp_replace(translate(lower(v_nombre), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '-', 'g'));
  if v_id = '' or length(v_nombre) > 80 then raise exception 'nombre_invalido'; end if;
  if exists (select 1 from public.clients c where c.id = v_id) then raise exception 'cliente_existente'; end if;
  if v_meta <> '' and length(v_meta) < 5 then raise exception 'cuenta_invalida'; end if;
  if v_tienda is not null and (
       not exists (select 1 from public.tn_installs i where i.store_id = v_tienda)
       or exists (select 1 from public.clients c where v_tienda = any(c.tn_stores || c.tn_stores_portal))
     ) then raise exception 'tienda_no_disponible'; end if;
  insert into public.clients (id, name, kind, meta_accounts, tn_stores, woo_shops, tn_stores_portal, active)
  values (v_id, v_nombre, case when p_leads then 'leads' else 'sin_tienda' end,
    case when v_meta = '' then '{}'::text[] else array[v_meta] end, '{}', '{}',
    case when v_tienda is null then '{}'::text[] else array[v_tienda] end, true);
  insert into public.client_movimientos (client_id, tipo, fecha, motivo)
  values (v_id, 'alta', coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date), nullif(left(trim(p_motivo), 300), ''));
  return v_id;
end $$;
revoke all on function public.portal_alta_cliente(text,text,boolean,text,text,date,text) from public;
grant execute on function public.portal_alta_cliente(text,text,boolean,text,text,date,text) to anon, authenticated;
