-- La única etiqueta es (B2B): Julián no quiere (MSJ). Aplicar después de renombrar las campañas en Meta.
create or replace function public.es_b2b(p_nombre text)
returns boolean language sql immutable as $$
  select coalesce(p_nombre operator(pg_catalog.~*) '\(\s*b2b\s*\)', false)
$$;
revoke all on function public.es_b2b(text) from public, anon, authenticated;
