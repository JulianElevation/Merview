# Portal Elevation (incluye MER View)

Portal interno de la agencia: tablero general, vista por cliente y agencia, con datos casi en tiempo real.
Contexto: `docs/portal.md` (portal) y `docs/HANDOFF.md` (MER View, Master Metrics, deploy).

## Reglas
- Hablarle a Julián en castellano rioplatense. Avisar antes de publicar o tocar producción.
- Secretos nunca en el repo: hoy el repo de GitHub es público.
- Cada push NO despliega solo: desplegar con `create_deployment` (ver `docs/HANDOFF.md`, sección 7).
- No tocar `index.html` ni el sync durante eventos de venta.
- El link lo usa todo el equipo: nada de caja, sueldos ni fees en el portal.

## Estado (06/11/2026)
- Hecho: portal (`portal.html`, `portal.js`), app (`supabase/functions/tn-app`) y migraciones `20261106_*`. Probado con datos simulados y con Postgres local.
- Aplicado en producción: migraciones `20261106_portal.sql` y `20261106_portal_cron.sql`, función `tn-app` versión 2 y tareas `tn-reconciliar`, `meta-sync` y `tn-limpiar`. Sin secretos, las tareas no hacen nada. `portal_serie` da lo mismo que `client_daily` en noviembre.
- Publicado en merview.vercel.app: `portal.html` y `privacidad.html`. `.vercelignore` deja afuera docs, pruebas y SQL. `index.html` no cambió.
- Falta cargar `tn_config.app_id` cuando exista la app.
- Pendiente de Julián: crear la app (`read_orders`, `read_fulfillment_orders`), cargar `TN_CLIENT_SECRET` y `META_TOKEN` (el token de Meta guardado en `elevation-analisis` está vencido), y mandar una captura de un tablero de Master Metrics, porque la API no muestra su contenido.
- A validar con la primera tienda: facturación contra Tiendanube, método de envío (ruta de `fulfillments`), nuevos/recurrentes contra Master Metrics, y si el acceso de partner alcanza para autorizar la app.
- Recomendado: poner privado el repo de GitHub; `docs/clientes.md` expone nombres de clientes.
