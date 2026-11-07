-- Vanskap vende por tienda y por mensajes: se vincula su tienda y se separan sus campañas de mensajes.
update public.clients set kind = 'sin_tienda', tn_stores_portal = array['4279665'], separa_b2b = true where id = 'vanskap';
