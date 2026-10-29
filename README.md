# MER View — Elevation Media

Tablero de **inversión, facturación y MER por cliente** de Elevation Media.

- **MER** = Facturación de la tienda ÷ Inversión en Meta Ads.
- Períodos: Hoy, Ayer, Últimos 7 días, Este mes.
- Colores: verde ≥ 6, ámbar 3–6, rojo < 3.
- Sección aparte de **Generación de leads** (Vanskap, FPT Egresados, Goar): inversión, mensajes recibidos y costo por mensaje.
- Detalle por día al tocar cada cliente.

## Cómo funciona

`index.html` es una página única (HTML + CSS + JS, sin dependencias de build).
Los datos se consultan en vivo a **Master Metrics** (Meta Ads, Tiendanube y WooCommerce).

> **Importante:** hoy la página obtiene los datos a través del runtime de Artifacts de claude.ai
> (`window.claude.use("mcp")` → conector *Master Metrics*, herramienta `get_data`).
> Abierta fuera de claude.ai (por ejemplo como archivo local o en un hosting propio) muestra el
> mensaje "Esta vista no puede consultar Master Metrics".
> Para servirla de forma independiente hay que reemplazar la función `q()` por llamadas a un
> backend propio que consulte la API de Master Metrics con una API key guardada en el servidor.

## Estructura

| Archivo | Qué contiene |
|---|---|
| `index.html` | El tablero completo. |
| `docs/clientes.md` | Mapeo de cada cliente a su cuenta de Meta y su tienda. |
| `docs/reporte-semanal.md` | Prompt de la tarea programada "Cuentas en rojo" de los lunes. |

## Mantener la lista de clientes

La configuración vive en la constante `CLIENTS` de `index.html`:

```js
{n:"Nombre", meta:["<id cuenta Meta>"], tn:["<id tienda Tiendanube>"]}   // e-commerce Tiendanube
{n:"Nombre", meta:["<id>"], woo:["dominio.com"]}                          // e-commerce WooCommerce
{n:"Nombre", meta:["<id>"], leads:true}                                   // generación de leads
{n:"Nombre", meta:["<id>"]}                                               // sin tienda vinculada
```

- Alta de cliente: agregar una línea.
- Baja de cliente: borrar su línea.
- Cuentas de Meta en USD: listarlas en `USD_ACCOUNTS`; se convierten con el dólar que se carga en la página.

## Comportamiento ante errores

Si Master Metrics pierde acceso a una cuenta de Meta o a una tienda, la página aísla esa cuenta
(divide la consulta en lotes hasta encontrarla), muestra un aviso con el cliente afectado y lo
excluye del MER global. El resto de los clientes se sigue mostrando normalmente.
