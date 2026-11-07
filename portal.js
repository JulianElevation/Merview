"use strict";
const CFG = window.MERVIEW_CONFIG || {};
const KEY_STORE = "merview_key", CLIENTE_STORE = "merview_cliente", POLL_MS = 20000, TZ = "America/Argentina/Buenos_Aires";
const $ = (id) => document.getElementById(id);
// Link de cliente: ve solo su tablero. La base decide qué datos salen, esto solo ordena la pantalla.
let modoCliente = false;

/* ---------- Formato ---------- */
const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (v) => "$ " + nf0.format(Math.round(v || 0));
function corto(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return "$ " + (v / 1e9).toFixed(1).replace(".", ",") + " B";
  if (a >= 1e6) return "$ " + (v / 1e6).toFixed(1).replace(".", ",") + " M";
  if (a >= 1e3) return "$ " + Math.round(v / 1e3) + " K";
  return "$ " + Math.round(v);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const merTxt = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(2).replace(".", ","));
const merCls = (v) => (modoCliente ? "" : v == null || !isFinite(v) ? "na" : v >= 6 ? "g" : v >= 3 ? "m" : "r");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const hora = (s) => new Date(s).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fechaHora = (s) => new Date(s).toLocaleString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const ddmm = (s) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
function hace(s) {
  if (!s) return null;
  const m = Math.max(0, Math.round((Date.now() - new Date(s)) / 60000));
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.floor(m / 60)} h`;
  return fechaHora(s);
}
const PAGOS = { credit_card: "Tarjeta de crédito", debit_card: "Tarjeta de débito", wire_transfer: "Transferencia", cash: "Efectivo", wallet: "Billetera virtual", boleto: "Boleto", pix: "Pix", ticket: "Pago en efectivo", custom: "Pago acordado", account_money: "Dinero en cuenta", other: "Otros", sin_dato: "Sin dato" };
const pagoTxt = (k) => PAGOS[k] || String(k || "—").replace(/_/g, " ");

/* ---------- Fechas ---------- */
const hoyBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const sumar = (s, n) => new Date(new Date(s + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
function rango() {
  const h = hoyBA(), pm = h.slice(0, 8) + "01";
  switch (E.p) {
    case "hoy": return [h, h];
    case "ayer": return [sumar(h, -1), sumar(h, -1)];
    case "7d": return [sumar(h, -6), h];
    case "30d": return [sumar(h, -29), h];
    case "mesant": { const fin = sumar(pm, -1); return [fin.slice(0, 8) + "01", fin]; }
    case "rango": return [E.desde || sumar(h, -6), E.hasta || h];
    default: return [pm, h];
  }
}
const rangoTxt = ([a, b]) => (a === b ? ddmm(a) : `${ddmm(a)} al ${ddmm(b)}`);
const incluyeHoy = () => rango()[1] >= hoyBA();
// Comparar hoy, que va por la mitad, contra un día entero no dice nada: ahí no se muestra.
function cambio(a, b) {
  if (E.p === "hoy" || !(b > 0) || a == null || !isFinite(a)) return "";
  const v = Math.round(((a - b) / b) * 100);
  return `${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}% vs período anterior`;
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesTxt = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
function ultimosMeses() {
  const h = hoyBA(), out = [];
  let y = Number(h.slice(0, 4)), m = Number(h.slice(5, 7));
  for (let i = 0; i < 12; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); if (--m === 0) { m = 12; y--; } }
  return out;
}

/* ---------- Estado ---------- */
const E = { v: "general", c: null, p: "mes", desde: null, hasta: null, q: "", soloActivos: true, sortK: "spend", sortDir: -1, limite: 100, graf: { ms: ["fac"], p: "arriba", g: null, desde: null, hasta: null, tabla: false }, agMer: "r", agForm: null, agErr: null };
let AG = null, agCuando = 0, agError = null, clave = null, GEN = null, CLI = null, ultimaOk = null, turno = 0, timer = null, ultimoNumero = null, sondeo = false, primeraVez = true;

function leerUrl() {
  const u = new URLSearchParams(location.search);
  if (!modoCliente && u.get("c")) { E.c = u.get("c"); E.v = "cliente"; }
  if (!modoCliente && u.get("v") === "agencia") E.v = "agencia";
  if (u.get("p")) E.p = u.get("p");
  if (u.get("d")) E.desde = u.get("d");
  if (u.get("h")) E.hasta = u.get("h");
}
function escribirUrl() {
  const u = new URLSearchParams();
  if (!modoCliente && E.v === "cliente" && E.c) u.set("c", E.c);
  if (E.v === "agencia") u.set("v", "agencia");
  if (E.p !== "mes") u.set("p", E.p);
  if (E.p === "rango" && E.desde) { u.set("d", E.desde); u.set("h", E.hasta); }
  const qs = u.toString();
  // El link del cliente queda en la barra: así lo puede guardar en favoritos.
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + (modoCliente ? location.hash : ""));
}

/* ---------- Acceso (misma clave que MER View) ---------- */
function leerClave() {
  const t = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/);
  if (t) {
    modoCliente = true;
    try { localStorage.setItem(CLIENTE_STORE, t[1]); } catch (e) {}
    return t[1];
  }
  const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
  if (m) {
    try { localStorage.setItem(KEY_STORE, m[1]); } catch (e) {}
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try {
    const equipo = localStorage.getItem(KEY_STORE);
    if (equipo) return equipo;
    const cliente = localStorage.getItem(CLIENTE_STORE);
    if (cliente) modoCliente = true;
    return cliente;
  } catch (e) { return null; }
}
function bloquear(msg) {
  $("app").hidden = true; $("login").hidden = false;
  if (modoCliente) $("loginSub").hidden = true;
  if (msg) { $("loginErr").textContent = msg; $("loginErr").hidden = false; }
  clearInterval(timer);
}
async function rpc(fn, args, reintento = true) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ...(modoCliente ? { p_token: clave } : { p_key: clave }), ...args }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    // La primera consulta en frío puede pasar el límite de 3 s de la base; la segunda ya entra.
    if (reintento && /statement timeout/.test(data?.message || "")) return rpc(fn, args, false);
    const e = new Error(data?.message || `HTTP ${r.status}`);
    e.clave = /clave_invalida/.test(data?.message || "");
    throw e;
  }
  return data;
}

/* ---------- Carga ---------- */
async function cargar(opts = {}) {
  const t = ++turno;
  const [d, h] = rango();
  if (!opts.silencio) { $("vista").innerHTML = '<div class="skel"></div><div class="skel"></div>'; pintarControles(); }
  try {
    const g = modoCliente ? null : rpc("portal_general", { p_since: d, p_until: h });
    const c = modoCliente ? rpc("portal_mi_tablero", { p_since: d, p_until: h, p_limit: E.limite, p_offset: 0 })
      : E.v === "cliente" && E.c
      ? rpc("portal_cliente", { p_client: E.c, p_since: d, p_until: h, p_limit: E.limite, p_offset: 0 }) : null;
    const [rg, rc] = await Promise.all([g, c]);
    if (t !== turno) return;
    GEN = rg; CLI = rc; ultimaOk = Date.now(); sondeo = !!opts.silencio;
    if (modoCliente) E.c = CLI.cliente.id;
    $("login").hidden = true; $("app").hidden = false;
    // Con un formulario abierto no se repinta en vivo: se perdería lo que se está escribiendo.
    if (!(opts.silencio && E.v === "agencia" && E.agForm)) pintar();
    sondeo = false;
    if (E.v === "agencia") traerAg();
    primeraVez = false;
  } catch (e) {
    if (t !== turno) return;
    if (e.clave) {
      try { localStorage.removeItem(modoCliente ? CLIENTE_STORE : KEY_STORE); } catch (_) {}
      return bloquear(modoCliente ? "Este link ya no está activo. Pedile uno nuevo a tu contacto de Elevation." : "El link de acceso ya no es válido. Pedí el link nuevo.");
    }
    if (primeraVez) return bloquear(modoCliente ? "No se pudieron traer los datos. Probá de nuevo en unos minutos." : "No se pudo cargar el portal: " + e.message);
    if (!opts.silencio) $("vista").innerHTML = `<div class="aviso err">No se pudieron traer los datos (${esc(e.message)}). Probá de nuevo en unos segundos.</div>`;
  } finally { pulso(); }
}
async function traerAg(forzar) {
  if (!forzar && Date.now() - agCuando < 120000 && AG) return;
  agCuando = Date.now();
  try {
    AG = await rpc("portal_agencia", {});
    agError = null;
  } catch (e) { agError = e.message; }
  if (E.v === "agencia" && !E.agForm) pintar();
}
const ERR_AG = { nombre_invalido: "Poné el nombre del cliente.", cliente_existente: "Ya hay un cliente con ese nombre.", cuenta_invalida: "El ID de la cuenta de Meta no parece correcto.", tienda_no_disponible: "Esa tienda ya está asignada a otro cliente.", cliente_inexistente: "Ese cliente ya no está disponible." };
async function guardarMovimiento(accion) {
  const v = (id) => $(id)?.value.trim() || null, fecha = v("agFecha");
  E.agErr = null;
  try {
    let hecho;
    if (accion === "agBaja") {
      const id = v("agCliente");
      if (!id) { E.agErr = "Elegí qué cliente se da de baja."; return pintar(); }
      const nombre = $("agCliente").selectedOptions[0].textContent;
      if (!confirm(`¿Dar de baja a ${nombre}? Sale de Clientes, General, MER View y las cargas. Se puede volver a activar.`)) return;
      await rpc("portal_baja_cliente", { p_client: id, p_fecha: fecha, p_motivo: v("agMotivo") });
      hecho = `${nombre} quedó dado de baja.`;
    } else if (accion === "agReactivar") {
      const id = v("agVuelve");
      if (!id) { E.agErr = "Elegí qué cliente vuelve."; return pintar(); }
      await rpc("portal_reactivar_cliente", { p_client: id, p_fecha: fecha });
      hecho = `${$("agVuelve").selectedOptions[0].textContent} volvió a estar activo.`;
    } else {
      const nombre = v("agNombre");
      if (!nombre) { E.agErr = ERR_AG.nombre_invalido; return pintar(); }
      await rpc("portal_alta_cliente", { p_nombre: nombre, p_leads: v("agTipo") === "leads", p_tienda: v("agTienda"), p_meta: v("agMeta"), p_fecha: fecha });
      hecho = `${nombre} quedó dado de alta.`;
    }
    E.agForm = null;
    const a = $("aviso"); a.textContent = hecho; a.className = "aviso ok"; a.hidden = false;
    AG = null; agCuando = 0;
    await cargar({ silencio: true });
    pintar();
  } catch (e) {
    const clave = Object.keys(ERR_AG).find((k) => e.message.includes(k));
    E.agErr = clave ? ERR_AG[clave] : "No se pudo guardar: " + e.message;
    pintar();
  }
}
function pulso() {
  const el = $("vivo");
  if (!ultimaOk) return;
  const s = Math.round((Date.now() - ultimaOk) / 1000), caido = s > (POLL_MS / 1000) * 3;
  el.classList.toggle("off", caido && incluyeHoy());
  el.classList.toggle("pasado", !incluyeHoy());
  $("vivoTxt").textContent = !incluyeHoy() ? "Período cerrado"
    : caido ? `Sin conexión. Datos de las ${hora(ultimaOk)}` : `En vivo · hace ${s} s`;
}
function programar() {
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && incluyeHoy()) cargar({ silencio: true }); }, POLL_MS);
}

/* ---------- Controles ---------- */
function pintarControles() {
  document.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === E.v ? "true" : "false"));
  document.querySelectorAll("#fechas button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === E.p ? "true" : "false"));
  $("rango").hidden = E.p !== "rango";
  const [a, b] = rango();
  $("dDesde").value = a; $("dHasta").value = b;
  const cl = E.c && GEN ? GEN.clientes.find((x) => x.id === E.c) : null;
  $("pickTxt").textContent = E.v === "cliente" && (cl || CLI?.cliente) ? (cl || CLI.cliente).name : "Elegir cliente";
  $("pickBtn").dataset.activo = E.v === "cliente" ? "1" : "0";
}
function pintarMenu() {
  const term = $("menuQ").value.trim().toLowerCase();
  const lista = (GEN?.clientes || []).filter((c) => !term || c.name.toLowerCase().includes(term))
    .sort((a, b) => (b.activo - a.activo) || a.name.localeCompare(b.name, "es"));
  $("menuL").innerHTML = lista.length ? lista.map((c) => `<li><button role="option" data-id="${esc(c.id)}" aria-selected="${c.id === E.c}">
      <span>${esc(c.name)}</span><small>${c.kind === "leads" ? "Leads" : corto(num(c.revenue))}</small></button></li>`).join("")
    : '<li class="vacio" style="padding:8px 10px">Ningún cliente coincide.</li>';
}
function abrirMenu(si) {
  $("menu").hidden = !si;
  $("pickBtn").setAttribute("aria-expanded", si ? "true" : "false");
  if (si) { $("menuQ").value = ""; pintarMenu(); $("menuQ").focus(); }
}
function irCliente(id) { E.c = id; E.v = "cliente"; E.limite = 100; ultimoNumero = null; $("aviso").hidden = true; abrirMenu(false); escribirUrl(); cargar(); }

/* ---------- Link para el cliente ---------- */
async function linkCliente(renovar) {
  const a = $("aviso"), id = E.c, nombre = CLI?.cliente?.name || "este cliente";
  if (renovar && !confirm(`El link actual de ${nombre} va a dejar de funcionar. ¿Crear uno nuevo?`)) return;
  try {
    const token = await rpc("portal_link_cliente", { p_client: id, p_renovar: !!renovar });
    if (E.c !== id) return;
    const url = `${location.origin}${location.pathname}#t=${token}`;
    let copiado = false;
    try { await navigator.clipboard.writeText(url); copiado = true; } catch (_) {}
    a.className = "aviso ok"; a.hidden = false;
    a.innerHTML = `<b>${copiado ? "Link copiado" : "Copiá este link"} de ${esc(nombre)}.</b> Pasáselo solo a ese cliente: abre únicamente su tablero.<br><code style="word-break:break-all">${esc(url)}</code><br><button class="btn" id="renovarLink" style="margin-top:8px">Cambiar link</button>`;
    a.scrollIntoView({ block: "nearest" });
  } catch (e) {
    a.className = "aviso err"; a.hidden = false;
    a.textContent = "No se pudo crear el link: " + e.message;
  }
}
$("aviso").addEventListener("click", (e) => { if (e.target.id === "renovarLink") linkCliente(true); });

