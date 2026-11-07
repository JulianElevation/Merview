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

const BAJAS = [], MOV = [
  { id: 2, client_id: "x", name: "Marca que se fue", tipo: "baja", fecha: new Date().toISOString().slice(0, 8) + "02", motivo: "Dejó de invertir" },
  { id: 1, client_id: "a", name: "Tienda de prueba A", tipo: "alta", fecha: "2026-09-15", motivo: null },
];
function agencia() {
  const extra = { a: {}, b: { sin_gasto_12h: true }, c: { inv_ayer: 0 }, d: { ult_venta: "2026-11-01", dias_sin_venta: 5, fac_7: 200000, fac_7_prev: 500000 }, e: {}, f: { inv_30: 0 }, g: { inv_ayer: 0, sin_gasto_12h: true } };
  return {
    ahora: new Date().toISOString(), gasto_medible: true,
    clientes: CLIENTES.map((c) => ({ id: c.id, name: c.name, kind: c.kind, con_meta: true, inv_hoy: 5000, inv_ayer: 5000, inv_30: 90000, fac_7: 500000, fac_7_prev: 500000, tiendas_vivas: c.vivo, ult_venta: new Date().toISOString().slice(0, 10), dias_sin_venta: 0, sin_gasto_12h: false, inv_7: 100000, inv_7_prev: 100000, ...(extra[c.id] || {}) })),
    movimientos: MOV,
    inactivos: BAJAS.map((c) => ({ id: c.id, name: c.name })),
    tiendas_libres: [{ id: "99", name: "Tienda nueva conectada" }],
  };
}

