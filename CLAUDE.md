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
- Vita conectada (1350594) el 05/11 con acceso de partner (SSO): alcanza para autorizar. Función `tn-app` versión 5 en Supabase.
- Validado con Vita: 62 ventas y $ 3.658.975,05 el 05/11; el inicio de Tiendanube marcaba 59 y $ 3.498.519,85, y la diferencia son exactamente sus 3 últimas órdenes. Contra Master Metrics coincide salvo órdenes `partially_paid` (04/11 y 29/10), que Master Metrics cuenta y el portal no. Decisión de Julián: `partially_paid` cuenta como no pagada (va a Pendiente de pago; base ya aplicada). Método de envío confirmado en `fulfillments[].shipping.option`.
- Cuidado: dos sesiones de tiendas en el mismo navegador se mezclan (la de Vita mostró encabezado de Vanskap). Autorizar siempre desde `<dominio-de-la-tienda>/admin/apps/50711/authorize/` y revisar el nombre antes de aceptar. La app se crea con "Edit Products" marcado por defecto: ya está sacado.
- Historial de Vita completo desde 01/10/2025 (12.703 órdenes) y primer webhook real recibido. Nuevos/recurrentes de octubre: portal 1.313/316, Master Metrics 1.140/490. El portal sobrecuenta nuevos porque solo mira 400 días; opción pendiente: guardar compradores de todo el historial.
- `tn-diag` quedó deployada como stub que responde 410: borrarla desde Supabase.
- Conectadas 32 tiendas de la planilla Células de trabajo (06/11). Restringidas por verificación en 2 pasos: New Pin, YOVA, Lala Fe, Toy Store, Minnakazzira, Infinity, Stark, Posta, Innocenti. Acceso denegado: Guilty Berlin. Fuera del panel de partners: Carla Canchero, Signature, Lizze. CityPet, Libralatina y Cezzé no están en Master Metrics: van en `clients.tn_stores_portal` con kind `sin_tienda`, un campo que la carga de MER View no lee. Libralatina y Cezzé no tienen cuenta de Meta cargada. Auremworld agregada a `clients`.
- Cron `tn-reconciliar` pasado a cada 2 minutos para acelerar los historiales: volver a `*/5 * * * *` cuando todas tengan `buyers_done`.
- Vista de cliente ampliada (comparación contra el período anterior, productos vendidos, ranking, proveedor de pago y series de 12 meses): publicada el 06/11 (commit 9a16808, deploy `dpl_2NgybNETkJVvbBi1K1igV6G9oPGD`) y verificada con Vita: octubre da $ 97.713.180, 1.629 ventas, 2.956 unidades y 1.180 nuevos, igual que las órdenes. Margen y costos quedan afuera por decisión de Julián.
- Límite de 3 s del rol `anon`: `portal_general` lo superaba con el historial cargado y el portal mostraba error. Arreglado con el índice `tn_orders_recibida_idx` (`20261106_indice_ultima_venta.sql`). Rangos largos arreglados con `20261106_portal_rapido.sql`: `tn_cuenta_como_venta` va sin `SET search_path` para que Postgres la integre en la consulta (no volver a ponérselo: cuesta segundos con 100.000 órdenes) y `portal_serie` suma por tienda antes de cruzar con clientes. `portal_serie` con 400 días bajó de 10 s a 0,2 s, con resultado idéntico al de antes (huella md5 del 01/10/2025 al 04/11/2026).
- Meta en vivo funcionando desde el 06/11: `META_TOKEN` del usuario del sistema ElevationAnalytics con la app Elevation Portal (ID 1654289312770256). 55 de 56 cuentas leen; del 01/10 al 04/11 coincide con Master Metrics en 1.739 de 1.742 filas. Falla Notfancy (5649094995195714): el dueño de la cuenta no dio permiso, sigue por Master Metrics. Libralatina y Cezzé no tienen cuenta de Meta en `clients`; agregar cuentas ahí manda esos IDs a la carga de Master Metrics.
- Recomendado: poner privado el repo de GitHub; `docs/clientes.md` expone nombres de clientes.
