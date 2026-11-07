// Lógica pura de la app (sin dependencias, se prueba con Node).

export const API_VERSION = "2025-03";
export const USER_AGENT = "Elevation Portal (contacto@mkt-elevation.com)";
export const ORDER_FIELDS = [
  "id", "number", "total", "subtotal", "discount", "currency", "payment_status", "status",
  "storefront", "gateway_name", "payment_details", "fulfillments", "contact_email", "products",
  "created_at", "paid_at", "cancelled_at", "updated_at",
].join(",");
export const BUYER_FIELDS = "id,contact_email,payment_status,status,created_at";
export const ORDER_EVENTS = [
  "order/created", "order/paid", "order/pending", "order/voided", "order/cancelled", "order/edited",
];
export const APP_EVENTS = ["app/uninstalled"];
export const META_VERSION = "v23.0";
export const DIAS_HISTORIA = 400;

const enc = new TextEncoder();

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function igualSeguro(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !a.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function firmaValida(secret: string, body: string, firma: string | null): Promise<boolean> {
  if (!secret || !firma) return false;
  return igualSeguro(await hmacHex(secret, body), firma.trim().toLowerCase());
}

// Huella irreversible del mail, distinta para cada tienda.
export async function huella(secreto: string, storeId: string, mailCrudo: unknown): Promise<string | null> {
  const mail = typeof mailCrudo === "string" ? mailCrudo.trim().toLowerCase() : "";
  return mail ? (await hmacHex(secreto, `${storeId}|${mail}`)).slice(0, 32) : null;
}

const numero = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function envio(o: Record<string, any>): string | null {
  const f = Array.isArray(o.fulfillments) ? o.fulfillments[0] : null;
  return f?.shipping?.option?.name ?? f?.shipping?.carrier?.name ?? o.shipping_option ?? null;
}

// Se queda con los datos de la venta. Del comprador solo sale una huella irreversible del mail,
// distinta para cada tienda, que sirve para saber si ya había comprado.
export async function normalizarOrden(storeId: string, o: Record<string, any>, secreto: string) {
  const productos = Array.isArray(o.products) ? o.products : [];
  return {
    store_id: String(storeId),
    order_id: Number(o.id),
    number: o.number == null ? null : Number(o.number),
    total: numero(o.total) ?? 0,
    subtotal: numero(o.subtotal),
    discount: numero(o.discount),
    shipping_cost: numero(o.shipping_cost_customer),
    currency: o.currency ?? null,
    payment_status: o.payment_status ?? null,
    status: o.status ?? null,
    storefront: o.storefront ?? null,
    gateway: o.gateway_name ?? null,
    payment_method: o.payment_details?.method ?? null,
    card_company: o.payment_details?.credit_card_company ?? null,
    installments: numero(o.payment_details?.installments),
    shipping_option: envio(o),
    unidades: productos.reduce((s: number, p: any) => s + (Number(p.quantity) || 0), 0),
    items: productos.slice(0, 20).map((p: any) => ({
      n: typeof p.name === "object" && p.name ? (p.name.es ?? Object.values(p.name)[0]) : p.name,
      q: Number(p.quantity) || 0,
      p: numero(p.price),
    })),
    buyer_hash: await huella(secreto, String(storeId), o.contact_email),
    created_at: o.created_at,
    paid_at: o.paid_at ?? null,
    cancelled_at: o.cancelled_at ?? null,
    updated_at: o.updated_at ?? o.created_at,
  };
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clienteTN(storeId: string, token: string, f: Fetcher = fetch, esperar = espera) {
  const base = `https://api.tiendanube.com/${API_VERSION}/${storeId}`;
  const headers = { "Authorization": `Bearer ${token}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" };
  async function llamar(path: string, init?: RequestInit): Promise<Response> {
    for (let intento = 0; ; intento++) {
      const r = await f(base + path, { ...init, headers });
      if (r.status !== 429 || intento >= 3) return r;
      const reset = Number(r.headers.get("x-rate-limit-reset")) || 1500;
      await esperar(Math.min(reset, 5000));
    }
  }
  return {
    llamar,
    async orden(id: string | number) {
      const r = await llamar(`/orders/${id}?aggregates=fulfillment_orders&fields=${ORDER_FIELDS}`);
      if (r.status === 404) {
        const cuerpo = await r.text();
        if (/invalid/i.test(cuerpo)) throw new Error(`orden ${id}: HTTP 404 ${cuerpo.slice(0, 200)}`);
        return null;
      }
      if (!r.ok) throw new Error(`orden ${id}: HTTP ${r.status}`);
      return await r.json();
    },
    // Trae todas las páginas. Tiendanube responde 404 cuando no hay más resultados.
    async ordenes(filtro: Record<string, string>, campos = ORDER_FIELDS) {
      const out: Record<string, any>[] = [];
      for (let page = 1; ; page++) {
        const q = new URLSearchParams({ ...filtro, per_page: "200", page: String(page), fields: campos });
        if (campos === ORDER_FIELDS) q.set("aggregates", "fulfillment_orders");
        const r = await llamar(`/orders?${q}`);
        if (r.status === 404) {
          // Solo "Last page" significa que no hay más. Cualquier otro 404 es un error de verdad.
          const cuerpo = await r.text();
          if (/last page/i.test(cuerpo)) break;
          throw new Error(`orders: HTTP 404 ${cuerpo.slice(0, 200)}`);
        }
        if (!r.ok) throw new Error(`orders: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        const lote = await r.json();
        out.push(...lote);
        if (lote.length < 200) break;
      }
      return out;
    },
    // Dice si la tienda tiene alguna orden anterior a esa fecha.
    async hayOrdenesAntes(fecha: string) {
      const q = new URLSearchParams({ created_at_max: fecha, per_page: "1", fields: "id" });
      const r = await llamar(`/orders?${q}`);
      if (r.status === 404) {
        const cuerpo = await r.text();
        if (/last page/i.test(cuerpo)) return false;
        throw new Error(`orders: HTTP 404 ${cuerpo.slice(0, 200)}`);
      }
      if (!r.ok) throw new Error(`orders: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).length > 0;
    },
    async tienda() {
      const r = await llamar("/store?fields=id,name,main_currency");
      if (!r.ok) throw new Error(`store: HTTP ${r.status}`);
      return await r.json();
    },
    // Deja cada evento registrado una sola vez.
    async asegurarWebhooks(url: string, eventos: string[]) {
      const r = await llamar("/webhooks?per_page=200");
      const existentes: { id: number; event: string; url: string }[] = r.ok ? await r.json() : [];
      for (const ev of eventos) {
        if (existentes.some((w) => w.event === ev && w.url === url)) continue;
        const c = await llamar("/webhooks", { method: "POST", body: JSON.stringify({ event: ev, url }) });
        if (!c.ok) throw new Error(`webhook ${ev}: HTTP ${c.status}`);
      }
    },
  };
}

export function nombreTienda(t: { name?: unknown }): string | null {
  const n = t?.name;
  if (!n) return null;
  if (typeof n === "string") return n;
  const o = n as Record<string, string>;
  return o.es || Object.values(o)[0] || null;
}

// Historial: de a un mes hacia atrás. Devuelve null cuando ya se llegó al límite.
export function proximaVentana(coverageFrom: string | null, hoy: string, dias = 31, limite = DIAS_HISTORIA) {
  const d = (s: string) => new Date(s + "T12:00:00Z");
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const tope = new Date(d(hoy).getTime() - limite * 864e5);
  const hasta = coverageFrom ? d(coverageFrom) : d(hoy);
  if (hasta <= tope) return null;
  const desde = new Date(Math.max(hasta.getTime() - dias * 864e5, tope.getTime()));
  return { desde: iso(desde), hasta: iso(hasta) };
}

export function ventanaAtras(hasta: string, dias = 31) {
  const fin = new Date(hasta + "T12:00:00Z");
  return { desde: new Date(fin.getTime() - dias * 864e5).toISOString().slice(0, 10), hasta };
}

// Del historial viejo solo queda quién compró y cuándo: una fila por venta pagada, sin nada más.
export async function filasCompradores(storeId: string, ordenes: Record<string, any>[], secreto: string) {
  const pagadas = ordenes.filter((o) => o.payment_status === "paid" && o.status !== "cancelled" && o.created_at);
  const filas = await Promise.all(pagadas.map(async (o) => ({
    store_id: String(storeId), buyer_hash: await huella(secreto, String(storeId), o.contact_email), first_paid_at: o.created_at,
  })));
  return filas.filter((f) => f.buyer_hash);
}

const MENSAJES = "onsite_conversion.messaging_conversation_started_7d";

export function filasMeta(accountId: string, moneda: string | null, data: Record<string, any>[]) {
  return data.map((x) => ({
    day: x.date_start,
    account_id: accountId,
    currency: x.account_currency ?? moneda,
    spend: numero(x.spend) ?? 0,
    impressions: numero(x.impressions),
    clicks: numero(x.clicks),
    messages: numero((x.actions ?? []).find((a: any) => a.action_type === MENSAJES)?.value) ?? 0,
  }));
}

// Inversión diaria de una cuenta. Sigue la paginación de Meta.
export async function insightsMeta(accountId: string, token: string, desde: string, hasta: string, f: Fetcher = fetch) {
  const q = new URLSearchParams({
    level: "account", time_increment: "1", limit: "500",
    fields: "spend,impressions,clicks,actions,account_currency",
    time_range: JSON.stringify({ since: desde, until: hasta }),
  });
  let url: string | null = `https://graph.facebook.com/${META_VERSION}/act_${accountId}/insights?${q}`;
  const filas: Record<string, any>[] = [];
  while (url) {
    const r: Response = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message ?? `meta: HTTP ${r.status}`);
    filas.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  return filasMeta(accountId, null, filas);
}

// Inversión diaria por campaña, solo para clientes que separan campañas B2B.
export function filasCampanas(accountId: string, data: Record<string, any>[]) {
  return data.filter((x) => x.campaign_id).map((x) => ({
    day: x.date_start,
    campaign_id: String(x.campaign_id),
    account_id: accountId,
    currency: x.account_currency ?? null,
    spend: numero(x.spend) ?? 0,
    messages: numero((x.actions ?? []).find((a: any) => a.action_type === MENSAJES)?.value) ?? 0,
  }));
}

async function paginasMeta(url0: string, token: string, f: Fetcher) {
  let url: string | null = url0;
  const filas: Record<string, any>[] = [];
  while (url) {
    const r: Response = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message ?? `meta: HTTP ${r.status}`);
    filas.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  return filas;
}

/* ---------- Análisis de resultados: se pide a Meta en el momento, no se guarda ---------- */

const accion = (lista: any[] | undefined, tipos: string[]) => {
  for (const t of tipos) {
    const hallada = (lista ?? []).find((a: any) => a.action_type === t);
    if (hallada) return numero(hallada.value) ?? 0;
  }
  return 0;
};

// Etapas del embudo y resultado de una fila de Meta, con los importes en pesos.
export function resumirMeta(x: Record<string, any>, usdArs = 1) {
  const f = x.account_currency === "USD" ? usdArs : 1;
  const a = x.actions;
  return {
    spend: (numero(x.spend) ?? 0) * f,
    impresiones: numero(x.impressions) ?? 0,
    clics: numero(x.inline_link_clicks) ?? 0,
    visitas: accion(a, ["omni_landing_page_view", "landing_page_view"]),
    carritos: accion(a, ["omni_add_to_cart", "add_to_cart"]),
    pagos: accion(a, ["omni_initiated_checkout", "initiate_checkout"]),
    compras: accion(a, ["omni_purchase", "purchase"]),
    valor: accion(x.action_values, ["omni_purchase", "purchase"]) * f,
    mensajes: accion(a, [MENSAJES]),
  };
}
type Resumen = ReturnType<typeof resumirMeta>;
export function sumarResumen(filas: Resumen[]): Resumen {
  const t = resumirMeta({});
  for (const r of filas) for (const k of Object.keys(t) as (keyof Resumen)[]) t[k] += r[k];
  return t;
}

const CAMPOS_RESULTADO = "spend,impressions,inline_link_clicks,actions,action_values,account_currency";

async function insightsNivel(accountId: string, token: string, nivel: string, desde: string, hasta: string, extra: string, f: Fetcher) {
  const q = new URLSearchParams({
    level: nivel, limit: "500", fields: `${extra}${CAMPOS_RESULTADO}`,
    time_range: JSON.stringify({ since: desde, until: hasta }),
  });
  return await paginasMeta(`https://graph.facebook.com/${META_VERSION}/act_${accountId}/insights?${q}`, token, f);
}

// Mismo anuncio en varios conjuntos: se muestra una vez. La imagen sale del que más invirtió.
export function agruparAnuncios(filas: Record<string, any>[], usdArs = 1) {
  const m = new Map<string, Resumen & { id: string; nombre: string; campana: string; mayor: number }>();
  for (const x of filas) {
    const nombre = String(x.ad_name ?? x.ad_id).trim(), r = resumirMeta(x, usdArs), g = m.get(nombre);
    if (!g) { m.set(nombre, { ...r, id: String(x.ad_id), nombre, campana: x.campaign_name ?? "", mayor: r.spend }); continue; }
    if (r.spend > g.mayor) { g.id = String(x.ad_id); g.campana = x.campaign_name ?? g.campana; g.mayor = r.spend; }
    for (const k of Object.keys(r) as (keyof Resumen)[]) g[k] += r[k];
  }
  return [...m.values()].sort((a, b) => b.compras - a.compras || b.valor - a.valor).map(({ mayor: _, ...x }) => x);
}

const CAMPOS_PIEZA = "image_url,thumbnail_url,video_id,product_set_id,effective_object_story_id,effective_instagram_media_id,object_story_spec,asset_feed_spec";

// La toma elegida en el anuncio va primero; el resto queda para poder cambiarla.
export function ordenarTomas(lista: { uri?: string; is_preferred?: boolean }[] = []) {
  return [...lista].filter((x) => x.uri).sort((a, b) => Number(!!b.is_preferred) - Number(!!a.is_preferred)).map((x) => x.uri as string);
}

// Todas las imágenes posibles de una pieza, de la mejor a la peor. Cada fuente puede fallar por permisos sin frenar a las demás.
async function opcionesDePieza(c: Record<string, any>, pedir: (nodo: string, p: Record<string, string>) => Promise<any>) {
  const out: string[] = [];
  const sumar = (u: unknown) => { if (typeof u === "string" && u && !out.includes(u)) out.push(u); };
  const intento = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { console.error("imagen de anuncio:", c.id, String((e as Error)?.message ?? e).slice(0, 160)); }
  };
  const spec = c.object_story_spec ?? {}, feed = c.asset_feed_spec ?? {};
  const video = c.video_id ?? spec.video_data?.video_id ?? feed.videos?.[0]?.video_id;
  if (video) {
    await intento(async () => {
      const v = await pedir(String(video), { fields: "picture,thumbnails{uri,is_preferred}" });
      ordenarTomas(v.thumbnails?.data).forEach(sumar);
      if (!out.length) sumar(v.picture);
    });
  }
  if (c.product_set_id) {
    await intento(async () => {
      const p = await pedir(`${c.product_set_id}/products`, { fields: "image_url", limit: "8" });
      (p.data ?? []).forEach((x: any) => sumar(x.image_url));
    });
  }
  sumar(c.image_url); sumar(spec.video_data?.image_url); sumar(spec.link_data?.picture);
  (feed.images ?? []).slice(0, 4).forEach((x: any) => sumar(x.url));
  (spec.link_data?.child_attachments ?? []).slice(0, 6).forEach((x: any) => sumar(x.picture));
  if (!out.length && c.effective_object_story_id) await intento(async () => { sumar((await pedir(c.effective_object_story_id, { fields: "full_picture" })).full_picture); });
  if (!out.length && c.effective_instagram_media_id) {
    await intento(async () => {
      const m = await pedir(c.effective_instagram_media_id, { fields: "media_url,thumbnail_url,media_type" });
      sumar(m.thumbnail_url);
      // En un video, media_url es el mp4: no sirve como imagen.
      if (m.media_type !== "VIDEO") sumar(m.media_url);
    });
  }
  // En catálogo, la miniatura es el ícono genérico de Meta: mejor no mostrarla.
  if (!out.length && !c.product_set_id) await intento(async () => { sumar((await pedir(c.id, { fields: "thumbnail_url", thumbnail_width: "1080", thumbnail_height: "1080" })).thumbnail_url); });
  return out.slice(0, 10);
}

// Dirección de la vista previa que arma Meta para un anuncio. Viene adentro de un iframe en HTML.
export function urlDeVistaPrevia(html: unknown) {
  const m = typeof html === "string" ? html.match(/src="([^"]+)"/) : null;
  if (!m) return null;
  const url = m[1].replace(/&amp;/g, "&");
  return /^https:\/\/([a-z0-9-]+\.)*facebook\.com\//.test(url) ? url : null;
}

// Si falla la imagen, el anuncio se muestra igual, sin pieza.
async function imagenesAnuncios(ids: string[], token: string, f: Fetcher) {
  const out: Record<string, { imagenes: string[]; vista: string | null }> = {};
  if (!ids.length) return out;
  const pedir = async (nodo: string, params: Record<string, string>) => {
    const r = await f(`https://graph.facebook.com/${META_VERSION}/${nodo}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message ?? `meta: HTTP ${r.status}`);
    return j;
  };
  // De a uno: Meta ya no acepta pedir varios juntos, y así uno que falla no arrastra al resto.
  await Promise.all(ids.map(async (id) => {
    try {
      const pieza = (await pedir(id, { fields: "creative{id}" })).creative?.id;
      if (!pieza) return;
      const imagenes = await opcionesDePieza(await pedir(pieza, { fields: CAMPOS_PIEZA }), pedir);
      let vista: string | null = null;
      // Sin ninguna imagen (catálogo, en general), la vista previa de Meta muestra el anuncio real.
      if (!imagenes.length) {
        const p = await pedir(`${id}/previews`, { ad_format: "INSTAGRAM_STANDARD" });
        vista = urlDeVistaPrevia(p.data?.[0]?.body);
      }
      out[id] = { imagenes, vista };
    } catch (e) {
      console.error("imagen de anuncio:", id, String((e as Error)?.message ?? e).slice(0, 200));
    }
  }));
  return out;
}

export async function analisisMeta(accountId: string, token: string, desde: string, hasta: string, comparaDesde: string | null, comparaHasta: string | null, usdArs = 1, f: Fetcher = fetch) {
  const [cuenta, compara, campanas, anuncios] = await Promise.all([
    insightsNivel(accountId, token, "account", desde, hasta, "", f),
    comparaDesde && comparaHasta ? insightsNivel(accountId, token, "account", comparaDesde, comparaHasta, "", f) : Promise.resolve(null),
    insightsNivel(accountId, token, "campaign", desde, hasta, "campaign_id,campaign_name,", f),
    insightsNivel(accountId, token, "ad", desde, hasta, "ad_id,ad_name,campaign_name,", f),
  ]);
  const top = agruparAnuncios(anuncios, usdArs).slice(0, 10);
  const imagenes = await imagenesAnuncios(top.filter((x) => x.compras > 0).map((x) => x.id), token, f);
  return {
    periodo: sumarResumen(cuenta.map((x) => resumirMeta(x, usdArs))),
    compara: compara ? sumarResumen(compara.map((x) => resumirMeta(x, usdArs))) : null,
    campanas: campanas.map((x) => ({ id: String(x.campaign_id), nombre: x.campaign_name ?? String(x.campaign_id), ...resumirMeta(x, usdArs) })),
    anuncios: top.map((x) => ({ ...x, imagenes: imagenes[x.id]?.imagenes ?? [], vista: imagenes[x.id]?.vista ?? null })),
  };
}

// Devuelve el gasto por día y el nombre actual de cada campaña: si se renombra, corrige también los días pasados.
export async function campanasMeta(accountId: string, token: string, desde: string, hasta: string, f: Fetcher = fetch) {
  const base = `https://graph.facebook.com/${META_VERSION}/act_${accountId}`;
  const q = new URLSearchParams({
    level: "campaign", time_increment: "1", limit: "500",
    fields: "campaign_id,campaign_name,spend,actions,account_currency",
    time_range: JSON.stringify({ since: desde, until: hasta }),
  });
  const insights = await paginasMeta(`${base}/insights?${q}`, token, f);
  const lista = await paginasMeta(`${base}/campaigns?${new URLSearchParams({ fields: "id,name,objective", limit: "500" })}`, token, f);
  const campanas = new Map<string, { campaign_id: string; account_id: string; name: string; objective: string | null }>();
  for (const x of insights) if (x.campaign_id) campanas.set(String(x.campaign_id), { campaign_id: String(x.campaign_id), account_id: accountId, name: x.campaign_name ?? String(x.campaign_id), objective: null });
  for (const c of lista) campanas.set(String(c.id), { campaign_id: String(c.id), account_id: accountId, name: c.name ?? String(c.id), objective: c.objective ?? null });
  return { campanas: [...campanas.values()], filas: filasCampanas(accountId, insights) };
}
