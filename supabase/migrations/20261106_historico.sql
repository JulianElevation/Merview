-- Histórico del análisis de resultados: solo totales por día. portal_cliente trae todo el detalle y con 6 meses pasa el límite de 3 s.
create or replace function public.portal_historico(p_key text, p_client text, p_since date, p_until date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.merview_key_ok(p_key) then raise exception 'clave_invalida' using errcode = '28000'; end if;
  if p_until - p_since > 400 or p_until < p_since then raise exception 'rango_invalido'; end if;
  return jsonb_build_object('dias', coalesce((
    select jsonb_agg(jsonb_build_object('day', s.day, 'revenue', s.revenue, 'orders', s.orders, 'spend', s.spend_ars, 'messages', s.messages, 'spend_b2b', coalesce(b.spend_ars, 0)) order by s.day)
    from public.portal_serie(p_since, p_until) s
    left join public.portal_b2b(p_since, p_until) b on b.client_id = s.client_id and b.day = s.day
    where s.client_id = p_client), '[]'::jsonb));
end $$;
revoke all on function public.portal_historico(text,text,date,date) from public;
grant execute on function public.portal_historico(text,text,date,date) to anon, authenticated;
