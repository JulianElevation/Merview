# MER View — Elevation Media

Tablero de **inversión, facturación y MER por cliente** de Elevation Media.

- **MER** = Facturación de la tienda ÷ Inversión en Meta Ads.
- Períodos: Hoy, Ayer, Últimos 7 días, Este mes.
- Colores: verde ≥ 6, ámbar 3–6, rojo < 3.
- Sección aparte de **Generación de leads** (Vanskap, FPT Egresados, Goar): inversión, mensajes recibidos y costo por mensaje.
- Detalle por día al tocar cada cliente.
- Acceso solo con email **@mkt-elevation.com** (link mágico por mail).

## Arquitectura

```
Master Metrics (Meta, Tiendanube, WooCommerce)
        │  tarea programada diaria de Claude (conectores Master Metrics + Supabase)
        ▼
Supabase (Postgres) ── RLS: solo usuarios @mkt-elevation.com verificados
        │  supabase-js con la publishable key
        ▼
Vercel (index.html estático) ── login por link mágico
```

| Archivo | Qué contiene |
|---|---|
| `index.html` | Tablero web: login + lectura de Supabase. |
| `config.js` | URL de Supabase, publishable key (pública por diseño) y dominio permitido. |
| `vercel.json` | Headers de seguridad. |
| `claude-artifact/index.html` | Versión anterior que corre dentro de claude.ai consultando Master Metrics en vivo. |
| `docs/clientes.md` | Mapeo de cada cliente a su cuenta de Meta y su tienda. |
| `docs/reporte-semanal.md` | Prompt de la tarea programada "Cuentas en rojo" de los lunes. |

## Base de datos (Supabase, proyecto "Merview")

| Tabla / vista | Uso |
|---|---|
| `clients` | Lista de clientes: `kind` (`ecommerce`, `leads`, `sin_tienda`), `meta_accounts`, `tn_stores`, `woo_shops`, `active`. |
| `settings` | `usd_ars` = tipo de cambio para cuentas en USD. |
| `meta_daily` | Inversión y mensajes por cuenta y día. |
| `store_daily` | Facturación por tienda y día. |
| `client_daily` (vista) | Inversión en ARS, mensajes y facturación por cliente y día. |
| `sync_runs` | Registro de cada sincronización. |
| `source_errors` | Cuentas/tiendas que Master Metrics no pudo leer. |

La carga se hace con la función `merview_ingest(fuente, mes, ids, filas, cuentas_usd)`,
que solo puede ejecutar el rol de servicio (no está expuesta a usuarios).

## Mantener la lista de clientes

Alta, baja o cambio de cuentas: editar la tabla `clients` en Supabase (Table Editor).
- Baja: poner `active = false`.
- Cuentas de Meta en USD: pasarlas en el parámetro `p_usd` de la carga; se convierten con `settings.usd_ars`.
