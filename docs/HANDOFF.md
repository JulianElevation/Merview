# MER View — Traspaso completo (contexto para una nueva sesión de Claude Code)

Última actualización: 2026-10-29. Dueño: Julián Martínez (CEO de Elevation Media, julian@mkt-elevation.com).
Idioma de trabajo: español rioplatense. Preferencias: resultados completos y directos, instrucciones paso a paso (una acción por línea), avisar ANTES de cualquier acción irreversible. Nunca imprimir secretos.

## 1. Qué es

Tablero interno de Elevation Media (agencia de paid media, marcas de moda y belleza en Argentina) con
**inversión en Meta Ads, facturación de la tienda y MER por cliente** (MER = facturación ÷ inversión).
- Períodos: Hoy, Ayer, Últimos 7 días (sin hoy), Este mes. Hora de Buenos Aires.
- Colores MER: verde ≥ 6, ámbar 3–6, rojo < 3.
- "Activo" = inversión > 0 en los últimos 30 días.
- Sección aparte "Generación de leads" (Vanskap, FPT Egresados, Goar): inversión, mensajes, costo por mensaje. Sin MER.
- Detalle por día al tocar un cliente.

URL: https://merview.vercel.app — acceso con link único `https://merview.vercel.app/#k=<clave>` (la clave la tiene Julián; NO está en el repo).

## 2. Arquitectura

```
Master Metrics (conector MCP: Meta, Tiendanube, WooCommerce)
   │  tarea programada de Claude cada 2 h (7–23 h ART) → merview_ingest
   ▼
Supabase "Merview" (Postgres)
   │  RPC merview_base / merview_daily (validan la clave del link)
   ▼
Vercel "merview" — index.html estático + config.js + supabase-js (CDN)
```

## 3. Identificadores

| Qué | Valor |
|---|---|
| Repo GitHub | JulianElevation/Merview (rama main) |
| Supabase project id | xiijrsgaxsjizfcuvklo — https://xiijrsgaxsjizfcuvklo.supabase.co |
| Supabase publishable key | en `config.js` (pública por diseño) |
| Vercel team | team_bXJpzPVmP3GGkvrKMgtN9pq6 (slug julian-2124) |
| Vercel project | merview — prj_xfAatZjI6wvZW4GgrStWDEMstsoh |
| Tarea programada de sync | trig_01LPZppviCkiGW7tiasPutD8 "Merview - Sincronizar datos (Master Metrics -> Supabase)" — prompt en `docs/sincronizacion.md` |

⚠️ En Vercel existe otro proyecto, "elevation-panel" (prj_6jhK3RMX3hAhRZQz0xSJc46bToo9), que NO tiene nada que ver. No tocarlo.

## 4. Base de datos (Supabase)

Tablas:
- `clients(id text pk slug, name, kind in ('ecommerce','leads','sin_tienda'), meta_accounts text[], tn_stores text[], woo_shops text[], active bool)`. Hay 54 clientes. Es la fuente de verdad de la lista de clientes.
- `settings(key pk, value)`. `usd_ars` = 1500.
- `meta_daily(day, account_id, currency 'ARS'|'USD', spend, messages, updated_at)`, pk (day, account_id).
- `store_daily(day, source 'tiendanube'|'woocommerce', store_id, revenue, updated_at)`, pk (day, source, store_id).
- `sync_runs(id, ran_at, since, until, status, notes)`.
- `source_errors(source, account_id, message, last_seen)`, pk (source, account_id).
- `access_keys(key_hash pk, label, active, created_at)`. Guarda el SHA-256 hex de la clave del link. RLS activo sin políticas: nadie la lee desde la API.

Vista `client_daily(client_id, day, spend_ars, messages, revenue)` (security_invoker). USD × settings.usd_ars.

Funciones:
- `merview_ingest(p_source, p_month date, p_ids text, p_rows text, p_usd text default '')`.
  - SECURITY DEFINER, sin EXECUTE para anon/authenticated.
  - `p_source`: 'meta' (spend; currency USD si la cuenta está en p_usd), 'meta_msgs' (messages), 'tiendanube', 'woocommerce'.
  - `p_rows` = "idx,n,valor;..." donde idx es la posición 0-based en p_ids y fecha = p_month + (n-1). n puede pasar fin de mes. Hace upsert.
- `merview_key_ok(p_key)`: valida contra access_keys activas. Interna, sin EXECUTE público.
- `merview_base(p_key)`: devuelve jsonb {clients, usd_ars, errors, last_sync}. EXECUTE para anon.
- `merview_daily(p_key, p_since, p_until)`: devuelve el array jsonb de client_daily. Rango máximo de 400 días. EXECUTE para anon.
- `is_elevation_user()`: SECURITY INVOKER. Quedó de la versión con login por mail; las políticas RLS de lectura para authenticated @mkt-elevation.com siguen existiendo, pero el front ya no las usa.

