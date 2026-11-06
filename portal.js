"use strict";
const CFG = window.MERVIEW_CONFIG || {};
const KEY_STORE = "merview_key", POLL_MS = 20000, TZ = "America/Argentina/Buenos_Aires";
const $ = (id) => document.getElementById(id);

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
const merCls = (v) => (v == null || !isFinite(v) ? "na" : v >= 6 ? "g" : v >= 3 ? "m" : "r");
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

/* ---------- Estado ---------- */
const E = { v: "general", c: null, p: "mes", desde: null, hasta: null, q: "", soloActivos: true, sortK: "spend", sortDir: -1, limite: 100, abiertos: { fac: true } };
let clave = null, GEN = null, CLI = null, ultimaOk = null, turno = 0, timer = null, ultimoNumero = null, sondeo = false, primeraVez = true;

function leerUrl() {
  const u = new URLSearchParams(location.search);
  if (u.get("c")) { E.c = u.get("c"); E.v = "cliente"; }
  if (u.get("v") === "agencia") E.v = "agencia";
  if (u.get("p")) E.p = u.get("p");
  if (u.get("d")) E.desde = u.get("d");
  if (u.get("h")) E.hasta = u.get("h");
}
function escribirUrl() {
  const u = new URLSearchParams();
  if (E.v === "cliente" && E.c) u.set("c", E.c);
  if (E.v === "agencia") u.set("v", "agencia");
  if (E.p !== "mes") u.set("p", E.p);
  if (E.p === "rango" && E.desde) { u.set("d", E.desde); u.set("h", E.hasta); }
  const qs = u.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

/* ---------- Acceso (misma clave que MER View) ---------- */
function leerClave() {
  const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
  if (m) {
    try { localStorage.setItem(KEY_STORE, m[1]); } catch (e) {}
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; }
}
function bloquear(msg) {
  $("app").hidden = true; $("login").hidden = false;
  if (msg) { $("loginErr").textContent = msg; $("loginErr").hidden = false; }
  clearInterval(timer);
}
async function rpc(fn, args) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: clave, ...args }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
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
    const g = rpc("portal_general", { p_since: d, p_until: h });
    const c = E.v === "cliente" && E.c
      ? rpc("portal_cliente", { p_client: E.c, p_since: d, p_until: h, p_limit: E.limite, p_offset: 0 }) : null;
    const [rg, rc] = await Promise.all([g, c]);
    if (t !== turno) return;
    GEN = rg; CLI = rc; ultimaOk = Date.now(); sondeo = !!opts.silencio;
    $("login").hidden = true; $("app").hidden = false;
    pintar();
    sondeo = false;
    primeraVez = false;
  } catch (e) {
    if (t !== turno) return;
    if (e.clave) { try { localStorage.removeItem(KEY_STORE); } catch (_) {} return bloquear("El link de acceso ya no es válido. Pedí el link nuevo."); }
    if (primeraVez) return bloquear("No se pudo cargar el portal: " + e.message);
    if (!opts.silencio) $("vista").innerHTML = `<div class="aviso err">No se pudieron traer los datos (${esc(e.message)}). Probá de nuevo en unos segundos.</div>`;
  } finally { pulso(); }
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
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === E.v ? "true" : "false"));
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
function irCliente(id) { E.c = id; E.v = "cliente"; E.limite = 100; ultimoNumero = null; abrirMenu(false); escribirUrl(); cargar(); }