/* ---------- Gráficos ---------- */
const movil = () => window.matchMedia("(max-width:640px)").matches;
const CHART = { W: 900, H: 270, izq: 58, der: 8, arr: 24, aba: 26 };
function medirGraficos() { CHART.W = Math.max(280, ($("vista").clientWidth || 900) - 34); CHART.H = movil() ? 230 : 270; CHART.izq = movil() ? 48 : 58; }
function escala(max) {
  const pot = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const paso = [0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => (max / p) <= 4) || pot * 10;
  return { paso, tope: Math.ceil(max / paso) * paso || 1 };
}
function ejes(puntos, tope, paso, fmtY) {
  const { W, H, izq, der, arr, aba } = CHART, alto = H - arr - aba;
  let s = "";
  for (let v = 0; v <= tope + paso / 2; v += paso) {
    const y = arr + alto - (v / tope) * alto;
    s += `<line x1="${izq}" x2="${W - der}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1" ${v ? 'stroke-dasharray="2 4"' : ""}/>`;
    s += `<text x="${izq - 8}" y="${y + 4}" text-anchor="end">${esc(fmtY(v))}</text>`;
  }
  const slot = (W - izq - der) / puntos.length, cada = Math.max(1, Math.ceil(puntos.length / Math.max(3, Math.floor((W - izq) / 62))));
  puntos.forEach((p, i) => { if (i % cada === 0) s += `<text x="${izq + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${p.corto ?? p.label ?? ddmm(p.day)}</text>`; });
  return s;
}
// Valor corto para escribir sobre el gráfico: sin signo de pesos, con un decimal cuando ayuda.
function cortoVal(v) {
  const a = Math.abs(v), d = (x) => x.toFixed(1).replace(".", ",").replace(",0", "");
  if (a >= 1e9) return d(v / 1e9) + " B";
  if (a >= 1e7) return Math.round(v / 1e6) + " M";
  if (a >= 1e6) return d(v / 1e6) + " M";
  if (a >= 1e4) return Math.round(v / 1e3) + " K";
  if (a >= 1e3) return d(v / 1e3) + " K";
  return String(Math.round(v));
}
const etiqueta = (x, y, txt, ancla = "middle") => `<text class="val" x="${x}" y="${y}" text-anchor="${ancla}">${esc(txt)}</text>`;
const barra = (x, y, w, base, color, clase = "") => {
  const r = Math.min(4, w / 2, base - y);
  return `<path class="barra ${clase}" fill="${color}" d="M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${base}Z"/>`;
};
// Barras apiladas de una misma escala: total arriba y cada parte adentro cuando entra.
function apiladas(puntos, series, nombre) {
  const vals = puntos.map((p) => series.reduce((s, k) => s + num(p.partes[k]), 0));
  if (!vals.some((v) => v > 0)) return '<div class="sinchart">No hay datos todavía.</div>';
  const { W, H, izq, der, arr, aba } = CHART, alto = H - arr - aba;
  const { paso, tope } = escala(Math.max(...vals));
  const slot = (W - izq - der) / puntos.length, bw = Math.max(4, Math.min(38, slot * 0.66)), b = arr + alto;
  const cada = Math.max(1, Math.ceil(30 / slot));
  let marcas = "", hits = "", textos = "";
  puntos.forEach((p, i) => {
    let base = b;
    const xx = izq + slot * i + (slot - bw) / 2, visibles = series.filter((k) => num(p.partes[k]) > 0);
    visibles.forEach((k, j) => {
      const h = (num(p.partes[k]) / tope) * alto, ult = j === visibles.length - 1, alt = Math.max(1, ult ? h : h - 2);
      marcas += barra(xx, base - alt, bw, base, COLORES[series.indexOf(k)]);
      if (bw >= 24 && alt >= 16) textos += etiqueta(xx + bw / 2, base - alt / 2 + 4, cortoVal(num(p.partes[k])));
      base -= h;
    });
    if (vals[i] > 0 && (puntos.length - 1 - i) % cada === 0) textos += etiqueta(xx + bw / 2, base - 7, cortoVal(vals[i]));
    const tip = `${p.label}: ` + (visibles.map((k) => `${nombre(k)} ${nf0.format(num(p.partes[k]))}`).join(" · ") || "sin ventas");
    hits += `<rect class="hit" data-t="${esc(tip)}" x="${izq + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent"/>`;
  });
  const ley = series.map((k, i) => `<span><i style="background:${COLORES[i]}"></i>${esc(nombre(k))}</span>`).join("");
  return `<div class="leyenda">${ley}</div><div class="chart"><svg class="${GRAF.anim ? "anim" : ""}" viewBox="0 0 ${W} ${H}" style="height:auto" role="img">${ejes(puntos, tope, paso, (v) => nf0.format(v))}${marcas}${textos}${hits}</svg><div class="tip" hidden></div></div>`;
}
// Agrupa las categorías menos usadas para no superar los colores disponibles.
function porMes(filas, etiqueta) {
  const meses = ultimosMeses(), tot = new Map();
  filas.forEach((f) => tot.set(String(f.k), (tot.get(String(f.k)) || 0) + num(f.ventas)));
  const orden = [...tot.keys()].sort((a, b) => tot.get(b) - tot.get(a));
  const series = orden.slice(0, orden.length > 6 ? 5 : 6);
  if (orden.length > 6) series.push("__otros");
  const puntos = meses.map((m) => {
    const partes = {};
    filas.filter((f) => f.mes === m).forEach((f) => {
      const k = series.includes(String(f.k)) ? String(f.k) : "__otros";
      partes[k] = (partes[k] || 0) + num(f.ventas);
    });
    return { label: mesTxt(m), partes };
  });
  return apiladas(puntos, series, (k) => (k === "__otros" ? "Otros" : etiqueta(k)));
}
function tablaProductos() {
  const p = CLI.productos || [];
  if (!p.length) return "";
  const tot = p.reduce((s, x) => s + num(x.unidades), 0);
  return `<section class="bloque"><h2>Productos más vendidos</h2><p class="sub" style="padding:0 16px 8px">Por unidades pagadas en el período. Los importes son a precio de lista, antes de descuentos.</p>
    <div class="tablebox"><table><thead><tr><th>Producto</th><th>Unidades</th><th class="hm">% del ranking</th><th>Importe</th></tr></thead>
    <tbody>${p.map((x) => `<tr><td class="nom"><b>${esc(x.nombre)}</b></td><td>${nf0.format(num(x.unidades))}</td><td class="hm">${pct(num(x.unidades), tot)}%</td><td>${money(num(x.total))}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function activarGraficos(raiz = document) {
  raiz.querySelectorAll(".chart").forEach((ch) => {
    const tip = ch.querySelector(".tip");
    if (!tip) return;
    const mostrar = (h) => {
      const rC = ch.getBoundingClientRect(), rH = h.getBoundingClientRect();
      tip.textContent = h.dataset.t; tip.hidden = false;
      const m = tip.offsetWidth / 2 + 4;
      tip.style.left = Math.max(m, Math.min(rC.width - m, rH.left - rC.left + rH.width / 2)) + "px";
    };
    ch.querySelectorAll(".hit").forEach((h) => {
      h.addEventListener("mouseenter", () => mostrar(h));
      h.addEventListener("click", () => mostrar(h));
    });
    ch.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}
const COLORES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
function torta(titulo, filas, etiqueta) {
  const orden = [...filas].map((f) => ({ k: f.k, ventas: num(f.ventas), total: num(f.total) })).sort((a, b) => b.total - a.total);
  let partes = orden.slice(0, 5);
  if (orden.length > 5) {
    const r = orden.slice(5);
    partes = partes.concat({ k: "__otros", ventas: r.reduce((s, x) => s + x.ventas, 0), total: r.reduce((s, x) => s + x.total, 0) });
  }
  const tot = partes.reduce((s, x) => s + x.total, 0);
  if (!tot) return `<section class="torta"><h2>${esc(titulo)}</h2><p class="vacio">Sin ventas pagadas en este período.</p></section>`;
  const nombre = (k) => (k === "__otros" ? "Otros" : etiqueta(k));
  const C = 50, R = 46, r = 28;
  const pol = (rad, a) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
  let ang = -Math.PI / 2, svg = "";
  partes.forEach((p, i) => {
    const f = p.total / tot, tt = `${nombre(p.k)}: ${pct(p.total, tot)}%`;
    if (f > 0.9999) {
      svg += `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${COLORES[i]}" stroke-width="${R - r}"><title>${esc(tt)}</title></circle>`;
    } else {
      const gap = 0.012, a0 = ang + gap, a1 = ang + f * 2 * Math.PI - gap, g = a1 - a0 > Math.PI ? 1 : 0;
      if (a1 > a0) {
        const [x0, y0] = pol(R, a0), [x1, y1] = pol(R, a1), [x2, y2] = pol(r, a1), [x3, y3] = pol(r, a0);
        svg += `<path fill="${COLORES[i]}" d="M${x0} ${y0}A${R} ${R} 0 ${g} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${g} 0 ${x3} ${y3}Z"><title>${esc(tt)}</title></path>`;
      }
    }
    ang += f * 2 * Math.PI;
  });
  const ley = partes.map((p, i) => `<li><i style="background:${COLORES[i]}"></i><span title="${esc(nombre(p.k))}">${esc(nombre(p.k))}</span>
      <b>${pct(p.total, tot)}%<small>${corto(p.total)} · ${nf0.format(p.ventas)} ventas</small></b></li>`).join("");
  return `<section class="torta"><h2>${esc(titulo)}</h2><div class="in"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(titulo)}">${svg}</svg><ul class="ley">${ley}</ul></div></section>`;
}

function completar(dias, a, b) {
  const m = new Map(dias.map((d) => [d.day, d])), out = [];
  for (let d = a; d <= b; d = sumar(d, 1)) out.push(m.get(d) || { day: d, revenue: 0, spend: 0, orders: 0, messages: 0, nuevos: 0, recurrentes: 0 });
  return out;
}
function diasCompletos(dias) { const [a, b] = rango(); return completar(dias, a, b); }

/* ---------- Gráfico único: qué mirar, qué fechas y cómo agrupar ---------- */
const GRAF = { datos: null, clave: null, trae: false, cuando: 0, error: null, turno: 0, anim: true };
const PERIODOS = [["arriba", "Igual que arriba"], ["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"], ["anio", "Este año"], ["12m", "12 meses"], ["rango", "Fechas"]];
const AGRUPAR = [["d", "Día"], ["s", "Semana"], ["m", "Mes"]];
function grafRango() {
  const h = hoyBA(), g = E.graf;
  switch (g.p) {
    case "7d": return [sumar(h, -6), h];
    case "30d": return [sumar(h, -29), h];
    case "90d": return [sumar(h, -89), h];
    case "anio": return [h.slice(0, 4) + "-01-01", h];
    case "12m": return [sumar(h, -364), h];
    case "rango": return [g.desde || sumar(h, -29), g.hasta || h];
    default: return rango();
  }
}
const grafClave = () => { const [a, b] = grafRango(); return [E.v === "agencia" ? "agencia" : E.c, a, b].join("|"); };
function grafDias() {
  if (E.graf.p === "arriba") return (E.v === "agencia" ? GEN?.dias : CLI?.dias) || [];
  return GRAF.clave === grafClave() ? GRAF.datos : null;
}
function grafAgrupacion() {
  if (E.graf.g) return E.graf.g;
  // Elige la más detallada en la que los valores entran escritos.
  const lista = grafMetricas(), sel = E.graf.ms.map((id) => lista.find((m) => m.id === id)).filter(Boolean);
  const ladoALado = sel.length === 2 && sel[0].tipo === "barras" && sel[1].tipo === "barras" && sel[0].gr === sel[1].gr;
  const [a, b] = grafRango(), n = (new Date(b) - new Date(a)) / 864e5 + 1, entran = Math.max(5, Math.floor((($("vista")?.clientWidth || 900) - 90) / (ladoALado ? 64 : 32)));
  return n <= entran ? "d" : n / 7 <= entran ? "s" : "m";
}
function lunes(d) {
  const dia = new Date(d + "T12:00:00Z").getUTCDay();
  return sumar(d, -((dia + 6) % 7));
}
function grafPuntos(dias) {
  const [a, b] = grafRango(), g = grafAgrupacion(), grupos = new Map();
  completar(dias, a, b).forEach((d) => {
    const k = g === "s" ? lunes(d.day) : g === "m" ? d.day.slice(0, 7) : d.day;
    if (!grupos.has(k)) grupos.set(k, { label: g === "m" ? mesTxt(k) : ddmm(k), tip: g === "s" ? `Semana del ${ddmm(k)}` : g === "m" ? mesTxt(k) : ddmm(k), parcial: false, revenue: 0, orders: 0, spend: 0, messages: 0, nuevos: 0, recurrentes: 0 });
    const x = grupos.get(k);
    if (d.day === hoyBA()) x.parcial = true;
    ["revenue", "orders", "spend", "messages", "nuevos", "recurrentes"].forEach((c) => { x[c] += num(d[c]); });
  });
  return [...grupos.values()];
}
const cantidad = (v) => nf0.format(v);
const ICONOS = {
  fac: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  inv: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  mer: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  ven: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  tic: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>',
  cac: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  cli: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pag: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  cuo: '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  cpm: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6M9.5 10h5"/>',
  uni: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  tie: '<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  tab: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};
// Qué es bueno en cada métrica: 1 que suba, -1 que baje. Inversión no tiene bueno ni malo.
const POLARIDAD = { fac: 1, mer: 1, ven: 1, tic: 1, cac: -1, cli: 1, uni: 1, msg: 1, cpm: -1 };
function subTxt(sub, id) {
  const m = String(sub).match(/^([▲▼])(.*)$/);
  if (!m) return esc(sub);
  const pol = modoCliente ? 0 : POLARIDAD[id] || 0, sinCambio = /^ 0%/.test(m[2]);
  const clase = !pol || sinCambio ? "" : (m[1] === "▲") === (pol > 0) ? "fl-bien" : "fl-mal";
  return `<span class="${clase}">${m[1]}</span>${esc(m[2])}`;
}
const icono = (id) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[id] || ""}</svg>`;
function grafMetricas() {
  const suma = (id, t, campo, gr) => ({ id, t, tipo: "barras", gr, fmtY: gr === "vol" ? corto : cantidad, fmtV: gr === "vol" ? money : cantidad, fmtL: gr === "vol" ? cortoVal : cantidad, v: (x) => x[campo], tot: (ps) => ps.reduce((s, x) => s + x[campo], 0) });
  const razon = (id, t, arr, aba, gr, fmtY, fmtV, fmtL) => ({ id, t, tipo: "linea", gr, fmtY, fmtV, fmtL, v: (x) => (x[aba] > 0 ? x[arr] / x[aba] : null), tot: (ps) => { const m = ps.reduce((s, x) => s + x[aba], 0); return m > 0 ? ps.reduce((s, x) => s + x[arr], 0) / m : null; } });
  const fac = suma("fac", "Facturación", "revenue", "vol");
  const inv = suma("inv", "Inversión", "spend", "vol");
  const mer = razon("mer", "MER", "revenue", "spend", "mer", merTxt, merTxt, merTxt);
  if (E.v === "agencia") return [fac, inv, mer];
  if (CLI?.cliente?.kind === "leads") return [inv, suma("msg", "Mensajes", "messages", "cnt"), razon("cpm", "Costo por mensaje", "spend", "messages", "uni", corto, money, cortoVal)];
  if (!(CLI?.tiendas || []).some((t) => t.conectada)) return [fac, inv, mer];
  return [fac, inv, mer, suma("ven", "Ventas", "orders", "cnt"), razon("tic", "Ticket promedio", "revenue", "orders", "uni", corto, money, cortoVal),
    razon("cac", "CAC", "spend", "nuevos", "uni", corto, money, cortoVal),
    { id: "cli", t: "Nuevos y recurrentes", tipo: "desglose" }, { id: "pag", t: "Método de pago", tipo: "desglose", fijo: true }, { id: "cuo", t: "Cuotas", tipo: "desglose", fijo: true }];
}
function grafSel() {
  const lista = grafMetricas(), sel = E.graf.ms.map((id) => lista.find((m) => m.id === id)).filter(Boolean);
  return sel.length ? sel : [lista[0]];
}
// Como Search Console: cada tarjeta se prende o se apaga; entran hasta dos métricas.
function elegirMetrica(id) {
  const lista = grafMetricas(), m = lista.find((x) => x.id === id);
  if (!m) return;
  const actual = grafSel().map((x) => x.id);
  if (m.tipo === "desglose") E.graf.ms = [id];
  else if (actual.includes(id)) E.graf.ms = actual.length > 1 ? actual.filter((x) => x !== id) : actual;
  else {
    const num2 = actual.filter((x) => lista.find((y) => y.id === x).tipo !== "desglose");
    E.graf.ms = num2.length ? [num2[0], id] : [id];
  }
  GRAF.anim = true;
  pintarGraf();
}
function tiles(valores, extras = []) {
  const sel = grafSel().map((m) => m.id);
  const metricas = grafMetricas().filter((m) => m.tipo !== "desglose"), total = metricas.length + extras.length;
  const lista = metricas.map((m) => {
    const [v, sub, cls] = valores[m.id] || ["—", ""], n = sel.indexOf(m.id) + 1;
    return `<button type="button" class="tile" data-gm="${m.id}" data-n="${n}" aria-pressed="${n > 0}">
      <span class="tile-t">${icono(m.id)}<span>${esc(m.t)}</span><i class="tile-pto" aria-hidden="true"></i></span>
      <b class="${cls || ""}">${esc(v)}</b>${sub ? `<small>${subTxt(sub, m.id)}</small>` : ""}</button>`;
  }).join("");
  // Hasta 4 por fila: con 8 quedan dos filas parejas, sin tarjetas sueltas.
  return `<div class="tiles" style="--cols:${Math.min(4, total)}">${lista}${extras.join("")}</div>`;
}
function sincronizarTiles() {
  const sel = grafSel().map((m) => m.id);
  document.querySelectorAll("[data-gm]").forEach((b) => {
    const n = sel.indexOf(b.dataset.gm) + 1;
    b.dataset.n = n; b.setAttribute("aria-pressed", n > 0 ? "true" : "false");
  });
}
// Las dos métricas comparten escala solo si se miden igual; si no, cada una usa la suya y el valor va escrito.
function combo(ps, mets) {
  const { W, H, der } = CHART, [m1, m2] = mets, mismaEsc = !m2 || m1.gr === m2.gr;
  const izq = mismaEsc ? CHART.izq : 8, arr = CHART.arr, aba = CHART.aba, alto = H - arr - aba, base = arr + alto;
  const vals = mets.map((m) => ps.map((x) => m.v(x)));
  const techo = (arrs) => Math.max(0, ...arrs.flat().filter((v) => v != null && isFinite(v)));
  if (vals.every((a) => !a.some((v) => v))) return '<div class="sinchart">No hay datos en este período.</div>';
  const e1 = escala(techo(mismaEsc ? vals : [vals[0]]) || 1), e2 = m2 ? (mismaEsc ? e1 : escala(techo([vals[1]]) || 1)) : null;
  const slot = (W - izq - der) / ps.length, xc = (i) => izq + slot * i + slot / 2;
  const y = (v, e) => arr + alto - (v / e.tope) * alto;
  const puntos = ps.map((x) => ({ label: x.label }));
  // Dos barras comparables van lado a lado; si no, la segunda pasa a línea.
  const dosBarras = m2 && m1.tipo === "barras" && m2.tipo === "barras" && mismaEsc;
  const tipos = mets.map((m, i) => (m.tipo === "barras" && !(i === 1 && !dosBarras) ? "barras" : "linea"));
  if (m2 && tipos[0] === "linea" && tipos[1] === "linea" && m2.tipo === "barras") tipos[1] = "barras";
  const colores = ["var(--m1)", "var(--m2)"];
  const anchoEtq = Math.max(...mets.map((m, i) => Math.max(...vals[i].filter((v) => v != null).map((v) => m.fmtL(v).length), 1))) * 5.8 + 4;
  const espacio = dosBarras ? slot / 2 : slot, paso = Math.max(1, Math.ceil(anchoEtq / espacio));
  const muestra = (i) => (ps.length - 1 - i) % paso === 0;
  let fondo = mismaEsc ? ejes(puntos, e1.tope, e1.paso, m1.fmtY) : (() => {
    const c0 = { ...CHART, izq }; let t = "";
    for (let k = 1; k <= 3; k++) t += `<line x1="${izq}" x2="${W - der}" y1="${arr + (alto / 3) * (k - 1)}" y2="${arr + (alto / 3) * (k - 1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>`;
    t += `<line x1="${izq}" x2="${W - der}" y1="${base}" y2="${base}" stroke="var(--line)" stroke-width="1"/>`;
    const cada = Math.max(1, Math.ceil(ps.length / Math.max(3, Math.floor((W - izq) / 62))));
    ps.forEach((x, i) => { if (i % cada === 0) t += `<text x="${xc(i)}" y="${H - 8}" text-anchor="middle">${esc(x.label)}</text>`; });
    return t;
  })();
  let marcas = "", textos = "";
  const nBarras = tipos.filter((t) => t === "barras").length;
  const bw = Math.max(2, Math.min(nBarras > 1 ? 22 : 40, (slot * 0.66) / Math.max(1, nBarras)));
  let bi = 0;
  mets.forEach((m, k) => {
    const e = k === 0 ? e1 : e2, color = colores[k];
    if (tipos[k] === "barras") {
      const off = nBarras > 1 ? (bi === 0 ? -bw - 1 : 1) : -bw / 2;
      bi++;
      vals[k].forEach((v, i) => {
        if (!(v > 0)) return;
        marcas += barra(xc(i) + off, y(v, e), bw, base, color, ps[i].parcial ? "parcial" : "");
        if (!muestra(i)) return;
        if (m2 && nBarras === 1) textos += etiqueta(xc(i), base - 7, m.fmtL(v));
        else textos += etiqueta(xc(i) + off + bw / 2, y(v, e) - 7, m.fmtL(v));
      });
    } else {
      let tramo = "", tramos = [];
      vals[k].forEach((v, i) => {
        if (v == null || !isFinite(v)) { if (tramo) tramos.push(tramo); tramo = ""; return; }
        tramo += `${tramo ? "L" : "M"}${xc(i)} ${y(v, e)}`;
      });
      if (tramo) tramos.push(tramo);
      marcas += tramos.map((d) => `<path class="linea" pathLength="1" d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
      vals[k].forEach((v, i) => {
        if (v == null || !isFinite(v)) return;
        if (ps.length <= 45) marcas += `<circle class="punto-g" cx="${xc(i)}" cy="${y(v, e)}" r="4" fill="${color}" stroke="var(--panel)" stroke-width="2"/>`;
        if (!muestra(i)) return;
        // Dos líneas: la de abajo escribe su valor debajo para no pisarse.
        const otra = m2 && tipos[0] === "linea" && tipos[1] === "linea" ? vals[1 - k][i] : null;
        const abajo = otra != null && y(otra, k === 0 ? e2 : e1) < y(v, e);
        textos += etiqueta(xc(i), abajo ? Math.min(y(v, e) + 17, base - 3) : y(v, e) - 9, m.fmtL(v));
      });
    }
  });
  const hits = ps.map((x, i) => `<rect class="hit" data-t="${esc(`${x.tip}${x.parcial ? " (en curso)" : ""}: ` + mets.map((m, k) => `${m.t} ${vals[k][i] == null ? "—" : m.fmtV(vals[k][i])}`).join(" · "))}" x="${izq + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent"/>`).join("");
  const nota = paso > 1 ? `<p class="graf-nota">Se escribe 1 de cada ${paso} valores para que se lea bien. Agrupá por semana o abrí la tabla para ver todos.</p>` : "";
  return `<div class="chart"><svg class="${GRAF.anim ? "anim" : ""}" viewBox="0 0 ${W} ${H}" style="height:auto" role="img" aria-label="${esc(mets.map((m) => m.t).join(" y "))}">${fondo}${marcas}${textos}${hits}</svg><div class="tip" hidden></div></div>${nota}`;
}
function grafTabla(ps, mets) {
  const cols = grafMetricas().filter((m) => m.tipo !== "desglose");
  const orden = [...mets, ...cols.filter((c) => !mets.some((m) => m.id === c.id))];
  const filas = [...ps].reverse().map((x) => `<tr><td>${esc(x.tip)}${x.parcial ? ' <span class="sub">en curso</span>' : ""}</td>${orden.map((m) => { const v = m.v(x); return `<td>${v == null ? '<span class="na">—</span>' : esc(m.fmtV(v))}</td>`; }).join("")}</tr>`).join("");
  return `<div class="tablebox graf-tabla"><table><thead><tr><th>Período</th>${orden.map((m) => `<th>${esc(m.t)}</th>`).join("")}</tr></thead><tbody>${filas}</tbody></table></div>`;
}
function grafDibujo(mets) {
  const m = mets[0];
  if (m.id === "pag") return porMes(CLI.meses_pagos || [], pagoTxt);
  if (m.id === "cuo") return porMes(CLI.meses_cuotas || [], (k) => (Number(k) === 1 ? "1 pago" : `${k} cuotas`));
  if (GRAF.error && E.graf.p !== "arriba") return '<div class="sinchart">No se pudieron traer estas fechas. Probá de nuevo o elegí un período más corto.</div>';
  const dias = grafDias();
  if (!dias) return `<div class="skel" style="height:${CHART.H}px;margin:0"></div>`;
  const ps = grafPuntos(dias);
  if (m.id === "cli") return apiladas(ps.map((x) => ({ label: x.tip, corto: x.label, partes: { Nuevo: x.nuevos, Recurrente: x.recurrentes } })), ["Nuevo", "Recurrente"], (k) => (k === "Nuevo" ? "Nuevos" : "Recurrentes"));
  return (E.graf.tabla ? "" : combo(ps, mets)) + (E.graf.tabla ? grafTabla(ps, mets) : "");
}
function grafCuerpo() {
  const lista = grafMetricas(), mets = grafSel(), m0 = mets[0], desglose = m0.tipo === "desglose", fijo = !!m0.fijo;
  const [a, b] = grafRango(), g = grafAgrupacion(), dias = fijo ? null : grafDias();
  const ps = dias ? grafPuntos(dias) : null;
  const rangoLeg = a.slice(0, 4) === b.slice(0, 4) ? rangoTxt([a, b]) : `${ddmm(a)}/${a.slice(2, 4)} al ${ddmm(b)}/${b.slice(2, 4)}`;
  const leyenda = desglose ? `<div class="graf-ley"><span class="graf-ley-m">${icono(m0.id)}<b>${esc(m0.t)}</b></span></div>` : `<div class="graf-ley">${mets.map((m, k) => {
    const t = ps ? m.tot(ps) : null;
    return `<span class="graf-ley-m"><i class="sw ${m.tipo === "barras" && !(k === 1 && mets[0].gr !== m.gr) ? "" : "lin"}" style="--c:var(--m${k + 1})"></i>${esc(m.t)}<b>${t == null ? "—" : esc(m.fmtV(t))}</b></span>`;
  }).join("")}</div>`;
  const per = PERIODOS.map(([k, t]) => `<button type="button" data-gper="${k}" aria-pressed="${k === E.graf.p}">${esc(t)}</button>`).join("");
  const seg = AGRUPAR.map(([k, t]) => `<button type="button" data-gg="${k}" aria-pressed="${k === g}">${t}</button>`).join("");
  const tablaBtn = desglose ? "" : `<button type="button" class="graf-tabbtn" data-gtabla aria-pressed="${!!E.graf.tabla}">${icono("tab")}Tabla</button>`;
  const controles = fijo ? '<span class="sub">Por mes, últimos 12 meses</span>' : `<div class="graf-per" role="group" aria-label="Período">${per}</div>
    ${E.graf.p === "rango" ? `<span class="rango"><input type="date" id="grafD" value="${a}" aria-label="Desde"><span>a</span><input type="date" id="grafH" value="${b}" aria-label="Hasta"></span>` : ""}
    <div class="graf-seg" role="group" aria-label="Agrupar por">${seg}</div>${tablaBtn}`;
  const des = lista.filter((m) => m.tipo === "desglose");
  const desgloses = des.length ? `<div class="graf-des"><span>Desglose</span>${des.map((m) => `<button type="button" data-gm="${m.id}" data-n="${m.id === m0.id ? 1 : 0}" aria-pressed="${m.id === m0.id}">${icono(m.id)}${esc(m.t)}</button>`).join("")}</div>` : "";
  const aviso = mets.length > 1 && mets[0].gr !== mets[1].gr && !E.graf.tabla ? '<p class="graf-nota">Cada métrica usa su propia escala: compará la tendencia y leé los valores escritos.</p>' : "";
  const chips = E.v === "agencia" ? `<div class="graf-des graf-chips"><span>Mirar</span>${lista.map((m) => `<button type="button" data-gm="${m.id}" aria-pressed="${mets.some((x) => x.id === m.id)}">${icono(m.id)}${esc(m.t)}</button>`).join("")}</div>` : "";
  return `${chips}<div class="graf-cab">${leyenda}<small class="graf-rango">${esc(rangoLeg)}</small></div>
    <div class="graf-ctl">${controles}</div>
    ${grafDibujo(mets)}${aviso}${desgloses}`;
}
const bloqueGraf = () => `<section class="bloque graf" id="graf">${grafCuerpo()}</section>`;
function pintarGraf() {
  const el = $("graf");
  if (!el) return;
  medirGraficos();
  el.innerHTML = grafCuerpo();
  activarGraficos(el);
  sincronizarTiles();
  GRAF.anim = false;
}
// Las fechas propias del gráfico se piden aparte: si fallan, solo avisa el gráfico.
async function traerGraf(refrescar) {
  if (E.v === "general" || E.graf.p === "arriba") return;
  const clave = grafClave(), [a, b] = grafRango();
  if (!refrescar && GRAF.clave === clave && (GRAF.datos || GRAF.trae || GRAF.error)) return;
  const t = ++GRAF.turno;
  if (GRAF.clave !== clave) GRAF.datos = null;
  GRAF.clave = clave; GRAF.trae = true; GRAF.error = null;
  try {
    const r = E.v === "agencia" ? await rpc("portal_general", { p_since: a, p_until: b })
      : modoCliente ? await rpc("portal_mi_tablero", { p_since: a, p_until: b, p_limit: 0, p_offset: 0 })
      : await rpc("portal_cliente", { p_client: E.c, p_since: a, p_until: b, p_limit: 0, p_offset: 0 });
    if (t !== GRAF.turno) return;
    GRAF.datos = r.dias || []; GRAF.cuando = Date.now();
  } catch (e) {
    if (t !== GRAF.turno) return;
    GRAF.error = e.message;
  }
  GRAF.trae = false;
  GRAF.anim = !refrescar;
  pintarGraf();
}

/* ---------- Vista: General ---------- */
function vistaGeneral() {
  const todos = GEN.clientes.filter((c) => !E.soloActivos || c.activo || num(c.revenue) > 0 || num(c.spend) > 0);
  const eco = todos.filter((c) => c.kind !== "leads").map((c) => {
    const spend = num(c.spend), fac = num(c.revenue), tieneTienda = c.tn_stores.length + c.woo_shops.length > 0;
    return { ...c, spend, fac, ord: c.orders == null ? null : num(c.orders), tieneTienda, mer: tieneTienda && spend > 0 ? fac / spend : null };
  });
  const term = E.q.toLowerCase();
  const lista = eco.filter((c) => !term || c.name.toLowerCase().includes(term));
  lista.sort((a, b) => {
    if (E.sortK === "name") return E.sortDir * a.name.localeCompare(b.name, "es");
    return E.sortDir * ((a[E.sortK] ?? -Infinity) - (b[E.sortK] ?? -Infinity));
  });
  const conT = lista.filter((c) => c.tieneTienda);
  const inv = lista.reduce((s, c) => s + c.spend, 0), invT = conT.reduce((s, c) => s + c.spend, 0), fac = conT.reduce((s, c) => s + c.fac, 0), mer = invT > 0 ? fac / invT : null;
  const mt = movil() ? corto : money;
  const th = (k, t, cl = "") => `<th class="${cl}"><button data-k="${k}" ${E.sortK === k ? `data-dir="${E.sortDir > 0 ? "↑" : "↓"}"` : ""}>${t}</button></th>`;
  const filas = lista.map((c) => {
    const w = c.mer == null ? 0 : Math.min(100, (c.mer / 12) * 100), mc = merCls(c.mer);
    const sinApp = c.tn_stores.length > 0 && num(c.tiendas_vivo) < c.tn_stores.length;
    const nota = !c.tieneTienda ? "Sin tienda vinculada" : c.error_tienda ? "Problema de conexión con la tienda" : sinApp ? "Sin la app de Tiendanube" : "";
    const vivo = num(c.tiendas_vivo) > 0;
    return `<tr class="fila" tabindex="0" data-id="${esc(c.id)}">
      <td class="nom"><b><span class="punto ${vivo ? "" : "lento"}" title="${vivo ? "En vivo" : "Cada 2 horas"}"></span>${esc(c.name)}</b>${nota ? `<small>${nota}</small>` : ""}</td>
      <td>${mt(c.spend)}</td>
      <td>${c.tieneTienda ? mt(c.fac) : '<span class="na">—</span>'}</td>
      <td><div class="mer"><div class="gauge ${mc}" aria-hidden="true"><i style="width:${w}%"></i></div><b class="${mc}">${merTxt(c.mer)}</b></div></td>
      <td class="hm">${c.ord == null ? '<span class="na">—</span>' : nf0.format(c.ord)}</td>
      <td class="hm">${c.ord ? money(c.fac / c.ord) : '<span class="na">—</span>'}</td>
    </tr>`;
  }).join("");
  const leads = todos.filter((c) => c.kind === "leads");
  const tablaLeads = leads.length ? `<section class="bloque"><h2>Generación de leads</h2><p class="sub" style="padding:0 16px 8px">Se miden por inversión y mensajes.</p><div class="tablebox"><table>
      <thead><tr><th>Cliente</th><th>Inversión</th><th>Mensajes</th><th>Costo por mensaje</th></tr></thead><tbody>${leads.map((c) => {
        const s = num(c.spend), m = num(c.messages);
        return `<tr class="fila" tabindex="0" data-id="${esc(c.id)}"><td class="nom"><b>${esc(c.name)}</b></td><td>${money(s)}</td><td>${nf0.format(m)}</td><td>${m ? money(s / m) : '<span class="na">—</span>'}</td></tr>`;
      }).join("")}</tbody></table></div></section>` : "";
  return `<div class="cab"><div><h1>Clientes</h1><p class="sub">${rangoTxt(rango())} · ${lista.length} clientes</p></div>${fuentes()}</div>
    <div class="kpis">
      ${kpi("Inversión Meta", money(inv), term ? "" : cambio(inv, num(GEN.prev?.spend)), "", "inv")}${kpi("Facturación tiendas", money(fac), term ? "" : cambio(fac, num(GEN.prev?.revenue)), "", "fac")}
      ${kpi("MER global", merTxt(mer), (!term && num(GEN.prev?.spend) > 0 && cambio(mer, num(GEN.prev?.revenue) / num(GEN.prev?.spend))) || "Solo clientes con tienda", merCls(mer), "mer")}${kpi("Clientes con ventas", nf0.format(conT.filter((c) => c.fac > 0).length), `de ${conT.length} con tienda`, "", "tie")}
    </div>
    <section class="bloque">
      <div class="barra"><input class="buscar" id="q" type="search" placeholder="Buscar cliente" value="${esc(E.q)}" aria-label="Buscar cliente">
        <label class="check"><input type="checkbox" id="soloActivos" ${E.soloActivos ? "checked" : ""}> Solo clientes activos</label></div>
      <div class="tablebox"><table>
        <thead><tr>${th("name", "Cliente")}${th("spend", "Inversión")}${th("fac", "Facturación")}${th("mer", "MER")}${th("ord", "Ventas", "hm")}<th class="hm">Ticket</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="6" class="vacio" style="text-align:center">Ningún cliente coincide.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td>${mt(inv)}</td><td>${mt(fac)}</td><td><b class="${merCls(mer)}">${merTxt(mer)}</b></td><td class="hm"></td><td class="hm"></td></tr></tfoot>
      </table></div>
      <div class="pie"><span><span class="punto"></span>En vivo <span class="punto lento" style="margin-left:12px"></span>Tienda sin conectar: Master Metrics, cada 2 horas</span></div>
    </section>${tablaLeads}`;
}
const kpi = (t, v, sub = "", cls = "", ic = "") => `<div class="kpi"><span class="kpi-t">${ic ? icono(ic) : ""}${esc(t)}</span><b class="${cls}">${esc(v)}</b>${sub ? `<small>${subTxt(sub, ic)}</small>` : ""}</div>`;
function fuentes() {
  const e = GEN.estado || {};
  const meta = e.meta_ultima_sync, tn = e.tn_ultima_sync, mm = e.mm_ultima_sync;
  const partes = [];
  partes.push(tn ? `<span><i></i>Tiendanube ${esc(hace(tn))}</span>` : `<span><i class="lento"></i>Tiendanube por Master Metrics ${esc(hace(mm) || "")}</span>`);
  partes.push(meta ? `<span><i class="${num(e.meta_errores) ? "mal" : ""}"></i>Meta ${esc(hace(meta))}${num(e.meta_errores) ? ` · ${num(e.meta_errores)} cuentas con error` : ""}</span>`
    : `<span><i class="lento"></i>Meta por Master Metrics ${esc(hace(mm) || "")}</span>`);
  return `<div class="fuentes">${partes.join("")}</div>`;
}

/* ---------- Vista: Cliente ---------- */
function vistaCliente() {
  if (!E.c || !CLI) return `<div class="cab"><h1>Elegí un cliente</h1></div><p class="sub">Usá el desplegable de arriba.</p>`;
  const c = CLI.cliente, dias = diasCompletos(CLI.dias || []);
  const nombre = `<div class="cab"><div><h1>${esc(c.name)}</h1><p class="sub">${rangoTxt(rango())}</p></div><div class="cab-der">${fuentesCliente()}${modoCliente ? "" : '<button class="btn" id="linkCliente">Link para el cliente</button>'}</div></div>`;
  const spend = dias.reduce((s, d) => s + num(d.spend), 0);
  if (c.kind === "leads") {
    const msgs = dias.reduce((s, d) => s + num(d.messages), 0);
    return nombre + tiles({
      inv: [money(spend), cambio(spend, num(CLI.prev?.spend))],
      msg: [nf0.format(msgs), cambio(msgs, num(CLI.prev?.messages))],
      cpm: [msgs ? money(spend / msgs) : "—", ""],
    }) + bloqueGraf();
  }
  const fac = dias.reduce((s, d) => s + num(d.revenue), 0);
  const mer = spend > 0 ? fac / spend : null;
  const hayOrdenes = dias.some((d) => d.orders != null);
  const ventas = dias.reduce((s, d) => s + num(d.orders), 0);
  const nuevos = dias.reduce((s, d) => s + num(d.nuevos), 0), recs = dias.reduce((s, d) => s + num(d.recurrentes), 0);
  const conectada = (CLI.tiendas || []).some((t) => t.conectada);
  const compradoresCargando = (CLI.tiendas || []).some((t) => t.conectada && !t.buyers_done);
  const avisoCompradores = compradoresCargando ? "Cargando historial: puede dar alto" : "";
  const cac = nuevos > 0 && spend > 0 ? spend / nuevos : null;
  const lista = conectada ? tablaProductos() + tablaOrdenes() : "";
  const P = CLI.prev || {}, pFac = num(P.revenue), pInv = num(P.spend), pVen = num(P.orders), pUni = num(P.unidades), pNue = num(P.nuevos);
  const pMer = pInv > 0 ? pFac / pInv : null, unidades = num(CLI.unidades), pTic = pVen > 0 ? pFac / pVen : 0, pCac = pNue > 0 && pInv > 0 ? pInv / pNue : 0;
  const cortes = conectada
    ? `<div class="tortas">${torta("Método de pago", CLI.pagos || [], pagoTxt)}${torta("Cuotas", CLI.cuotas || [], (k) => (Number(k) === 1 ? "1 pago" : `${k} cuotas`))}${torta("Método de envío", CLI.envios || [], (k) => k)}${torta("Proveedor de pago", CLI.pasarelas || [], (k) => k)}${torta("Clientes nuevos y recurrentes", CLI.tipos || [], (k) => (k === "Nuevo" ? "Nuevos" : "Recurrentes"))}</div>`
    : "";
  return nombre + avisoConexion(conectada) + `
    ${tiles({
      fac: [money(fac), cambio(fac, pFac)],
      inv: [money(spend), cambio(spend, pInv)],
      mer: [merTxt(mer), pMer ? cambio(mer, pMer) : "", merCls(mer)],
      ven: [hayOrdenes ? nf0.format(ventas) : "—", hayOrdenes ? cambio(ventas, pVen) : ""],
      tic: [hayOrdenes && ventas ? money(fac / ventas) : "—", hayOrdenes && ventas ? cambio(fac / ventas, pTic) : ""],
      cac: [cac == null ? "—" : money(cac), compradoresCargando ? "Cargando historial: puede dar bajo" : (cac == null ? "" : cambio(cac, pCac)) || "Inversión ÷ clientes nuevos"],
    }, conectada ? [
      kpi("Clientes nuevos", nf0.format(nuevos), avisoCompradores || cambio(nuevos, pNue) || (nuevos + recs ? `${pct(nuevos, nuevos + recs)}% de las ventas` : ""), "", "cli"),
      kpi("Productos vendidos", nf0.format(unidades), cambio(unidades, pUni), "", "uni"),
    ] : [])}` +
    bloqueGraf() +
    cortes + lista;
}
function fuentesCliente() {
  if (modoCliente) return "";
  const t = (CLI.tiendas || []).filter((x) => x.conectada);
  const ult = t.map((x) => x.last_webhook_at || x.last_sync_at).filter(Boolean).sort().pop();
  const tn = (CLI.cliente.tn_stores || []).length === 0 ? "" : t.length
    ? `<span><i class="${t.some((x) => x.last_error) ? "mal" : ""}"></i>Tienda en vivo${ult ? ` · ${esc(hace(ult))}` : ""}</span>`
    : `<span><i class="lento"></i>Tienda sin conectar · cada 2 horas</span>`;
  const meta = CLI.meta_sync ? `<span><i></i>Meta ${esc(hace(CLI.meta_sync))}</span>` : `<span><i class="lento"></i>Meta · cada 2 horas</span>`;
  return `<div class="fuentes">${tn}${meta}</div>`;
}
function avisoConexion(conectada) {
  if (modoCliente) return "";
  if (conectada || !(CLI.cliente.tn_stores || []).length) {
    const cob = (CLI.tiendas || []).map((t) => t.coverage_from).filter(Boolean).sort().pop();
    return conectada && !cob ? '<div class="aviso">Trayendo el historial de esta tienda. Mientras tanto, los días anteriores salen de Master Metrics.</div>' : "";
  }
  const url = GEN.app_id ? `https://www.tiendanube.com/apps/${encodeURIComponent(GEN.app_id)}/authorize` : "";
  return `<div class="aviso aviso-app"><div><b>Este cliente no tiene la app descargada en su tienda.</b> Compartile este link para que pueda hacerlo:</div>
    ${url ? `<div class="aviso-link"><code>${esc(url)}</code><button type="button" class="btn" id="copiarApp" data-url="${esc(url)}">Copiar link</button></div>` : ""}
    <small>Hasta que la instale, los números salen de Master Metrics y faltan órdenes, cuotas y envíos.</small></div>`;
}
const ESTADOS = { paid: ["Pagada", "ok"], pending: ["Sin pagar", "pend"], authorized: ["Autorizada", "pend"], voided: ["Anulada", "mal"], refunded: ["Reembolsada", "mal"], partially_paid: ["Sin pagar", "pend"], partially_refunded: ["Reembolso parcial", "mal"], abandoned: ["Abandonada", "mal"] };
function tablaOrdenes() {
  const ord = CLI.ordenes || [], total = num(CLI.ordenes_total);
  const maxOrden = ultimoNumero;
  ultimoNumero = ord.length ? Math.max(ultimoNumero ?? 0, ...ord.map((o) => num(o.number))) : ultimoNumero;
  const filas = ord.map((o) => {
    const nueva = sondeo && maxOrden != null && num(o.number) > maxOrden;
    const canc = o.status === "cancelled";
    const [txt, cls] = canc ? ["Cancelada", "mal"] : ESTADOS[o.payment_status] || [o.payment_status || "—", ""];
    const prods = (o.items || []).map((i) => `${i.q > 1 ? i.q + " × " : ""}${i.n}`).join(", ");
    return `<tr class="${nueva ? "nueva" : ""}">
      <td><b>#${esc(o.number)}</b><br><span class="sub">${esc(fechaHora(o.created_at))}</span></td>
      <td><b>${money(num(o.total))}</b></td>
      <td><span class="tag ${cls}">${esc(txt)}</span></td>
      <td class="izq hm">${esc(pagoTxt(o.payment_method))}${o.gateway ? `<br><span class="sub">${esc(o.gateway)}</span>` : ""}</td>
      <td class="hm">${num(o.installments) > 1 ? `${num(o.installments)} cuotas` : "1 pago"}</td>
      <td class="izq hm" style="white-space:normal;min-width:130px">${esc(o.shipping_option || "—")}</td>
      <td class="izq hm"><div class="prods" title="${esc(prods)}">${esc(prods.length > 90 ? prods.slice(0, 90) + "…" : prods) || "—"}</div></td>
      <td class="hm">${esc(o.tipo || "—")}</td>
    </tr>`;
  }).join("");
  return `<section class="bloque"><h2>Órdenes</h2><p class="sub" style="padding:0 16px 8px">${nf0.format(total)} en el período, de la más nueva a la más vieja.</p>
    <div class="tablebox"><table><thead><tr><th>Orden</th><th>Total</th><th>Estado</th><th class="izq hm">Pago</th><th class="hm">Cuotas</th><th class="izq hm">Envío</th><th class="izq hm">Productos</th><th class="hm">Cliente</th></tr></thead>
    <tbody>${filas || '<tr><td colspan="8" class="vacio" style="text-align:center">No hay órdenes en este período.</td></tr>'}</tbody></table></div>
    ${total > ord.length ? `<div class="pie"><span>Mostrando ${nf0.format(ord.length)} de ${nf0.format(total)}</span><button class="btn" id="masOrdenes">Ver más</button></div>` : ""}</section>`;
}

/* ---------- Vista: Agencia ---------- */
const ALERTA_DIAS = 3, CAIDA_PCT = 0.3, CAIDA_PUNTOS = 3;
function alertas(conInv) {
  if (agError && !AG) return '<div class="aviso err">No se pudieron traer las alertas. Probá de nuevo en unos minutos.</div>';
  if (!AG) return '<div class="skel" style="height:150px"></div>';
  const activos = AG.clientes.filter((c) => c.con_meta && num(c.inv_30) > 0);
  const venden = AG.clientes.filter((c) => c.kind !== "leads" && num(c.tiendas_vivas) > 0 && num(c.inv_30) > 0);
  const fila = (c, val) => `<li data-id="${esc(c.id)}" tabindex="0"><span>${esc(c.name)}</span><b>${val}</b></li>`;
  const tarjeta = (ic, titulo, ayuda, items, vacio, midiendo) => `<section class="alerta ${midiendo ? "" : items.length ? "mal" : "bien"}">
    <h3>${icono(ic)}<span>${esc(titulo)}</span><b>${midiendo ? "—" : items.length}</b></h3><p>${esc(ayuda)}</p>
    ${items.length ? `<ul class="lista">${items.join("")}</ul>` : `<p class="${midiendo ? "sub" : "alerta-ok"}">${esc(vacio)}</p>`}</section>`;
  const sinGasto = AG.gasto_medible ? activos.filter((c) => c.sin_gasto_12h) : [];
  const sinVenta = venden.filter((c) => c.ult_venta == null || num(c.dias_sin_venta) >= ALERTA_DIAS)
    .sort((a, b) => (b.ult_venta == null) - (a.ult_venta == null) || num(b.dias_sin_venta) - num(a.dias_sin_venta));
  // Cae el MER: últimos 7 días contra los 7 anteriores, 3 puntos o 30%, y además baja de color.
  const nivel = (v) => (v >= 6 ? 2 : v >= 3 ? 1 : 0);
  const caida = AG.clientes.filter((c) => c.kind !== "leads" && num(c.inv_7) > 0 && num(c.inv_7_prev) > 0 && num(c.fac_7_prev) > 0)
    .map((c) => ({ ...c, ahora: num(c.fac_7) / num(c.inv_7), antes: num(c.fac_7_prev) / num(c.inv_7_prev) }))
    .filter((c) => nivel(c.ahora) < nivel(c.antes) && (c.antes - c.ahora >= CAIDA_PUNTOS || (c.antes - c.ahora) / c.antes >= CAIDA_PCT))
    .sort((a, b) => (b.antes - b.ahora) - (a.antes - a.ahora));
  const rojos = conInv.filter((c) => c.mer < 3).sort((a, b) => a.mer - b.mer);
  return `<div class="alertas">
    ${tarjeta("inv", "Sin gasto hace 12 horas o más", AG.gasto_medible ? "Invirtieron en los últimos 30 días, pero se frenaron." : "Se puede medir desde el mediodía.", sinGasto.map((c) => fila(c, "Frenado")), AG.gasto_medible ? "Todos están gastando." : "Todavía midiendo.", !AG.gasto_medible)}
    ${tarjeta("ven", `Sin ventas hace ${ALERTA_DIAS} días o más`, "Tiendas conectadas que siguen con inversión.", sinVenta.map((c) => fila(c, c.ult_venta == null ? "Sin ventas" : `${nf0.format(num(c.dias_sin_venta))} días`)), "Todos vendieron en estos días.")}
    ${tarjeta("mer", "Cayó el retorno (MER)", "Últimos 7 días contra los 7 anteriores: bajó de color, con 3 puntos o un 30% menos.", caida.map((c) => fila(c, `<span class="${merCls(c.antes)}">${merTxt(c.antes)}</span> → <span class="${merCls(c.ahora)}">${merTxt(c.ahora)}</span>`)), "Nadie bajó de color.")}
    ${tarjeta("cli", "Clientes en rojo", "MER menor a 3 en las fechas de arriba.", rojos.map((c) => fila(c, merTxt(c.mer))), "Ningún cliente en rojo.")}
  </div>`;
}
function bloqueMer(conInv) {
  const grupos = { g: conInv.filter((c) => c.mer >= 6), m: conInv.filter((c) => c.mer >= 3 && c.mer < 6), r: conInv.filter((c) => c.mer < 3) };
  const color = { g: "var(--good)", m: "var(--mid)", r: "var(--bad)" }, texto = { g: "con 6 o más", m: "entre 3 y 6", r: "con menos de 3" };
  const seg = (k) => (grupos[k].length ? `<button type="button" data-agmer="${k}" aria-pressed="${E.agMer === k}" aria-label="${grupos[k].length} clientes ${texto[k]}" style="flex:${grupos[k].length};background:${color[k]}"></button>` : "");
  const chip = (k) => `<button type="button" class="mer-chip" data-agmer="${k}" aria-pressed="${E.agMer === k}"><i style="background:${color[k]}"></i><b>${grupos[k].length}</b> ${texto[k]}</button>`;
  const lista = E.agMer ? [...grupos[E.agMer]].sort((a, b) => a.mer - b.mer) : [];
  const tabla = E.agMer ? (lista.length ? `<div class="tablebox"><table><thead><tr><th>Cliente</th><th>MER</th><th>Facturación</th><th>Inversión</th></tr></thead><tbody>${lista.map((c) => `<tr class="fila" tabindex="0" data-id="${esc(c.id)}"><td class="nom"><b>${esc(c.name)}</b></td><td><b class="${merCls(c.mer)}">${merTxt(c.mer)}</b></td><td>${money(c.f)}</td><td>${money(c.s)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="sub" style="padding:0 16px 14px">Ningún cliente en este grupo.</p>') : "";
  return `<section class="bloque"><h2>Clientes por MER</h2><p class="sub" style="padding:0 16px">Tocá un color para ver quiénes están ahí. Mismas fechas que arriba.</p>
    <div class="semaforo sem-btn">${seg("g")}${seg("m")}${seg("r")}</div>
    <div class="semaforoley">${chip("r")}${chip("m")}${chip("g")}</div>${tabla}</section>`;
}
function bloqueTiendas(link) {
  const tn = GEN.clientes.filter((c) => c.tn_stores.length);
  const conectados = tn.filter((c) => num(c.tiendas_vivo) >= c.tn_stores.length), faltan = tn.filter((c) => num(c.tiendas_vivo) < c.tn_stores.length);
  return `<section class="bloque"><h2>Tiendas conectadas en vivo</h2><p class="sub" style="padding:0 16px">${conectados.length} de ${tn.length} clientes con Tiendanube.</p>
    <div class="prog"><i style="width:${tn.length ? (conectados.length / tn.length) * 100 : 0}%"></i></div>
    ${faltan.length ? `<div class="faltan"><span class="sub">Faltan conectar (${faltan.length})</span>${link ? `<button type="button" class="btn" id="copiarApp" data-url="${esc(link)}">Copiar link de la app</button>` : ""}</div>
      <ul class="lista lista-alta">${faltan.sort((x, y) => x.name.localeCompare(y.name, "es")).map((c) => `<li data-id="${esc(c.id)}" tabindex="0"><span>${esc(c.name)}</span><b class="sub">Ver</b></li>`).join("")}</ul>` : '<p class="alerta-ok" style="padding:8px 16px 14px">Están todas conectadas.</p>'}</section>`;
}
function bloqueMovimientos() {
  if (!AG) return "";
  const hoy = hoyBA(), mes = hoy.slice(0, 7), este = AG.movimientos.filter((m) => String(m.fecha).slice(0, 7) === mes);
  const nAlt = este.filter((m) => m.tipo === "alta").length, nBaj = este.filter((m) => m.tipo === "baja").length;
  const fechaInp = `<label>Fecha<input type="date" id="agFecha" value="${hoy}" max="${hoy}"></label>`, motivo = (t) => `<label class="ancho">${t}<input type="text" id="agMotivo" maxlength="300" placeholder="Opcional"></label>`;
  const activos = [...GEN.clientes].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const forms = {
    baja: `<label class="ancho">Cliente<select id="agCliente"><option value="">Elegí un cliente</option>${activos.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>${fechaInp}${motivo("Motivo")}
      <p class="sub ancho">Sale de Clientes, General, MER View y las cargas. Conserva su historial y se puede volver a activar.</p><div class="ancho"><button type="button" class="btn peligro" id="agBaja">Dar de baja</button></div>`,
    alta: `<label class="ancho">Nombre del cliente<input type="text" id="agNombre" maxlength="80" autocomplete="off"></label>
      <label>Tipo<select id="agTipo"><option value="">Tienda online</option><option value="leads">Leads</option></select></label>
      <label>Tienda conectada<select id="agTienda"><option value="">${AG.tiendas_libres.length ? "Todavía ninguna" : "No hay tiendas sin asignar"}</option>${AG.tiendas_libres.map((t) => `<option value="${esc(t.id)}">${esc(t.name || t.id)}</option>`).join("")}</select></label>
      <label>Cuenta de Meta (ID)<input type="text" id="agMeta" inputmode="numeric" placeholder="Opcional"></label>${fechaInp}
      <div class="ancho"><button type="button" class="btn pri" id="agAlta">Dar de alta</button></div>
      ${AG.inactivos.length ? `<div class="ancho volver"><span class="sub">¿Vuelve un cliente que se había ido?</span><select id="agVuelve"><option value="">Elegí un cliente</option>${AG.inactivos.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select><button type="button" class="btn" id="agReactivar">Volver a activar</button></div>` : ""}`,
  };
  const form = E.agForm ? `<div class="ag-form">${E.agErr ? `<p class="aviso err ancho" style="margin:0">${esc(E.agErr)}</p>` : ""}${forms[E.agForm]}</div>` : "";
  const hist = AG.movimientos.slice(0, 12);
  return `<section class="bloque"><div class="ag-cab"><div><h2>Altas y bajas</h2><p class="sub">Este mes: ${nAlt} ${nAlt === 1 ? "alta" : "altas"} y ${nBaj} ${nBaj === 1 ? "baja" : "bajas"}.</p></div>
      <div class="ag-btns"><button type="button" class="btn" data-agform="alta" aria-pressed="${E.agForm === "alta"}">Registrar alta</button><button type="button" class="btn" data-agform="baja" aria-pressed="${E.agForm === "baja"}">Registrar baja</button></div></div>
    ${form}
    ${hist.length ? `<div class="tablebox"><table><thead><tr><th>Cliente</th><th>Movimiento</th><th>Fecha</th><th class="izq hm">Motivo</th></tr></thead><tbody>${hist.map((m) => `<tr><td class="nom"><b>${esc(m.name)}</b></td><td><span class="tag ${m.tipo === "alta" ? "ok" : "mal"}">${m.tipo === "alta" ? "Alta" : "Baja"}</span></td><td>${esc(ddmm(String(m.fecha).slice(0, 10)))}/${esc(String(m.fecha).slice(2, 4))}</td><td class="izq hm" style="white-space:normal">${esc(m.motivo || "—")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="sub" style="padding:0 16px 14px">Todavía no hay movimientos cargados.</p>'}</section>`;
}
function vistaAgencia() {
  const dias = diasCompletos(GEN.dias || []);
  const eco = GEN.clientes.filter((c) => c.kind !== "leads" && c.tn_stores.length + c.woo_shops.length > 0)
    .map((c) => ({ ...c, s: num(c.spend), f: num(c.revenue) })).map((c) => ({ ...c, mer: c.s > 0 ? c.f / c.s : null }));
  const fac = dias.reduce((s, d) => s + num(d.revenue), 0), inv = dias.reduce((s, d) => s + num(d.spend), 0), mer = inv > 0 ? fac / inv : null;
  const pf = num(GEN.prev?.revenue), pi = num(GEN.prev?.spend), pm = pi > 0 ? pf / pi : null;
  const conInv = eco.filter((c) => c.mer != null);
  const top = [...eco].filter((c) => c.f > 0).sort((x, y) => y.f - x.f).slice(0, 10), totTop = eco.reduce((s, c) => s + c.f, 0);
  const link = GEN.app_id ? `https://www.tiendanube.com/apps/${encodeURIComponent(GEN.app_id)}/authorize` : null;
  return `<div class="cab"><div><h1>General</h1><p class="sub">${rangoTxt(rango())} · sin clientes de leads</p></div>${fuentes()}</div>
    <div class="kpis">
      ${kpi("Facturación de clientes", money(fac), cambio(fac, pf), "", "fac")}${kpi("Inversión gestionada", money(inv), cambio(inv, pi), "", "inv")}
      ${kpi("MER global", merTxt(mer), pm ? cambio(mer, pm) : "", merCls(mer), "mer")}${kpi("Clientes invirtiendo", nf0.format(conInv.length), `de ${eco.length} con tienda`, "", "tie")}
    </div>
    <h2 class="titulo-sec">Alertas</h2>${alertas(conInv)}
    ${bloqueMer(conInv)}
    <div class="dos">
      <section class="bloque"><h2>Mayor facturación</h2><ul class="lista">${top.map((c, i) => `<li data-id="${esc(c.id)}" tabindex="0"><span><i class="pos">${i + 1}</i>${esc(c.name)}</span><b>${money(c.f)}<small>${pct(c.f, totTop)}%</small></b></li>`).join("") || "<li>Sin datos</li>"}</ul></section>
      ${bloqueTiendas(link)}
    </div>
    ${bloqueMovimientos()}
    <h2 class="titulo-sec">Evolución</h2>${bloqueGraf()}`;
}

/* ---------- Pintar sin perder lo que el usuario está mirando ---------- */
function pintar() {
  const foco = document.activeElement?.id, pos = foco === "q" ? document.activeElement.selectionStart : null, y = window.scrollY;
  pintarControles();
  medirGraficos();
  $("vista").innerHTML = E.v === "agencia" ? vistaAgencia() : E.v === "cliente" ? vistaCliente() : vistaGeneral();
  document.title = (E.v === "cliente" && CLI ? CLI.cliente.name : E.v === "agencia" ? "General" : "Clientes") + " · Elevation";
  activarGraficos();
  // Mientras está en vivo, las fechas propias del gráfico se refrescan cada 2 minutos.
  traerGraf(sondeo && grafRango()[1] >= hoyBA() && Date.now() - GRAF.cuando > 120000);
  if (foco === "q" && $("q")) { $("q").focus(); $("q").setSelectionRange(pos, pos); }
  window.scrollTo(0, y);
}

/* ---------- Eventos ---------- */
document.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => { E.v = b.dataset.v; $("aviso").hidden = true; escribirUrl(); cargar(); }));
document.querySelectorAll("#fechas button").forEach((b) => b.addEventListener("click", () => { E.p = b.dataset.p; E.limite = 100; escribirUrl(); pintarControles(); cargar(); programar(); }));
function cambiarRango() {
  let a = $("dDesde").value, b = $("dHasta").value;
  if (!a || !b) return;
  if (a > b) [a, b] = [b, a];
  if ((new Date(b) - new Date(a)) / 864e5 > 400) { const av = $("aviso"); av.textContent = "El rango máximo es de 400 días."; av.className = "aviso err"; av.hidden = false; return; }
  $("aviso").hidden = true;
  E.desde = a; E.hasta = b; E.limite = 100; escribirUrl(); cargar(); programar();
}
$("dDesde").addEventListener("change", cambiarRango);
$("dHasta").addEventListener("change", cambiarRango);
$("pickBtn").addEventListener("click", () => abrirMenu($("menu").hidden));
$("menuQ").addEventListener("input", pintarMenu);
$("menuQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { const p = $("menuL").querySelector("button"); if (p) irCliente(p.dataset.id); } });
$("menuL").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) irCliente(b.dataset.id); });
document.addEventListener("click", (e) => { if (!$("pick").contains(e.target)) abrirMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") abrirMenu(false); });

const vista = $("vista");
vista.addEventListener("input", (e) => { if (e.target.id === "q") { E.q = e.target.value; pintar(); } });
vista.addEventListener("change", (e) => {
  if (e.target.id === "soloActivos") { E.soloActivos = e.target.checked; pintar(); }
  if (e.target.id === "grafD" || e.target.id === "grafH") {
    let a = $("grafD").value, b = $("grafH").value;
    if (!a || !b) return;
    if (a > b) [a, b] = [b, a];
    if ((new Date(b) - new Date(a)) / 864e5 > 400) { const av = $("aviso"); av.textContent = "El rango máximo es de 400 días."; av.className = "aviso err"; av.hidden = false; return; }
    $("aviso").hidden = true;
    E.graf.desde = a; E.graf.hasta = b; E.graf.g = null; GRAF.error = null; GRAF.anim = true;
    pintarGraf(); traerGraf();
  }
});
vista.addEventListener("click", (e) => {
  const th = e.target.closest("th button");
  if (th) {
    const k = th.dataset.k;
    if (E.sortK === k) E.sortDir = -E.sortDir; else { E.sortK = k; E.sortDir = k === "name" ? 1 : -1; }
    return pintar();
  }
  if (e.target.id === "linkCliente") return linkCliente(false);
  const am = e.target.closest("[data-agmer]");
  if (am) { E.agMer = E.agMer === am.dataset.agmer ? null : am.dataset.agmer; return pintar(); }
  const af = e.target.closest("[data-agform]");
  if (af) { E.agForm = E.agForm === af.dataset.agform ? null : af.dataset.agform; E.agErr = null; return pintar(); }
  if (e.target.id === "agBaja" || e.target.id === "agAlta" || e.target.id === "agReactivar") return guardarMovimiento(e.target.id);
  if (e.target.id === "copiarApp") {
    const b = e.target;
    navigator.clipboard.writeText(b.dataset.url).then(() => { b.textContent = "¡Copiado!"; setTimeout(() => { b.textContent = "Copiar link"; }, 2000); }, () => { b.textContent = "Copialo a mano"; });
    return;
  }
  const gm = e.target.closest("[data-gm]");
  if (gm) return elegirMetrica(gm.dataset.gm);
  const gg = e.target.closest("[data-gg]");
  if (gg) { E.graf.g = gg.dataset.gg; GRAF.anim = true; return pintarGraf(); }
  const gp = e.target.closest("[data-gper]");
  if (gp) { E.graf.p = gp.dataset.gper; E.graf.g = null; GRAF.error = null; GRAF.anim = true; pintarGraf(); return traerGraf(); }
  if (e.target.closest("[data-gtabla]")) { E.graf.tabla = !E.graf.tabla; return pintarGraf(); }
  if (e.target.id === "masOrdenes") { E.limite = Math.min(E.limite + 200, 500); return cargar({ silencio: true }); }
  const f = e.target.closest("tr.fila[data-id], .lista li[data-id]");
  if (f) irCliente(f.dataset.id);
});
vista.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.fila, .lista li")) { e.preventDefault(); irCliente(e.target.dataset.id); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && clave && incluyeHoy()) cargar({ silencio: true }); });
let finResize = null;
window.addEventListener("resize", () => { clearTimeout(finResize); finResize = setTimeout(() => { if (GEN || CLI) pintar(); }, 200); });
window.addEventListener("hashchange", () => { if (/[#&][kt]=/.test(location.hash)) location.reload(); });

/* ---------- Avisos al volver de conectar una tienda ---------- */
const ERRORES = {
  sin_codigo: "Tiendanube no devolvió la autorización. Volvé a intentar.",
  app_sin_configurar: "A la app le falta configuración (ID o secreto).",
  autorizacion_rechazada: "Tiendanube rechazó la autorización. El código vence a los 5 minutos: volvé a tocar Conectar.",
  no_se_guardo: "La tienda autorizó pero no se pudo guardar. Volvé a tocar Conectar.",
  fallo_interno: "Hubo un error al conectar la tienda. Volvé a intentar.",
};
(function () {
  const p = new URLSearchParams(location.search), a = $("aviso");
  if (p.get("instalada")) { a.textContent = `Listo: ${p.get("instalada")} quedó conectada. Su historial se va cargando en los próximos minutos.`; a.className = "aviso ok"; a.hidden = false; }
  else if (p.get("error")) { a.textContent = ERRORES[p.get("error")] || "No se pudo conectar la tienda."; a.className = "aviso err"; a.hidden = false; }
})();

/* ---------- Arranque ---------- */
clave = leerClave();
if (!clave) bloquear();
else {
  if (modoCliente) { E.v = "cliente"; document.body.classList.add("modo-cliente"); }
  leerUrl(); escribirUrl();
  $("app").hidden = false;
  cargar();
  programar();
  setInterval(pulso, 1000);
}
