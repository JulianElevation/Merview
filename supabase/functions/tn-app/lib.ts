// Lógica pura de la app (sin dependencias, se prueba con Node).

export const API_VERSION = "2025-03";
export const USER_AGENT = "Elevation Portal (contacto@mkt-elevation.com)";
export const ORDER_FIELDS = [
  "id", "number", "total", "subtotal", "discount", "currency", "payment_status", "status",
  "storefront", "gateway_name", "payment_details", "fulfillments", "contact_email", "products",
  "created_at", "paid_at", "cancelled_at", "updated_at",
].join(",");
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

const numero = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function envio(o: Record<string, any>): string | null {
  const f = Array.isArray(o.fulfillments) ? o.fulfillments[0] : null;
  return f?.shipping?.option?.name ?? f?.shipping?.carrier?.name ?? o.shipping_option ?? null;
}

// Se queda con los datos de la venta. Del comprador solo sale una huella irreversible del mail,
// distinta para cada tienda, que sirve para saber si ya había comprado.
export async function normalizarOrden(storeId: string, o: Record<string, any>, secreto: string) {
  const mail = typeof o.contact_email === "string" ? o.contact_email.trim().toLowerCase() : "";
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
    buyer_hash: mail ? (await hmacHex(secreto, `${storeId}|${mail}`)).slice(0, 32) : null,
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
    async ordenes(filtro: Record<string, string>) {
      const out: Record<string, any>[] = [];
      for (let page = 1; ; page++) {
        const q = new URLSearchParams({ ...filtro, per_page: "200", page: String(page), aggregates: "fulfillment_orders", fields: ORDER_FIELDS });
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