Cambiar la clave del link (pedirle confirmación a Julián antes: el link viejo deja de funcionar):
```sql
with k as (select translate(encode(extensions.gen_random_bytes(18),'base64'),'+/','-_') as key)
, ins as (insert into public.access_keys(key_hash,label) select encode(sha256(convert_to(key,'UTF8')),'hex'),'equipo' from k returning 1)
select key from k;
-- luego: update public.access_keys set active=false where key_hash = '<hash viejo>';
```

Datos cargados: octubre 2026 completo (1–29) y verificado contra Master Metrics.
- Meta: total de octubre sin las cuentas de leads 242.172.902,38; las 3 cuentas de leads se agregaron después.
- Tiendanube: 1.243 filas, 1.432.712.731,88.
- WooCommerce: Nana y Burzaco.
- Mensajes: Vanskap 5.275, FPT 1.065, Goar 166.

## 5. Master Metrics (conector `get_data`) — reglas aprendidas

- Inversión: source "meta", breakdowns ["account_id","day"], metric "spend".
- Mensajes: metric "conversion_onsite_conversion.messaging_conversation_started_7d".
  - Con account_id viene null, así que hay que usar breakdown ["ad_account","day"]. Devuelve el NOMBRE de la cuenta.
  - Consultar de a una cuenta para saber a quién pertenece cada fila.
- Tiendanube: source "tiendanube", breakdown "tn_common_store_id", metric "tn_orders_total_billing".
- WooCommerce: source "woocommerce", breakdown "woocommerce_shop_id" (es el dominio), metric "woocommerce_orders_total".
- Las fechas vuelven como MM/DD/AAAA.
- Si una sola cuenta perdió permisos o tiene el token vencido, rechaza TODO el lote. Los errores dicen "Se han perdido permisos…" o "error-account-token-expired". Hay que bisecar la lista hasta aislar la cuenta.
- Cuentas de Meta en USD (se convierten a 1500): 2176038473135026 (Signature 23), 917753601243330 (Dhermafy), 1024749676680864 (Cotize).
- Las salidas grandes se guardan en archivo: procesarlas con Python, no leerlas enteras.

## 6. Repo

| Archivo | Qué es |
|---|---|
| `index.html` | Front. Lee `#k=` de la URL, lo guarda en localStorage ("merview_key"), limpia el hash y llama a las RPC. "Salir" borra la clave. |
| `config.js` | supabaseUrl + publishable key. |
| `vercel.json` | Headers: X-Frame-Options DENY, nosniff, Referrer-Policy. |
| `claude-artifact/index.html` | Versión vieja que corre dentro de claude.ai (Master Metrics en vivo vía `window.claude.use("mcp")`). |
| `docs/clientes.md` | Mapeo clientes ↔ cuentas. Puede estar desactualizado: la verdad está en la tabla `clients`. |
| `docs/reporte-semanal.md` | Prompt del reporte "Cuentas en rojo" de los lunes. El mail va SOLO a julian@mkt-elevation.com. |
| `docs/sincronizacion.md` | Prompt de la tarea programada de sync. |

## 7. Deploy — OJO

- El vínculo automático Git → Vercel falló al crear el proyecto (error de schema de la API).
- Cada push NO despliega solo. Hay que desplegar a mano con el conector Vercel `create_deployment`: teamId team_bXJpzPVmP3GGkvrKMgtN9pq6, project prj_xfAatZjI6wvZW4GgrStWDEMstsoh, target "production", gitSource {type:"github", org:"JulianElevation", repo:"Merview", ref:"main"}. Después verificar con `get_deployment` hasta que esté READY.
- Pendiente: conectar el repo en Vercel (Settings → Git) para que despliegue solo.
- Push: el remote correcto es https://github.com/JulianElevation/Merview.git (el repo se renombró desde "MER VIEW").
- El contenedor cloud de Claude NO llega a supabase.co ni a cdn.jsdelivr por red. Todo lo de Supabase se hace con el conector (execute_sql / apply_migration).
- Para probar el front con Playwright: mockear `**/rest/v1/rpc/*` y servir supabase-js desde npm local (`@supabase/supabase-js@2.45.4`, dist/umd/supabase.js).

## 8. Pendientes y decisiones abiertas

1. Citypet.arg: cuenta Meta nueva 3827791330884949, no está en `clients`. Preguntar a Julián si es cliente.
2. Recomendado: volver a poner el repo de GitHub como privado. Vercel sigue desplegando igual.
3. Conectar Git en Vercel para que despliegue solo.
4. "lamode" (cuenta 1015159984074486) no tuvo inversión en octubre. Es normal.
5. Bajas confirmadas por Julián, que NO deben estar activas: Glaze, Knauer, Dreams, The Luxe, We Not Me, Verush, Raisse, Tamba, Frison, Blanco. "Not Fail" y "Miamee" son el mismo cliente. MUD es la tienda de Celeste Gonzalez.
6. Verificar en la primera corrida de la tarea programada que `sync_runs` tenga filas nuevas y que `source_errors` refleje las cuentas caídas.
