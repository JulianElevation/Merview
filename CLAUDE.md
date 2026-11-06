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
- App de Tiendanube creada: "Elevation Portal", ID 50711, privada ("Para tus clientes"), permisos View Orders y View Fulfillment orders. `tn_config.app_id` cargado.
- Vita conectada (1350594) el 05/11 con acceso de partner (SSO): alcanza para autorizar. Función `tn-app` versión 5 en Supabase; ese arreglo de `lib.ts` y sus pruebas todavía no están en GitHub.
- Validado con Vita: 62 ventas y $ 3.658.975,05 el 05/11; el inicio de Tiendanube marcaba 59 y $ 3.498.519,85, y la diferencia son exactamente sus 3 últimas órdenes. Contra Master Metrics coincide salvo órdenes `partially_paid` (04/11 y 29/10), que Master Metrics cuenta y el portal no. Decisión de Julián: `partially_paid` cuenta como no pagada (va a Pendiente de pago; base ya aplicada). Falta subir a GitHub y publicar `portal.js` con la etiqueta Sin pagar: el permiso frenó el push. Método de envío confirmado en `fulfillments[].shipping.option`.
- Cuidado: dos sesiones de tiendas en el mismo navegador se mezclan (la de Vita mostró encabezado de Vanskap). Autorizar siempre desde `<dominio-de-la-tienda>/admin/apps/50711/authorize/` y revisar el nombre antes de aceptar. La app se crea con "Edit Products" marcado por defecto: ya está sacado.
- Sin probar: primer webhook real (`last_webhook_at` vacío) y nuevos/recurrentes contra Master Metrics, que hay que comparar cuando termine el historial.
- `tn-diag` quedó deployada como stub que responde 410: borrarla desde Supabase.
- Pendiente de Julián: `META_TOKEN` (el guardado en `elevation-analisis` está vencido), y mandar una captura de un tablero de Master Metrics, porque la API no muestra su contenido.
- Recomendado: poner privado el repo de GitHub; `docs/clientes.md` expone nombres de clientes.
