# Tarea programada: "Cuentas en rojo" (lunes 9:00, hora Argentina)

Prompt para la tarea programada de Claude. La lista de clientes vigente está en `docs/clientes.md`.

```
Todos los lunes, generá el reporte "Cuentas en rojo" de Elevation Media. Idioma: español rioplatense.

PERÍODO: los 7 días anteriores (lunes a domingo) y, como referencia, el mes en curso hasta el domingo.

DATOS (conector Master Metrics, herramienta get_data):
- Meta: breakdown account_id + ad_account; métricas spend, impressions, link_clicks, reach,
  conversion_offsite_conversion.fb_pixel_add_to_cart, conversion_offsite_conversion.fb_pixel_initiate_checkout,
  conversion_offsite_conversion.fb_pixel_purchase, conversion_offsite_conversion.fb_pixel_purchase_value.
  Las conversiones vuelven en filas con account_id nulo: unilas por nombre de ad_account.
- Tiendanube: breakdown tn_common_store_id; métricas tn_orders_total_billing, tn_orders_sold_count,
  tn_orders_average_sales_ticket, tn_checkouts_count.
- WooCommerce: breakdown woocommerce_shop_id; métrica woocommerce_orders_total.
- Si una cuenta devuelve error de permisos, sacala de la consulta y reportala aparte.

CLIENTES: usar el mapeo de docs/clientes.md. Los clientes de tipo "Leads" se reportan con inversión,
mensajes (conversion_onsite_conversion.messaging_conversation_started_7d) y costo por mensaje, sin MER.

CRITERIO: MER = facturación ÷ inversión en Meta. "En rojo" = MER < 3 en los últimos 7 días.

REPORTE: resumen, tabla con embudo, cuellos de botella comunes, diagnóstico por cuenta, plan de acción
en checklist y límites de los datos.

ENTREGA: mail a julian@mkt-elevation.com con resumen de 3 líneas y link al reporte. No enviar a nadie más.
