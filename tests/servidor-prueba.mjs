// Sirve el portal con datos inventados, sin tocar Supabase. Uso: node tests/servidor-prueba.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = 4173;
let llamadas = 0;

const CLIENTES = [
  ["a", "Tienda de prueba A", "ecommerce", 4, 1],
  ["b", "Tienda de prueba B", "ecommerce", 2.2, 1],
  ["c", "Tienda de prueba C con un nombre bastante largo", "ecommerce", 1, 1],
  ["d", "Tienda de prueba D", "ecommerce", 0.6, 1],
  ["e", "Tienda sin conectar E", "ecommerce", 1.6, 0],
  ["f", "Tienda sin conectar F", "ecommerce", 0.9, 0],
  ["g", "Marca sin tienda G", "sin_tienda", 0.5, 0],
  ["l", "Cliente de leads", "leads", 0.5, 0],
].map(([id, name, kind, peso, vivo]) => ({ id, name, kind, peso, vivo }));

const sumar = (s, n) => new Date(new Date(s + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const azar = (s) => { let h = 7; for (const c of s) h = (h * 131 + c.charCodeAt(0) * 17) % 99991; return ((h * 7919) % 99991) / 99991; };
function dia(c, d) {
  const r = azar(c.id + d), base = 900000 * c.peso * (0.55 + r);
  const orders = c.vivo ? Math.round(base / 52000) : null;
  const nuevos = c.vivo ? Math.round(orders * (0.5 + r / 3)) : null;
  return {
    client_id: c.id, day: d, revenue: c.kind === "ecommerce" ? Math.round(base) : 0, orders,
    spend: Math.round(base / (2.5 + r * 7)), messages: c.kind === "leads" ? Math.round(r * 90) : 0,
    nuevos, recurrentes: c.vivo ? orders - nuevos : null,
  };
}
function serie(c, a, b) { const out = []; for (let d = a; d <= b; d = sumar(d, 1)) out.push(dia(c, d)); return out; }

function general({ p_since: a, p_until: b }) {
  llamadas++;
  const clientes = CLIENTES.map((c) => {
    const s = serie(c, a, b);
    return {
      id: c.id, name: c.name, kind: c.kind, activo: true,
      tn_stores: c.kind === "ecommerce" ? [c.id] : [], woo_shops: [], meta_accounts: ["m" + c.id],
      revenue: s.reduce((x, d) => x + d.revenue, 0) + (c.id === "a" ? llamadas * 85000 : 0),
      orders: c.vivo ? s.reduce((x, d) => x + d.orders, 0) : null,
      spend: s.reduce((x, d) => x + d.spend, 0), messages: s.reduce((x, d) => x + d.messages, 0),
      tiendas_vivo: c.vivo, error_tienda: c.id === "d" ? "orders: HTTP 401" : null,
    };
  });
  const eco = CLIENTES.filter((c) => c.kind !== "leads");
  const dias = [];
  for (let d = a; d <= b; d = sumar(d, 1)) {
    const ds = eco.map((c) => dia(c, d));
    dias.push({ day: d, revenue: ds.reduce((x, r) => x + r.revenue, 0), orders: 0, spend: ds.reduce((x, r) => x + r.spend, 0) });
  }
  return {
    ahora: new Date().toISOString(), app_id: "12345", clientes, dias,
    prev: { revenue: dias.reduce((x, d) => x + d.revenue, 0) * 0.85, spend: dias.reduce((x, d) => x + d.spend, 0) * 0.92 },
    estado: { tn_ultima_sync: new Date(Date.now() - 120000).toISOString(), meta_ultima_sync: new Date(Date.now() - 180000).toISOString(), meta_errores: 0, mm_ultima_sync: new Date(Date.now() - 3600000).toISOString() },
  };
}

function cliente({ p_client: id, p_since: a, p_until: b, p_limit: lim }) {
  const c = CLIENTES.find((x) => x.id === id);
  if (!c) return null;
  const dias = serie(c, a, b).map(({ client_id, ...r }) => r);
  const conectada = !!c.vivo;
  const fac = dias.reduce((x, d) => x + d.revenue, 0), v = dias.reduce((x, d) => x + (d.orders || 0), 0);
  const part = (k, f) => ({ k, ventas: Math.round(v * f), total: Math.round(fac * f) });
  const total = Math.max(v, 3) + llamadas;
  const ordenes = conectada ? Array.from({ length: Math.min(lim, total) }, (_, i) => ({
    number: 5000 + total - i, total: 30000 + ((i * 7919) % 90000), currency: "ARS",
    payment_status: i % 7 === 3 ? "pending" : "paid", status: i % 23 === 11 ? "cancelled" : "open",
    created_at: new Date(Date.now() - i * 41 * 60000).toISOString(), gateway: i % 3 ? "Mercado Pago" : "Pago Nube",
    payment_method: ["credit_card", "debit_card", "wire_transfer", "other"][i % 4], installments: [1, 3, 6][i % 3],
    shipping_option: ["Andreani Estándar", "Andreani Sucursal", "Retiro en local"][i % 3], unidades: 1 + (i % 3),
    items: [{ n: "Jean recto azul talle 38", q: 1 + (i % 2), p: 45000 }, ...(i % 2 ? [{ n: "Remera lisa negra", q: 1, p: 15000 }] : [])],
    tipo: i % 2 ? "Nuevo" : "Recurrente",
  })) : [];
  return {
    ahora: new Date().toISOString(),
    cliente: { id: c.id, name: c.name, kind: c.kind, tn_stores: c.kind === "ecommerce" ? [c.id] : [], woo_shops: [], meta_accounts: ["m" + c.id] },
    tiendas: c.kind === "ecommerce" ? [{ store_id: c.id, conectada, coverage_from: conectada ? "2025-10-01" : null, last_sync_at: new Date(Date.now() - 120000).toISOString(), last_webhook_at: new Date(Date.now() - 60000).toISOString(), last_error: null }] : [],
    meta_sync: new Date(Date.now() - 180000).toISOString(), dias,
    pendiente: { total: conectada ? Math.round(fac * 0.08) : 0, ordenes: conectada ? Math.round(v * 0.1) : 0 },
    tipos: conectada ? [part("Nuevo", 0.62), part("Recurrente", 0.38)] : [],
    pagos: conectada ? [part("credit_card", 0.51), part("custom", 0.28), part("other", 0.13), part("debit_card", 0.08)] : [],
    pasarelas: [],
    cuotas: conectada ? [part(1, 0.52), part(3, 0.33), part(6, 0.15)] : [],
    envios: conectada ? [part("Andreani Estándar", 0.56), part("Andreani Sucursal", 0.27), part("Te vamos a contactar para coordinar la entrega", 0.09), part("Retiro en local", 0.04), part("Moto CABA", 0.02), part("OCA", 0.01), part("Correo", 0.01)] : [],
    ordenes_total: conectada ? total : 0, ordenes,
  };
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (m) {
    let cuerpo = ""; for await (const c of req) cuerpo += c;
    const a = JSON.parse(cuerpo);
    res.setHeader("Content-Type", "application/json");
    if (a.p_key !== "prueba") { res.statusCode = 400; return res.end(JSON.stringify({ message: "clave_invalida" })); }
    return res.end(JSON.stringify(m[1] === "portal_general" ? general(a) : cliente(a)));
  }
  if (url.pathname === "/config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(`window.MERVIEW_CONFIG={supabaseUrl:location.origin,supabaseKey:"x"};`);
  }
  try {
    const archivo = url.pathname === "/" ? "portal.html" : url.pathname.slice(1);
    const cuerpo = await readFile(join(raiz, archivo));
    res.setHeader("Content-Type", TIPOS[extname(archivo)] || "text/plain");
    res.end(cuerpo);
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(PUERTO, () => console.log(`http://localhost:${PUERTO}/portal.html#k=prueba`));