const MARCADOS = new Set(["b"]);
let ultimoSlides = null;
const CAMPANAS = [
  { id: "1", nombre: "Ventas | Catálogo | CBO", objetivo: "OUTCOME_SALES", factor: 0.32, msgs: 46, b2b: false, parece_mensajes: false },
  { id: "2", nombre: "Interacción Manual IG (B2B)", objetivo: "OUTCOME_ENGAGEMENT", factor: 0.33, msgs: 2300, b2b: true, parece_mensajes: false },
  { id: "3", nombre: "Mayoristas WhatsApp (B2B)", objetivo: "OUTCOME_ENGAGEMENT", factor: 0.2, msgs: 1400, b2b: true, parece_mensajes: false },
  { id: "4", nombre: "Interacción Manual IG sin marcar", objetivo: "OUTCOME_SALES", factor: 0.15, msgs: 1066, b2b: false, parece_mensajes: true },
];
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
  const meses = []; { const h = new Date(); for (let i = 11; i >= 0; i--) { const d = new Date(h.getFullYear(), h.getMonth() - i, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); } }
  const mv = (m) => Math.round(80 + azar(c.id + m) * 220);
  return {
    unidades: conectada ? Math.round(v * 1.4) : 0,
    prev: { revenue: fac * 0.86, orders: v ? Math.round(v * 0.92) : null, spend: dias.reduce((x, d) => x + d.spend, 0) * 1.08, messages: 40, unidades: Math.round(v * 1.2), nuevos: Math.round(v * 0.5) },
    productos: conectada ? ["Jean recto azul", "Remera lisa negra", "Campera de jean con un nombre bastante más largo de lo normal", "Pollera", "Buzo"].map((nombre, i) => ({ nombre, unidades: 120 - i * 21, total: (120 - i * 21) * 31000 })) : [],
    meses: conectada ? meses.map((mes) => { const ventas = mv(mes), nuevos = Math.round(ventas * 0.68); return { mes, ventas, revenue: ventas * 52000, nuevos, recurrentes: ventas - nuevos }; }) : [],
    meses_pagos: conectada ? meses.flatMap((mes) => [["credit_card", 0.5], ["wire_transfer", 0.25], ["wallet", 0.15], ["debit_card", 0.1]].map(([k, f]) => ({ mes, k, ventas: Math.round(mv(mes) * f) }))) : [],
    meses_cuotas: conectada ? meses.flatMap((mes) => [[1, 0.5], [3, 0.3], [6, 0.2]].map(([k, f]) => ({ mes, k, ventas: Math.round(mv(mes) * f) }))) : [],
    ahora: new Date().toISOString(),
    cliente: { id: c.id, name: c.name, kind: c.kind, tn_stores: c.kind === "ecommerce" ? [c.id] : [], woo_shops: [], meta_accounts: ["m" + c.id] },
    tiendas: c.kind === "ecommerce" ? [{ store_id: c.id, conectada, coverage_from: conectada ? "2025-10-01" : null, last_sync_at: new Date(Date.now() - 120000).toISOString(), last_webhook_at: new Date(Date.now() - 60000).toISOString(), last_error: null }] : [],
    meta_sync: new Date(Date.now() - 180000).toISOString(), dias,
    pendiente: { total: conectada ? Math.round(fac * 0.08) : 0, ordenes: conectada ? Math.round(v * 0.1) : 0 },
    tipos: conectada ? [part("Nuevo", 0.62), part("Recurrente", 0.38)] : [],
    pagos: conectada ? [part("credit_card", 0.51), part("custom", 0.28), part("other", 0.12), part("debit_card", 0.06), part("cash", 0.02), part("ticket", 0.01)] : [],
    pasarelas: conectada ? [part("Mercado Pago", 0.64), part("Pago Nube", 0.3), part("Transferencia", 0.06)] : [],
    cuotas: conectada ? [part(1, 0.52), part(3, 0.33), part(6, 0.15)] : [],
    envios: conectada ? [part("Andreani Estándar", 0.56), part("Andreani Sucursal", 0.27), part("Te vamos a contactar para coordinar la entrega", 0.09), part("Retiro en local", 0.04), part("Moto CABA", 0.02), part("OCA", 0.01), part("Correo", 0.01)] : [],
    ordenes_total: conectada ? total : 0, ordenes,
  };
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (m) {
    let cuerpo = ""; for await (const c of req) cuerpo += c;
    const a = JSON.parse(cuerpo);
    res.setHeader("Content-Type", "application/json");
    if (m[1] === "portal_mi_tablero") {
      if (a.p_token !== "cliente-a") { res.statusCode = 400; return res.end(JSON.stringify({ message: "clave_invalida" })); }
      const r = cliente({ ...a, p_client: "a" });
      delete r.cliente.tn_stores; delete r.cliente.woo_shops; delete r.cliente.meta_accounts;
      r.tiendas.forEach((t) => { delete t.store_id; delete t.last_error; });
      return res.end(JSON.stringify(r));
    }
    if (a.p_key !== "prueba") { res.statusCode = 400; return res.end(JSON.stringify({ message: "clave_invalida" })); }
    if (m[1] === "portal_link_cliente") return res.end(JSON.stringify(a.p_renovar ? "cliente-a-nuevo" : "cliente-a"));
    if (m[1] === "portal_agencia") return res.end(JSON.stringify(agencia()));
    if (m[1] === "portal_baja_cliente") { const c = CLIENTES.find((x) => x.id === a.p_client); CLIENTES.splice(CLIENTES.indexOf(c), 1); BAJAS.push(c); MOV.unshift({ id: MOV.length + 1, client_id: c.id, name: c.name, tipo: "baja", fecha: a.p_fecha, motivo: a.p_motivo }); return res.end("null"); }
    if (m[1] === "portal_reactivar_cliente") { const c = BAJAS.find((x) => x.id === a.p_client); BAJAS.splice(BAJAS.indexOf(c), 1); CLIENTES.push(c); MOV.unshift({ id: MOV.length + 1, client_id: c.id, name: c.name, tipo: "alta", fecha: a.p_fecha, motivo: null }); return res.end("null"); }
    if (m[1] === "portal_alta_cliente") {
      if (CLIENTES.some((x) => x.name === a.p_nombre)) { res.statusCode = 400; return res.end(JSON.stringify({ message: "cliente_existente" })); }
      const c = { id: a.p_nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: a.p_nombre, kind: a.p_leads ? "leads" : "ecommerce", peso: 0.3, vivo: a.p_tienda ? 1 : 0 };
      CLIENTES.push(c); MOV.unshift({ id: MOV.length + 1, client_id: c.id, name: c.name, tipo: "alta", fecha: a.p_fecha, motivo: null });
      return res.end(JSON.stringify(c.id));
    }
    if (m[1] === "portal_b2b_marcar") { if (a.p_marcado) MARCADOS.add(a.p_client); else MARCADOS.delete(a.p_client); return res.end("null"); }
    if (m[1] === "portal_general") {
      const g = general(a);
      g.clientes.forEach((c) => { c.separa_b2b = MARCADOS.has(c.id); c.spend_b2b = c.separa_b2b ? c.spend * 0.53 : 0; });
      return res.end(JSON.stringify(g));
    }
    const rc = cliente(a);
    if (rc) {
      const si = MARCADOS.has(a.p_client);
      rc.cliente.separa_b2b = si;
      rc.dias.forEach((d) => { d.spend_b2b = si ? d.spend * 0.53 : 0; d.messages_b2b = si ? 120 : 0; d.messages = si ? 160 : d.messages; });
      const tot = rc.dias.reduce((x, d) => x + d.spend, 0);
      rc.campanas = si ? CAMPANAS.map(({ factor, msgs, ...x }) => ({ ...x, spend: tot * factor, messages: msgs })) : [];
      rc.prev.spend_b2b = si ? rc.prev.spend * 0.5 : 0;
    }
    return res.end(JSON.stringify(rc));
  }
  if (url.pathname === "/functions/v1/tn-app/analisis") {
    let cuerpo = ""; for await (const c of req) cuerpo += c;
    const a = JSON.parse(cuerpo);
    res.setHeader("Content-Type", "application/json");
    if (a.key !== "prueba") { res.statusCode = 401; return res.end(JSON.stringify({ error: "clave_invalida" })); }
    const etapa = (k) => ({ spend: 5200000 * k, impresiones: 2400000 * k, clics: 41000 * k, visitas: 33000 * k, carritos: 3900 * k, pagos: 1500 * k, compras: 610 * k, valor: 38000000 * k, mensajes: 40 * k });
    const pieza = (t, c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="${c}"/><text x="200" y="300" fill="#fff" font-size="34" text-anchor="middle">${t}</text></svg>`)}`;
    const anuncio = (i, compras, spend, c) => ({ id: `a${i}`, nombre: `Video prueba ${i} | Colección verano | Reel con un nombre bastante largo`, campana: "Ventas | Catálogo", ...etapa(0), spend, impresiones: spend * 0.4, clics: spend * 0.007, compras, valor: compras * 62000, imagenes: i === 4 ? [] : [pieza(`Pieza ${i}`, c), pieza(`Otra toma ${i}`, "#444455")], vista: i === 4 ? "https://www.facebook.com/x" : null });
    return res.end(JSON.stringify({
      fallaron: 0, periodo: etapa(1), compara: a.comparaDesde ? etapa(0.88) : null,
      campanas: [["Ventas | Catálogo + contenido | CBO", 0.42], ["Ventas | Remarketing carritos", 0.18], ["Prospecting | Videos nuevos con nombre largo para probar el corte de la fila", 0.22], ["Reconocimiento | Marca", 0.1], ["Mayoristas (B2B)", 0.08]].map(([nombre, k], i) => ({ id: `c${i}`, nombre, ...etapa(k) })),
      anuncios: [anuncio(1, 142, 720000, "#6D4FA8"), anuncio(2, 98, 510000, "#3F7F73"), anuncio(3, 77, 480000, "#A8643A"), anuncio(4, 51, 310000, "#7A5A9C"), anuncio(5, 34, 205000, "#4C6FA8")],
    }));
  }
  if (url.pathname === "/slides-prueba") {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") return res.end(ultimoSlides || "{}");
    let cuerpo = ""; for await (const c of req) cuerpo += c;
    ultimoSlides = cuerpo;
    return res.end(JSON.stringify({ url: `${url.origin}/portal.html?slides=ok` }));
  }
  if (url.pathname === "/config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(`window.MERVIEW_CONFIG={supabaseUrl:location.origin,supabaseKey:"x",slidesUrl:location.origin+"/slides-prueba"};`);
  }
  try {
    const archivo = url.pathname === "/" ? "portal.html" : url.pathname.slice(1);
    const cuerpo = await readFile(join(raiz, archivo));
    res.setHeader("Content-Type", TIPOS[extname(archivo)] || "text/plain");
    res.end(cuerpo);
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(PUERTO, () => console.log(`http://localhost:${PUERTO}/portal.html#k=prueba`));