/* ---------- Gráficos ---------- */
const movil = () => window.matchMedia("(max-width:640px)").matches;
const CHART = { W: 900, H: 210, izq: 58, der: 8, arr: 12, aba: 26 };
function medirGraficos() { CHART.W = Math.max(280, ($("vista").clientWidth || 900) - 34); CHART.H = movil() ? 170 : 210; CHART.izq = movil() ? 48 : 58; }
function escala(max) {
  const pot = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => (max / p) <= 4) || pot * 10;
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
  puntos.forEach((p, i) => { if (i % cada === 0) s += `<text x="${izq + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${ddmm(p.day)}</text>`; });
  return s;
}
function grafico(puntos, tipo, color, fmtY, fmtTip) {
  const vals = puntos.map((p) => p.v).filter((v) => v != null && isFinite(v));
  if (!vals.length || vals.every((v) => v === 0)) return '<div class="sinchart">No hay datos en este período.</div>';
  const { W, H, izq, der, arr, aba } = CHART, alto = H - arr - aba;
  const { paso, tope } = escala(Math.max(...vals));
  const slot = (W - izq - der) / puntos.length, y = (v) => arr + alto - (v / tope) * alto, x = (i) => izq + slot * i + slot / 2;
  let marcas = "";
  if (tipo === "barras") {
    const bw = Math.max(2, Math.min(24, slot * 0.62));
    puntos.forEach((p, i) => {
      if (!(p.v > 0)) return;
      const yy = y(p.v), r = Math.min(4, bw / 2, arr + alto - yy), xx = x(i) - bw / 2, b = arr + alto;
      marcas += `<path fill="${color}" d="M${xx} ${b}V${yy + r}Q${xx} ${yy} ${xx + r} ${yy}H${xx + bw - r}Q${xx + bw} ${yy} ${xx + bw} ${yy + r}V${b}Z"/>`;
    });
  } else {
    let tramo = "", tramos = [];
    puntos.forEach((p, i) => {
      if (p.v == null || !isFinite(p.v)) { if (tramo) tramos.push(tramo); tramo = ""; return; }
      tramo += `${tramo ? "L" : "M"}${x(i)} ${y(p.v)}`;
    });
    if (tramo) tramos.push(tramo);
    marcas = tramos.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
    if (puntos.length <= 45) puntos.forEach((p, i) => { if (p.v != null && isFinite(p.v)) marcas += `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="${color}" stroke="var(--panel)" stroke-width="2"/>`; });
  }
  const hits = puntos.map((p, i) => `<rect class="hit" data-t="${esc(fmtTip(p))}" x="${izq + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent"/>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" style="height:auto" role="img">${ejes(puntos, tope, paso, fmtY)}${marcas}${hits}</svg><div class="tip" hidden></div></div>`;
}
function activarGraficos() {
  document.querySelectorAll(".chart").forEach((ch) => {
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

function desplegable(id, titulo, resumen, cuerpo) {
  return `<details class="bloque" data-id="${id}" ${E.abiertos[id] ? "open" : ""}><summary><h2>${esc(titulo)}</h2><small>${esc(resumen)}</small></summary>${cuerpo}</details>`;
}
function diasCompletos(dias) {
  const [a, b] = rango(), m = new Map(dias.map((d) => [d.day, d])), out = [];
  for (let d = a; d <= b; d = sumar(d, 1)) out.push(m.get(d) || { day: d, revenue: 0, spend: 0, orders: 0, messages: 0, nuevos: 0 });
  return out;
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
    const nota = !c.tieneTienda ? "Sin tienda vinculada" : c.error_tienda ? "Problema de conexión con la tienda" : "";
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
  return `<div class="cab"><div><h1>Tablero general</h1><p class="sub">${rangoTxt(rango())} · ${lista.length} clientes</p></div>${fuentes()}</div>
    <div class="kpis">
      ${kpi("Inversión Meta", money(inv))}${kpi("Facturación tiendas", money(fac))}
      ${kpi("MER global", merTxt(mer), "Solo clientes con tienda", merCls(mer))}${kpi("Clientes con ventas", nf0.format(conT.filter((c) => c.fac > 0).length), `de ${conT.length} con tienda`)}
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
const kpi = (t, v, sub = "", cls = "") => `<div class="kpi"><span>${esc(t)}</span><b class="${cls}">${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
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
  const nombre = `<div class="cab"><div><h1>${esc(c.name)}</h1><p class="sub">${rangoTxt(rango())}</p></div>${fuentesCliente()}</div>`;
  const spend = dias.reduce((s, d) => s + num(d.spend), 0);
  const unDia = dias.length < 2;
  const resumen = (v) => v;
  if (c.kind === "leads") {
    const msgs = dias.reduce((s, d) => s + num(d.messages), 0);
    return nombre + `<div class="kpis">${kpi("Inversión Meta", money(spend))}${kpi("Mensajes", nf0.format(msgs))}${kpi("Costo por mensaje", msgs ? money(spend / msgs) : "—")}</div>` +
      desplegable("inv", "Inversión por día", money(spend), unDia ? msg1() : grafico(dias.map((d) => ({ day: d.day, v: num(d.spend) })), "barras", "var(--serie)", corto, (p) => `${ddmm(p.day)} · ${money(p.v)}`)) +
      desplegable("msg", "Mensajes por día", nf0.format(msgs), unDia ? msg1() : grafico(dias.map((d) => ({ day: d.day, v: num(d.messages) })), "barras", "var(--serie2)", (v) => nf0.format(v), (p) => `${ddmm(p.day)} · ${nf0.format(p.v)} mensajes`));
  }
  const fac = dias.reduce((s, d) => s + num(d.revenue), 0);
  const mer = spend > 0 ? fac / spend : null;
  const hayOrdenes = dias.some((d) => d.orders != null);
  const ventas = dias.reduce((s, d) => s + num(d.orders), 0);
  const nuevos = dias.reduce((s, d) => s + num(d.nuevos), 0), recs = dias.reduce((s, d) => s + num(d.recurrentes), 0);
  const conectada = (CLI.tiendas || []).some((t) => t.conectada);
  const cac = nuevos > 0 ? spend / nuevos : null;
  const puntos = (f) => dias.map((d) => ({ day: d.day, v: f(d) }));
  const lista = conectada ? tablaOrdenes() : "";
  const cortes = conectada
    ? `<div class="tortas">${torta("Método de pago", CLI.pagos || [], pagoTxt)}${torta("Cuotas", CLI.cuotas || [], (k) => (Number(k) === 1 ? "1 pago" : `${k} cuotas`))}${torta("Método de envío", CLI.envios || [], (k) => k)}${torta("Clientes nuevos y recurrentes", CLI.tipos || [], (k) => (k === "Nuevo" ? "Nuevos" : "Recurrentes"))}</div>`
    : "";
  return nombre + avisoConexion(conectada) + `
    <div class="kpis">
      ${kpi("Facturación Tiendanube", money(fac))}${kpi("Inversión Meta", money(spend))}
      ${kpi("MER", merTxt(mer), "", merCls(mer))}${kpi("Ventas", hayOrdenes ? nf0.format(ventas) : "—", hayOrdenes ? "" : "Disponible al conectar")}
    </div>
    <div class="kpis chico">
      ${kpi("Ticket promedio", hayOrdenes && ventas ? money(fac / ventas) : "—")}
      ${kpi("CAC", cac == null ? "—" : money(cac), "Inversión ÷ clientes nuevos")}
      ${kpi("Clientes nuevos", conectada ? nf0.format(nuevos) : "—", conectada && nuevos + recs ? `${pct(nuevos, nuevos + recs)}% de las ventas` : "")}
      ${kpi("Pendiente de pago", conectada ? money(num(CLI.pendiente?.total)) : "—", conectada ? `${nf0.format(num(CLI.pendiente?.ordenes))} órdenes` : "")}
    </div>` +
    desplegable("fac", "Facturación por día", resumen(money(fac)), unDia ? msg1() : grafico(puntos((d) => num(d.revenue)), "barras", "var(--serie)", corto, (p) => `${ddmm(p.day)} · ${money(p.v)}`)) +
    desplegable("mer", "Retorno por día (MER)", merTxt(mer), unDia ? msg1() : grafico(puntos((d) => (num(d.spend) > 0 ? num(d.revenue) / num(d.spend) : null)), "linea", "var(--serie2)", (v) => merTxt(v), (p) => `${ddmm(p.day)} · MER ${merTxt(p.v)}`)) +
    desplegable("inv", "Inversión por día", money(spend), unDia ? msg1() : grafico(puntos((d) => num(d.spend)), "barras", "var(--serie)", corto, (p) => `${ddmm(p.day)} · ${money(p.v)}`)) +
    (conectada ? desplegable("cac", "CAC por día", cac == null ? "—" : money(cac), unDia ? msg1() : grafico(puntos((d) => (num(d.nuevos) > 0 ? num(d.spend) / num(d.nuevos) : null)), "linea", "var(--s4)", corto, (p) => `${ddmm(p.day)} · CAC ${p.v == null ? "—" : money(p.v)}`)) : "") +
    cortes + lista;
}
const msg1 = () => '<div class="sinchart">Elegí un rango de más de un día para ver la evolución.</div>';
function fuentesCliente() {
  const t = (CLI.tiendas || []).filter((x) => x.conectada);
  const ult = t.map((x) => x.last_webhook_at || x.last_sync_at).filter(Boolean).sort().pop();
  const tn = (CLI.cliente.tn_stores || []).length === 0 ? "" : t.length
    ? `<span><i class="${t.some((x) => x.last_error) ? "mal" : ""}"></i>Tienda en vivo${ult ? ` · ${esc(hace(ult))}` : ""}</span>`
    : `<span><i class="lento"></i>Tienda sin conectar · cada 2 horas</span>`;
  const meta = CLI.meta_sync ? `<span><i></i>Meta ${esc(hace(CLI.meta_sync))}</span>` : `<span><i class="lento"></i>Meta · cada 2 horas</span>`;
  return `<div class="fuentes">${tn}${meta}</div>`;
}
function avisoConexion(conectada) {
  if (conectada || !(CLI.cliente.tn_stores || []).length) {
    const cob = (CLI.tiendas || []).map((t) => t.coverage_from).filter(Boolean).sort().pop();
    return conectada && !cob ? '<div class="aviso">Trayendo el historial de esta tienda. Mientras tanto, los días anteriores salen de Master Metrics.</div>' : "";
  }
  const link = GEN.app_id ? `<a class="btn pri" href="https://www.tiendanube.com/apps/${encodeURIComponent(GEN.app_id)}/authorize" target="_blank" rel="noopener">Conectar tienda</a>` : "";
  return `<div class="aviso">Esta tienda todavía no está conectada: los números salen de Master Metrics y faltan órdenes, cuotas y envíos.${link}</div>`;
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
function vistaAgencia() {
  const dias = diasCompletos(GEN.dias || []);
  const eco = GEN.clientes.filter((c) => c.kind !== "leads" && c.tn_stores.length + c.woo_shops.length > 0)
    .map((c) => ({ ...c, s: num(c.spend), f: num(c.revenue) })).map((c) => ({ ...c, mer: c.s > 0 ? c.f / c.s : null }));
  const fac = dias.reduce((s, d) => s + num(d.revenue), 0), inv = dias.reduce((s, d) => s + num(d.spend), 0), mer = inv > 0 ? fac / inv : null;
  const pf = num(GEN.prev?.revenue), pi = num(GEN.prev?.spend), pm = pi > 0 ? pf / pi : null;
  const dif = (a, b) => (b > 0 ? `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}% contra el período anterior` : "");
  const conInv = eco.filter((c) => c.mer != null);
  const g = conInv.filter((c) => c.mer >= 6), a = conInv.filter((c) => c.mer >= 3 && c.mer < 6), r = conInv.filter((c) => c.mer < 3);
  const seg = (l, col) => (l.length ? `<i style="flex:${l.length};background:${col}"></i>` : "");
  const li = (c, val) => `<li data-id="${esc(c.id)}" tabindex="0"><span>${esc(c.name)}</span><b>${val}</b></li>`;
  const top = [...eco].sort((x, y) => y.f - x.f).slice(0, 8);
  const bajos = [...conInv].sort((x, y) => x.mer - y.mer).slice(0, 8);
  const unDia = dias.length < 2;
  const tn = GEN.clientes.filter((c) => c.tn_stores.length);
  const conectados = tn.filter((c) => num(c.tiendas_vivo) >= c.tn_stores.length), faltan = tn.filter((c) => num(c.tiendas_vivo) < c.tn_stores.length);
  const link = GEN.app_id ? `https://www.tiendanube.com/apps/${encodeURIComponent(GEN.app_id)}/authorize` : null;
  const puntos = (f) => dias.map((d) => ({ day: d.day, v: f(d) }));
  return `<div class="cab"><div><h1>Cómo viene la agencia</h1><p class="sub">${rangoTxt(rango())} · sin clientes de leads</p></div>${fuentes()}</div>
    <div class="kpis">
      ${kpi("Facturación de clientes", money(fac), dif(fac, pf))}${kpi("Inversión gestionada", money(inv), dif(inv, pi))}
      ${kpi("MER global", merTxt(mer), pm ? `Período anterior: ${merTxt(pm)}` : "", merCls(mer))}${kpi("Clientes invirtiendo", nf0.format(conInv.length), `de ${eco.length} con tienda`)}
    </div>` +
    desplegable("afac", "Facturación por día", money(fac), unDia ? msg1() : grafico(puntos((d) => num(d.revenue)), "barras", "var(--serie)", corto, (p) => `${ddmm(p.day)} · ${money(p.v)}`)) +
    desplegable("amer", "Retorno por día (MER)", merTxt(mer), unDia ? msg1() : grafico(puntos((d) => (num(d.spend) > 0 ? num(d.revenue) / num(d.spend) : null)), "linea", "var(--serie2)", merTxt, (p) => `${ddmm(p.day)} · MER ${merTxt(p.v)}`)) +
    desplegable("ainv", "Inversión por día", money(inv), unDia ? msg1() : grafico(puntos((d) => num(d.spend)), "barras", "var(--serie)", corto, (p) => `${ddmm(p.day)} · ${money(p.v)}`)) +
    `<section class="bloque"><h2>Clientes por MER</h2>
      <div class="semaforo" role="img" aria-label="Distribución de clientes por MER">${seg(g, "var(--good)")}${seg(a, "var(--mid)")}${seg(r, "var(--bad)")}</div>
      <div class="semaforoley"><span><b class="g">${g.length}</b> con 6 o más</span><span><b class="m">${a.length}</b> entre 3 y 6</span><span><b class="r">${r.length}</b> con menos de 3</span></div></section>
    <div class="dos">
      <section class="bloque"><h2>Mayor facturación</h2><ul class="lista">${top.map((c) => li(c, money(c.f))).join("") || '<li>Sin datos</li>'}</ul></section>
      <section class="bloque"><h2>MER más bajo</h2><ul class="lista">${bajos.map((c) => li(c, `<span class="${merCls(c.mer)}">${merTxt(c.mer)}</span>`)).join("") || '<li>Sin datos</li>'}</ul></section>
    </div>
    <section class="bloque"><h2>Tiendas conectadas en vivo</h2><p class="sub" style="padding:0 16px">${conectados.length} de ${tn.length} clientes con Tiendanube.</p>
      <div class="prog"><i style="width:${tn.length ? (conectados.length / tn.length) * 100 : 0}%"></i></div>
      ${faltan.length ? `<div class="tablebox" style="max-height:320px;overflow-y:auto"><table><tbody>${faltan.sort((x, y) => x.name.localeCompare(y.name, "es")).map((c) => `<tr><td class="nom"><b>${esc(c.name)}</b></td><td>${link ? `<a class="btn" href="${link}" target="_blank" rel="noopener">Conectar</a>` : '<span class="na">Falta crear la app</span>'}</td></tr>`).join("")}</tbody></table></div>
      <div class="pie"><span>Antes de tocar Conectar, entrá al administrador de esa tienda en este navegador: se conecta la que tengas abierta.</span></div>` : ""}</section>`;
}

/* ---------- Pintar sin perder lo que el usuario está mirando ---------- */
function pintar() {
  const foco = document.activeElement?.id, pos = foco === "q" ? document.activeElement.selectionStart : null, y = window.scrollY;
  pintarControles();
  medirGraficos();
  $("vista").innerHTML = E.v === "agencia" ? vistaAgencia() : E.v === "cliente" ? vistaCliente() : vistaGeneral();
  document.title = (E.v === "cliente" && CLI ? CLI.cliente.name : E.v === "agencia" ? "Agencia" : "General") + " · Elevation";
  activarGraficos();
  if (foco === "q" && $("q")) { $("q").focus(); $("q").setSelectionRange(pos, pos); }
  window.scrollTo(0, y);
}

/* ---------- Eventos ---------- */
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { E.v = b.dataset.v; escribirUrl(); cargar(); }));
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
vista.addEventListener("change", (e) => { if (e.target.id === "soloActivos") { E.soloActivos = e.target.checked; pintar(); } });
vista.addEventListener("click", (e) => {
  const th = e.target.closest("th button");
  if (th) {
    const k = th.dataset.k;
    if (E.sortK === k) E.sortDir = -E.sortDir; else { E.sortK = k; E.sortDir = k === "name" ? 1 : -1; }
    return pintar();
  }
  if (e.target.id === "masOrdenes") { E.limite = Math.min(E.limite + 200, 500); return cargar({ silencio: true }); }
  const f = e.target.closest("tr.fila[data-id], .lista li[data-id]");
  if (f) irCliente(f.dataset.id);
});
vista.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.fila, .lista li")) { e.preventDefault(); irCliente(e.target.dataset.id); }
});
vista.addEventListener("toggle", (e) => { const id = e.target.dataset?.id; if (id) E.abiertos[id] = e.target.open; }, true);
document.addEventListener("visibilitychange", () => { if (!document.hidden && clave && incluyeHoy()) cargar({ silencio: true }); });
let finResize = null;
window.addEventListener("resize", () => { clearTimeout(finResize); finResize = setTimeout(() => { if (GEN) pintar(); }, 200); });
window.addEventListener("hashchange", () => { if (/[#&]k=/.test(location.hash)) location.reload(); });

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
  leerUrl(); escribirUrl();
  $("app").hidden = false;
  cargar();
  programar();
  setInterval(pulso, 1000);
}
