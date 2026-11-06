-- portal_general busca la última venta recibida. Sin índice recorre toda tn_orders y supera el límite de 3 s de anon.
create index if not exists tn_orders_recibida_idx on public.tn_orders (received_at desc);
