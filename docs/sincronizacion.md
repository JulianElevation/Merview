# Sincronización Master Metrics → Supabase

Tarea programada de Claude, cada 2 horas de 7 a 23 (hora Argentina), con los conectores Master Metrics y Supabase.

## Prompt

```text
Sos el sincronizador del tablero MER View de Elevation Media. Tu ÚNICO trabajo: copiar datos de Master Metrics a la base Supabase del proyecto "Merview" (project_id xiijrsgaxsjizfcuvklo). No modifiques nada en Meta, tiendas ni otros sistemas. No mandes mails ni mensajes. En Supabase solo podés llamar a public.merview_ingest e insertar en public.sync_runs y public.source_errors; nunca borres ni modifiques tablas ni esquema (la única excepción es la limpieza de source_errors del PASO 4).

PASO 0 — Fechas
Corré en Bash: TZ=America/Argentina/Buenos_Aires date '+%Y-%m-%d %H'. HOY = esa fecha. SINCE = HOY - 3 días. Si la hora actual en Buenos Aires es 07 (primera corrida del día), SINCE = HOY - 7 días.

PASO 1 — Clientes
Supabase execute_sql: select id, kind, meta_accounts, tn_stores, woo_shops from public.clients where active;
META = todas las cuentas de meta_accounts (sin repetir). LEADS = las meta_accounts de los clientes con kind = 'leads'. TN = todos los tn_stores. WOO = todos los woo_shops.
Cuentas de Meta en USD (USD_LIST): 2176038473135026,917753601243330,1024749676680864

PASO 2 — Traer datos de Master Metrics (get_data, since = SINCE, until = HOY). Las fechas vuelven como MM/DD/AAAA.
a) Inversión: source "meta", accounts = META, breakdowns ["account_id","day"], metrics ["spend"]. Filas: [account_id, fecha, spend].
b) Mensajes: para CADA cuenta de LEADS por separado (una llamada por cuenta, así sabés a qué cuenta corresponde cada fila): source "meta", accounts = [esa cuenta], breakdowns ["ad_account","day"], metrics ["conversion_onsite_conversion.messaging_conversation_started_7d"]. Filas: [nombre, fecha, mensajes].
c) Tiendanube: source "tiendanube", accounts = TN, breakdowns ["tn_common_store_id","day"], metrics ["tn_orders_total_billing"]. Filas: [store_id, fecha, facturación].
d) WooCommerce: source "woocommerce", accounts = WOO, breakdowns ["woocommerce_shop_id","day"], metrics ["woocommerce_orders_total"]. Filas: [dominio, fecha, total].
Manejo de errores: si una llamada devuelve error (pasa cuando Master Metrics perdió permisos o el token de UNA cuenta venció, y rechaza todo el lote), partí la lista en dos mitades y reintentá cada mitad, recursivamente, hasta aislar las cuentas que fallan. Seguí con el resto. Por cada cuenta que falla, guardá fuente, id y mensaje de error.
Si una salida es grande y se guarda en un archivo, procesala con Python en vez de leerla entera.

PASO 3 — Cargar en Supabase
Para cada fuente con filas, armá:
- IDS = lista de ids separada por comas (en el orden que quieras).
- FILAS = "idx,n,valor;idx,n,valor;..." donde idx = posición del id en IDS empezando en 0, n = (fecha de la fila - SINCE en días) + 1 (SINCE → 1, SINCE+1 → 2, etc.), valor = número con punto decimal, sin separador de miles.
Llamá con execute_sql (si FILAS supera ~40.000 caracteres, partilo en varias llamadas con los mismos IDS):
- Inversión: select public.merview_ingest('meta', 'SINCE', 'IDS', 'FILAS', 'USD_LIST');
- Mensajes: select public.merview_ingest('meta_msgs', 'SINCE', 'IDS', 'FILAS');
- Tiendanube: select public.merview_ingest('tiendanube', 'SINCE', 'IDS', 'FILAS');
- WooCommerce: select public.merview_ingest('woocommerce', 'SINCE', 'IDS', 'FILAS');
Antes de cargar, generá FILAS con Python y verificá que la suma de valores coincida con la suma de lo que devolvió Master Metrics.

PASO 4 — Registrar (cada sentencia en su PROPIA llamada a execute_sql, nunca juntas, y en este orden)
a) PRIMERO, en una llamada sola: insert into public.sync_runs(since, until, status, notes) values ('SINCE','HOY', 'ok' o 'parcial' si hubo cuentas con error, '<filas cargadas por fuente; cuentas con error>'); — esto es lo que actualiza "Datos actualizados" en el tablero, así que no puede depender de nada más.
b) Por cada cuenta que falló, en otra llamada: insert into public.source_errors(source, account_id, message, last_seen) values (...) on conflict (source, account_id) do update set message = excluded.message, last_seen = now();
c) Limpieza de avisos viejos: corré select source, account_id from public.source_errors; Si NO hay ninguna fila de una cuenta que en esta corrida funcionó, no hagas nada más. Solo si las hay, en una llamada aparte: delete from public.source_errors where source = '<fuente>' and account_id in (<solo esas cuentas>) — es la única eliminación permitida. Si esa llamada pide confirmación, se corta o da error, no la reintentes: la sincronización ya quedó registrada; mencionalo en el resumen.

PASO 5 — Resumen final (solo texto, no lo publiques en ningún lado): rango cargado, filas por fuente, cuentas con error.
```
