# Portal Elevation

`portal.html` + `portal.js`. Reúne en un solo lugar:

- **General**: todos los clientes con inversión, facturación y MER.
- **Por cliente** (desplegable arriba): facturación, inversión, MER, ventas, ticket, CAC, gráficos por día, pago, cuotas, envío, nuevos y recurrentes, y el listado de órdenes.
- **Agencia**: totales contra el período anterior, clientes por MER, ranking y tiendas por conectar. No muestra datos internos de Elevation (caja, sueldos, fees), porque el link lo usa todo el equipo.

Usa el mismo link de acceso que MER View. `index.html` queda igual hasta validar el portal.

## De dónde sale cada dato

```
Venta en Tiendanube ── webhook firmado (segundos) ─┐
   cada 5 min, control + historial de 400 días ────┤
                                                   ▼
Meta Ads ── cada 5 min, últimos 3 días ──── Función tn-app ── Supabase ── portal_general / portal_cliente ── portal.html (cada 20 s)
                                                   ▲
Master Metrics ── cada 2 h (lo que ya existía) ────┘ solo para lo que todavía no está en vivo
```

| Dato | En vivo | Mientras no esté conectado |
|---|---|---|
| Facturación | Órdenes de la app | `store_daily` (Master Metrics) |
| Inversión y mensajes | `meta_live` (API de Meta) | `meta_daily` (Master Metrics) |
| Ventas, ticket, CAC, cortes, órdenes | Órdenes de la app | No disponible |

## Definiciones

- **Facturación y ventas**: órdenes pagadas y no canceladas, por fecha de creación, en hora de Buenos Aires. La regla está en `tn_cuenta_como_venta`. A validar contra Tiendanube con la primera tienda.
- **MER**: facturación ÷ inversión.
- **CAC**: inversión ÷ clientes nuevos. Nuevo es quien compra por primera vez en todo el historial de la tienda, identificado por la huella del mail. Mientras el historial de compradores carga, el portal avisa que el dato puede dar alto.
- **Clientes**: no se guardan datos personales. Del mail queda una huella HMAC irreversible, distinta por tienda.
- Las cuentas de Meta en USD se pasan a pesos con `settings.usd_ars`.

## Configuración en el portal de partners

| Campo | Valor |
|---|---|
| Permisos | `read_orders` y `read_fulfillment_orders` |
| Redirect URL | `https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/callback` |
| URL y Preferencias | `https://merview.vercel.app/portal.html` |
| Política de privacidad | `https://merview.vercel.app/privacidad.html` |
| Webhook Store Redact | `https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/privacy/store-redact` |
| Webhook Customer Redact | `https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/privacy/customer-redact` |
| Webhook Customers Data Request | `https://xiijrsgaxsjizfcuvklo.supabase.co/functions/v1/tn-app/privacy/customers-data-request` |
| Mail de soporte | `contacto@mkt-elevation.com` |

## Secretos (Supabase → Edge Functions → Secrets)

- `TN_CLIENT_SECRET`: Client Secret de la app de Tiendanube.
- `META_TOKEN`: token de usuario del sistema de Meta, con permiso `ads_read` y acceso a las cuentas publicitarias.

`tn_config.app_id` guarda el ID de la app, que no es secreto. `tn_config.cron_secret` lo genera la migración.

## Orden de activación

1. Aplicar `supabase/migrations/20261106_portal.sql`.
2. Aplicar `supabase/migrations/20261106_portal_cron.sql` y `20261106_compradores.sql`.
3. Redeployar la función `tn-app` con `index.ts` y `lib.ts`, con `verify_jwt` apagado.
4. Cargar secretos y `app_id`.
5. Publicar `portal.html`, `portal.js` y `privacidad.html`.
6. Conectar una tienda y comparar con Tiendanube y Master Metrics.
7. Conectar el resto. El historial se carga solo, de a un mes por tienda.
8. Cuando esté validado: reemplazar `index.html` y apagar la tarea de sync de Master Metrics.

## Marcha atrás

- Base: correr `supabase/rollback_portal.sql`. Borra tokens e historial; después hay que reconectar cada tienda.
- Función: borrar `tn-app` en Supabase → Edge Functions.
- Página: volver a un deploy anterior en Vercel.

## Pruebas

```bash
node --test tests/lib.test.mjs
```

```bash
node tests/servidor-prueba.mjs
```

El servidor usa datos inventados en `http://localhost:4173/portal.html#k=prueba`.

`tests/sql.test.mjs` corre las migraciones en un Postgres local (PGlite) con una base de prueba, sin tocar producción.
