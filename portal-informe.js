"use strict";
// Análisis de resultados: documento blanco A4 apaisado, una hoja por tema.
// Criterio de Julián: más datos, menos conclusiones. Inversión de Meta + resultados reales de la tienda.
// Sin críticas al cliente ni a Meta y sin textos automáticos de diagnóstico: los comentarios los escribe el equipo.
// Va aislado en su función: los nombres de acá no pueden pisar los de portal.js.
(() => {

const TEMAS = [
  { id: "res", t: "Resultados generales", d: "Inversión, facturación, MER, CAC, ticket y ventas", on: true },
  { id: "emb", t: "Embudo de ventas", d: "De impresiones a compras, con tasas y costos", on: true, meta: true },
  { id: "his", t: "Histórico de inversión, facturación y retorno", d: "Mes a mes", on: true },
  { id: "dia", t: "Evolución diaria", d: "Facturación e inversión por día", on: false },
  { id: "cli", t: "Clientes nuevos vs. recurrentes", d: "Del período y de los últimos 12 meses", on: true, tienda: true },
  { id: "cre", t: "Creativos ganadores", d: "Los 5 anuncios con más compras, con su pieza", on: true, meta: true },
  { id: "cam", t: "Campañas", d: "Inversión, compras y ROAS por campaña", on: false, meta: true },
  { id: "top", t: "Top productos vendidos", d: "Los 15 más vendidos por unidades", on: true, tienda: true },
  { id: "pag", t: "Métodos de pago", d: "Ventas y facturación por método", on: true, tienda: true },
  { id: "cuo", t: "Cuotas", d: "Ventas y facturación por cantidad de cuotas", on: true, tienda: true },
  { id: "env", t: "Métodos de envío", d: "Ventas y facturación por envío", on: false, tienda: true },
  { id: "b2b", t: "Canal B2B", d: "Inversión y conversaciones de las campañas (B2B)", on: true, b2b: true },
];
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COL = ["#7C3AED", "#2F9E8F", "#E08A3C", "#D9578C", "#4C8FDB"], COL_OTROS = "#A8A3B5", COL_INV = "#BDB6CE";
const nf1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const tasa = (a, b) => (b > 0 ? nf1.format((a / b) * 100) + "%" : "—");
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Fechas ---------- */
const ultimoDia = (mes) => { const [y, m] = mes.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const mesAntes = (mes, n = 1) => { const [y, m] = mes.split("-").map(Number); return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7); };
const esMesEntero = (a, b) => a.slice(8) === "01" && b === ultimoDia(a.slice(0, 7));
const mesLargo = (mes) => `${MESES_L[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const conAnio = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const periodoTxt = (a, b) => (esMesEntero(a, b) ? mayus(mesLargo(a.slice(0, 7))) : a === b ? conAnio(a) : `${ddmm(a)} al ${conAnio(b)}`);
const unAnioMenos = (s) => { const y = Number(s.slice(0, 4)) - 1, mes = `${y}${s.slice(4, 7)}`, fin = ultimoDia(mes); return `${mes}${s.slice(7)}` > fin ? fin : `${mes}${s.slice(7)}`; };

// Mes entero contra el mes anterior entero; mes en curso contra los mismos días del mes anterior.
function rangoComparado(a, b, modo) {
  if (modo === "no") return null;
  if (modo === "anio") {
    const ca = unAnioMenos(a), cb = esMesEntero(a, b) ? ultimoDia(ca.slice(0, 7)) : unAnioMenos(b);
    return { a: ca, b: cb, etq: esMesEntero(a, b) ? mesLargo(ca.slice(0, 7)) : "el año anterior" };
  }
  if (a.slice(8) === "01" && a.slice(0, 7) === b.slice(0, 7)) {
    const mes = mesAntes(a.slice(0, 7)), fin = ultimoDia(mes), candidato = `${mes}${b.slice(7)}`;
    const cb = esMesEntero(a, b) || candidato > fin ? fin : candidato;
    return { a: `${mes}-01`, b: cb, etq: esMesEntero(a, b) ? MESES_L[Number(mes.slice(5)) - 1] : `los mismos días de ${MESES_L[Number(mes.slice(5)) - 1]}` };
  }
  const dias = Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5) + 1;
  return { a: sumar(a, -dias), b: sumar(a, -1), etq: "el período anterior" };
}

/* ---------- Formulario ---------- */
function abrirFormInforme() {
  const c = CLI.cliente, d = $("dlgInf");
  const conectada = (CLI.tiendas || []).some((t) => t.conectada), conMeta = (c.meta_accounts || []).length > 0;
  const motivo = (t) => (t.tienda && !conectada ? "Sin la app de Tiendanube" : t.meta && !conMeta ? "Sin cuenta de Meta" : c.kind === "leads" && (t.id === "emb" || t.id === "cre") ? "No aplica a clientes de leads" : "");
  const temas = TEMAS.filter((t) => !t.b2b || c.separa_b2b).map((t) => {
    const m = motivo(t);
    return `<div><label class="inf-tema${m ? " off" : ""}"><input type="checkbox" name="tema" value="${t.id}" ${t.on && !m ? "checked" : ""} ${m ? "disabled" : ""}><span><b>${esc(t.t)}</b><small>${esc(m || t.d)}</small></span></label>${t.id === "his" ? `<div class="inf-sub" id="infHisOp"><label><input type="radio" name="hisOp" value="6" checked> Últimos 6 meses</label><label><input type="radio" name="hisOp" value="anio"> Año actual</label></div>` : ""}</div>`;
  }).join("");
  const h = hoyBA();
  d.innerHTML = `<form method="dialog" id="infForm">
    <h2 id="dlgInfTit">Generar análisis de ${esc(c.name)}</h2>
    <p>Elegí el período y qué mostrar. Sale un documento con datos, listo para descargar en PDF y compartir con el cliente.</p>
    <div class="inf-fila">
      <label class="inf-campo">Período<select id="infPer"><option value="mesant" selected>Mes pasado</option><option value="mes">Este mes</option><option value="30d">Últimos 30 días</option><option value="rango">Elegir fechas</option></select></label>
      <label class="inf-campo" data-fechas hidden>Desde<input type="date" id="infDesde" max="${h}"></label>
      <label class="inf-campo" data-fechas hidden>Hasta<input type="date" id="infHasta" max="${h}"></label>
      <label class="inf-campo">Comparar contra<select id="infComp"><option value="ant" selected>Período anterior</option><option value="anio">Año anterior</option><option value="no">No comparar</option></select></label>
    </div>
    <fieldset class="inf-temas"><legend>Qué mostrar</legend>${temas}</fieldset>
    <label class="inf-campo">Comentarios del equipo (opcional)<textarea id="infNotas" rows="3" maxlength="1500" placeholder="Si escribís algo, sale en una hoja al final."></textarea></label>
    <p class="aviso err" id="infErr" hidden></p>
    <div class="dlg-acciones"><button type="button" class="btn" id="infNo">Cancelar</button><button type="button" class="btn pri" id="infSi">Generar análisis</button></div>
  </form>`;
  d.showModal();
}
$("dlgInf").addEventListener("change", (e) => {
  if (e.target.id === "infPer") document.querySelectorAll("[data-fechas]").forEach((x) => { x.hidden = e.target.value !== "rango"; });
  if (e.target.value === "his" && e.target.name === "tema") $("infHisOp").hidden = !e.target.checked;
});
$("dlgInf").addEventListener("click", (e) => {
  if (e.target.id === "infNo") return $("dlgInf").close();
  if (e.target.id === "infSi") generarInforme();
});
function rangoForm() {
  const h = hoyBA(), pm = h.slice(0, 8) + "01";
  switch ($("infPer").value) {
    case "mes": return [pm, h];
    case "30d": return [sumar(h, -29), h];
    case "rango": return [$("infDesde").value, $("infHasta").value];
    default: { const fin = sumar(pm, -1); return [fin.slice(0, 8) + "01", fin]; }
  }
}

/* ---------- Datos ---------- */
async function pedirMeta(client, a, b, comp) {
  const r = await fetch(`${CFG.supabaseUrl}/functions/v1/tn-app/analisis`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: clave, client, desde: a, hasta: b, comparaDesde: comp?.a, comparaHasta: comp?.b }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}
function totales(r) {
  const dias = r?.dias || [], s = (k) => dias.reduce((x, d) => x + num(d[k]), 0);
  const fac = s("revenue"), spend = s("spend"), b2b = s("spend_b2b"), tienda = Math.max(0, spend - b2b), ventas = s("orders"), nuevos = s("nuevos");
  return {
    fac, spend, b2b, tienda, ventas, nuevos, recurrentes: s("recurrentes"), mensajes: s("messages"), mensajesB2b: s("messages_b2b"), unidades: num(r?.unidades),
    mer: tienda > 0 ? fac / tienda : null, merTotal: spend > 0 ? fac / spend : null, ticket: ventas > 0 ? fac / ventas : null, cac: nuevos > 0 && tienda > 0 ? tienda / nuevos : null,
  };
}
async function generarInforme() {
  const [a, b] = rangoForm(), err = $("infErr");
  const temas = [...document.querySelectorAll('#infForm [name="tema"]:checked')].map((x) => x.value);
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!a || !b || a > b) return fail("Revisá las fechas: el inicio tiene que ser anterior al final.");
  if (b > hoyBA()) return fail("El período no puede terminar en el futuro.");
  if ((new Date(b) - new Date(a)) / 864e5 > 400) return fail("El período puede tener hasta 400 días.");
  if (!temas.length) return fail("Tildá al menos un tema.");
  const op = {
    client: E.c, a, b, temas, notas: $("infNotas").value.trim(),
    comp: rangoComparado(a, b, $("infComp").value), his: document.querySelector('[name="hisOp"]:checked')?.value || "6",
  };
  const boton = $("infSi"); boton.disabled = true; boton.textContent = "Generando…"; err.hidden = true;
  try {
    const finMes = b.slice(0, 7), iniMes = op.his === "anio" ? `${b.slice(0, 4)}-01` : mesAntes(finMes, 5);
    const conMeta = temas.some((t) => TEMAS.find((x) => x.id === t)?.meta);
    // De a una: juntas pueden pasar el límite de 3 s de la base.
    const metaPedido = conMeta ? pedirMeta(op.client, a, b, op.comp).catch((e) => { console.error("análisis Meta", e.message); return null; }) : null;
    const r = await rpc("portal_cliente", { p_client: op.client, p_since: a, p_until: b, p_limit: 1, p_offset: 0 });
    const rc = op.comp ? await rpc("portal_cliente", { p_client: op.client, p_since: op.comp.a, p_until: op.comp.b, p_limit: 1, p_offset: 0 }) : null;
    const rh = temas.includes("his") ? await rpc("portal_historico", { p_client: op.client, p_since: `${iniMes}-01`, p_until: b }) : null;
    const meta = await metaPedido;
    $("dlgInf").close();
    mostrarInforme(op, { r, rc, rh, meta, conMeta, iniMes, finMes });
  } catch (e) {
    boton.disabled = false; boton.textContent = "Generar análisis";
    fail(e.clave ? "La clave de acceso no es válida." : "No se pudo generar. Probá de nuevo en un momento.");
  }
}

/* ---------- Piezas del documento ---------- */
// Sube bien en verde, sube mal en rojo; la inversión no es buena ni mala por sí sola.
function variacion(a, b, polaridad, etq) {
  if (a == null || !(b > 0) || !isFinite(a)) return "";
  const redondo = Math.round(((a - b) / b) * 100), contra = etq ? ` vs ${esc(etq)}` : "";
  if (redondo === 0) return `<small class="i-var neu">Igual${etq ? ` que ${esc(etq)}` : ""}</small>`;
  const cls = !polaridad ? "neu" : redondo > 0 === polaridad > 0 ? "sube" : "baja";
  return `<small class="i-var ${cls}">${redondo > 0 ? "▲" : "▼"} ${Math.abs(redondo)}%${contra}</small>`;
}
const tarjeta = (t, v, extra = "", chica = false) => `<div class="i-card${chica ? " chica" : ""}"><span>${esc(t)}</span><b>${esc(v)}</b>${extra}</div>`;
const leyenda = (series) => `<div class="i-ley">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join("")}</div>`;

// Columnas agrupadas en una sola escala. Con muchos días no se rotula cada barra, para que se lea.
function columnas(etiquetas, series, { alto = 260, rotulos = etiquetas.length <= 35 } = {}) {
  const W = 1040, H = alto, sup = 26, inf = 26, izq = 8, n = etiquetas.length, plot = H - sup - inf;
  const max = Math.max(...series.flatMap((s) => s.valores), 1), grupo = (W - izq) / Math.max(n, 1);
  const anchoB = Math.min(38, Math.max(4, (grupo * 0.74) / series.length - 2));
  const barra = (x, y, w, h, c) => { const r = Math.min(4, w / 2, h); return `<path d="M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z" fill="${c}"/>`; };
  let g = `<line x1="${izq}" x2="${W}" y1="${H - inf}" y2="${H - inf}" stroke="#D8D4E2"/>`;
  etiquetas.forEach((et, i) => {
    const total = series.length * anchoB + (series.length - 1) * 2, x0 = izq + i * grupo + (grupo - total) / 2;
    series.forEach((s, j) => {
      const v = s.valores[i] || 0, h = Math.max(v > 0 ? 2 : 0, (v / max) * plot), x = x0 + j * (anchoB + 2), y = H - inf - h;
      if (h) g += barra(x, y, anchoB, h, s.color);
      if (rotulos && v > 0) g += `<text x="${x + anchoB / 2}" y="${y - 6}" text-anchor="middle" font-size="${n > 16 || (series.length > 1 && n > 8) ? 10 : 12}" fill="#3B3650">${esc(corto(v).replace("$ ", ""))}</text>`;
    });
    if (n <= 16 || i % Math.ceil(n / 16) === 0) g += `<text x="${izq + i * grupo + grupo / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#6B6780">${esc(et)}</text>`;
  });
  return `<svg class="i-graf" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function apiladas(etiquetas, abajo, arriba) {
  const W = 1040, H = 340, sup = 24, inf = 26, n = etiquetas.length, plot = H - sup - inf, grupo = W / Math.max(n, 1), ancho = Math.min(44, grupo * 0.66);
  const max = Math.max(...etiquetas.map((_, i) => abajo.valores[i] + arriba.valores[i]), 1);
  let g = `<line x1="0" x2="${W}" y1="${H - inf}" y2="${H - inf}" stroke="#D8D4E2"/>`;
  etiquetas.forEach((et, i) => {
    const x = i * grupo + (grupo - ancho) / 2, a = abajo.valores[i] || 0, b = arriba.valores[i] || 0, ha = (a / max) * plot, hb = (b / max) * plot, ya = H - inf - ha, yb = ya - hb - (hb ? 2 : 0);
    // El dato va adentro del tramo; si el tramo es muy bajo, al costado.
    const dato = (v, y, h, color) => (!v ? "" : h >= 15
      ? `<text x="${x + ancho / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${color}">${nf0.format(v)}</text>`
      : `<text x="${x + ancho + 4}" y="${y + h / 2 + 4}" font-size="10.5" fill="#3B3650">${nf0.format(v)}</text>`);
    if (ha) g += `<rect x="${x}" y="${ya}" width="${ancho}" height="${ha}" fill="${abajo.color}"/>`;
    if (hb) g += `<rect x="${x}" y="${yb}" width="${ancho}" height="${hb}" rx="3" fill="${arriba.color}"/>`;
    g += dato(a, ya, ha, abajo.tinta) + dato(b, yb, hb, arriba.tinta);
    if (a + b) g += `<text x="${x + ancho / 2}" y="${yb - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="#221E33">${nf0.format(a + b)}</text>`;
    g += `<text x="${x + ancho / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#6B6780">${esc(et)}</text>`;
  });
  return `<svg class="i-graf" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function torta(filas) {
  const total = filas.reduce((s, f) => s + f.total, 0) || 1, R = 68, C = 2 * Math.PI * R;
  let ang = 0, arcos = "", textos = "", previo = null;
  filas.forEach((f) => {
    const l = (f.total / total) * C, parte = f.total / total, medio = ((ang + l / 2) / C) * 2 * Math.PI;
    arcos += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${f.color}" stroke-width="42" stroke-dasharray="${Math.max(0, l - 2)} ${C - Math.max(0, l - 2)}" stroke-dashoffset="${-ang}" transform="rotate(-90 100 100)"/>`;
    ang += l;
    if (parte < 0.005) return;
    const etq = nf1.format(parte * 100) + "%";
    const pos = (r) => [100 + r * Math.sin(medio), 100 - r * Math.cos(medio)];
    if (parte >= 0.07) {
      const [x, y] = pos(R), tinta = f.color === COL[2] || f.otros ? "#221E33" : "#fff";
      textos += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${tinta}">${etq}</text>`;
    } else {
      // Porción chica: el dato afuera, y si choca con el anterior, un poco más lejos.
      let r = 103, [x, y] = pos(r);
      while (previo && Math.hypot(x - previo[0], y - previo[1]) < 13 && r < 130) { r += 7; [x, y] = pos(r); }
      previo = [x, y];
      textos += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#3B3650">${etq}</text>`;
    }
  });
  return `<svg class="i-torta" viewBox="-24 -24 248 248" role="img">${arcos}${textos}</svg>`;
}
function corte(lista, nombre, cab) {
  const ord = [...lista].map((x) => ({ nombre: nombre(x.k), ventas: num(x.ventas), total: num(x.total) })).sort((a, b) => b.total - a.total);
  // "Otros" va siempre al final y una sola vez, aunque la tienda tenga un método con ese nombre.
  const sinOtros = ord.filter((x) => x.nombre !== "Otros"), top = sinOtros.slice(0, 5);
  const resto = [...sinOtros.slice(5), ...ord.filter((x) => x.nombre === "Otros")];
  if (resto.length) top.push({ nombre: "Otros", ventas: resto.reduce((s, x) => s + x.ventas, 0), total: resto.reduce((s, x) => s + x.total, 0), otros: true });
  const filas = top.map((f, i) => ({ ...f, color: f.otros ? COL_OTROS : COL[i] }));
  const total = filas.reduce((s, f) => s + f.total, 0), tv = filas.reduce((s, f) => s + f.ventas, 0);
  return `<div class="i-corte">${torta(filas)}<table class="i-tab"><thead><tr><th>${esc(cab)}</th><th>Ventas</th><th>% ventas</th><th>Facturación</th><th>% facturación</th></tr></thead><tbody>
    ${filas.map((f) => `<tr><td><i class="i-chip" style="background:${f.color}"></i>${esc(f.nombre)}</td><td>${nf0.format(f.ventas)}</td><td>${tasa(f.ventas, tv)}</td><td>${money(f.total)}</td><td>${tasa(f.total, total)}</td></tr>`).join("")}
    <tr class="i-tot"><td>Total</td><td>${nf0.format(tv)}</td><td></td><td>${money(total)}</td><td></td></tr></tbody></table></div>`;
}

// Dibujo propio para los anuncios de catálogo: Meta no le da las fotos de los productos al portal.
const ILUSTRACION_CATALOGO = (() => {
  const v = "#7C3AED", c = "#C9B8F5", r = "#D9578C", o = "#3B3650";
  const dibujos = [
    `<path d="M28 20 40 14Q50 22 60 14L72 20 84 36 72 44 68 38V78H32V38L28 44 16 36Z" fill="${v}"/>`,
    `<path d="M32 12H68L74 84H56L50 40 44 84H26Z" fill="${o}"/><path d="M32 20H68" stroke="${c}" stroke-width="2"/>`,
    `<path d="M40 12 44 26H56L60 12 64 14 60 34 76 84H24L40 34 36 14Z" fill="${r}"/>`,
    `<path d="M42 46V26L58 16V46Z" fill="${r}"/><rect x="38" y="46" width="24" height="10" fill="${c}"/><rect x="36" y="56" width="28" height="28" rx="2" fill="${o}"/>`,
    `<rect x="44" y="12" width="12" height="12" rx="2" fill="${o}"/><rect x="46" y="24" width="8" height="6" fill="${c}"/><rect x="30" y="30" width="40" height="54" rx="6" fill="${v}"/><rect x="40" y="50" width="20" height="14" rx="2" fill="#fff"/>`,
    `<rect x="26" y="34" width="48" height="14" rx="3" fill="${r}"/><rect x="30" y="48" width="40" height="32" rx="4" fill="${c}"/><rect x="40" y="58" width="20" height="10" rx="2" fill="#fff"/>`,
  ];
  const celdas = dibujos.map((d, i) => {
    const x = 8 + (i % 2) * 96, y = 12 + Math.floor(i / 2) * 104;
    return `<g transform="translate(${x} ${y})"><rect width="88" height="96" rx="8" fill="#fff" stroke="#E8E5EF"/><g transform="translate(-6 -2)">${d}</g></g>`;
  }).join("");
  return `<svg class="i-cat" viewBox="0 0 200 362" role="img" aria-label="Anuncio de catálogo">${celdas}<text x="100" y="344" text-anchor="middle" font-size="13" font-weight="600" fill="#6B6780">Anuncio de catálogo</text></svg>`;
})();

/* ---------- Hojas ---------- */
const F_TIENDA = "Tiendanube, órdenes pagadas por fecha de creación.";
const F_MIX = "Tiendanube (órdenes pagadas) y Meta Ads (inversión).";
const F_META = "Meta Ads, eventos y compras atribuidas por el píxel.";

function hojaResultados(ctx) {
  const { t, c, etq, conectada, b2b } = ctx, v = (a, b, p) => (ctx.op.comp ? variacion(a, b, p, etq) : "");
  if (!conectada && !t.fac) {
    return { titulo: "Resultados generales", fuente: "Meta Ads.", cuerpo: `<div class="i-cards c3">
      ${tarjeta("Inversión", money(t.spend), v(t.spend, c?.spend, 0))}${tarjeta("Conversaciones", nf0.format(t.mensajes), v(t.mensajes, c?.mensajes, 1))}${tarjeta("Costo por conversación", t.mensajes ? money(t.spend / t.mensajes) : "—", v(t.mensajes ? t.spend / t.mensajes : null, c?.mensajes ? c.spend / c.mensajes : 0, -1))}</div>` };
  }
  const principales = [
    tarjeta("Facturación", money(t.fac), v(t.fac, c?.fac, 1)),
    tarjeta("Inversión", money(t.spend), v(t.spend, c?.spend, 0)),
    tarjeta(b2b ? "MER tienda" : "MER", merTxt(t.mer), v(t.mer, c?.mer, 1)),
  ];
  if (!conectada) return { titulo: "Resultados generales", fuente: F_MIX, cuerpo: `<div class="i-cards c3">${principales.join("")}</div>` };
  const secundarias = [
    tarjeta("Ventas", nf0.format(t.ventas), v(t.ventas, c?.ventas, 1)),
    tarjeta("Ticket promedio", t.ticket ? money(t.ticket) : "—", v(t.ticket, c?.ticket, 1)),
    tarjeta("CAC", t.cac ? money(t.cac) : "—", v(t.cac, c?.cac, -1)),
  ];
  const chicas = [
    tarjeta("Clientes nuevos", nf0.format(t.nuevos), v(t.nuevos, c?.nuevos, 1), true),
    tarjeta("Productos vendidos", nf0.format(t.unidades), v(t.unidades, c?.unidades, 1), true),
    tarjeta("Productos por venta", t.ventas ? nf1.format(t.unidades / t.ventas) : "—", v(t.ventas ? t.unidades / t.ventas : null, c?.ventas ? c.unidades / c.ventas : 0, 1), true),
  ];
  if (b2b) chicas.push(tarjeta("MER total", merTxt(t.merTotal), v(t.merTotal, c?.merTotal, 1), true));
  const dias = completar(ctx.r.dias || [], ctx.op.a, ctx.op.b);
  const diaria = dias.length > 1 && dias.length <= 62 ? `<h3 class="i-h3">Facturación por día</h3>${columnas(dias.map((x) => ddmm(x.day)), [{ nombre: "Facturación", color: COL[0], valores: dias.map((x) => num(x.revenue)) }], { alto: 170 })}` : "";
  return { titulo: "Resultados generales", fuente: F_MIX + (b2b ? " MER tienda: facturación sobre la inversión sin las campañas (B2B)." : ""), cuerpo: `<div class="i-cards c3">${principales.join("")}${secundarias.join("")}</div><div class="i-cards c${chicas.length} i-gap">${chicas.join("")}</div>${diaria}` };
}
function hojaEmbudo(ctx) {
  const p = ctx.meta?.periodo, q = ctx.meta?.compara;
  if (!p || !p.impresiones) return null;
  // Las cuatro primeras etapas son de Meta. La última son las ventas reales de la tienda.
  const { t, c: comp, conectada } = ctx;
  const et = [["Impresiones", "impresiones"], ["Visitas web", "visitas"], ["Agregados al carrito", "carritos"], ["Pagos iniciados", "pagos"]];
  if (conectada) et.push(["Ventas", "ventas"]);
  const ancho = [100, 84, 68, 52, 38];
  // Meta solo ve parte de los pagos y la tienda vende por todos lados: más de 100% no es una tasa real.
  const paso = (a, b) => (b > 0 && a <= b ? tasa(a, b) : "—");
  const pV = { ...p, ventas: t.ventas, spendVenta: t.tienda };
  const qV = q ? { ...q, ventas: comp?.ventas || 0, spendVenta: comp?.tienda || 0 } : null;
  const bloques = et.map(([n, k], i) => `${i ? `<div class="i-paso">${paso(pV[k], pV[et[i - 1][1]])}</div>` : ""}<div class="i-etapa" style="width:${ancho[i]}%;background:rgba(124,58,237,${(0.18 + i * 0.19).toFixed(2)});color:${i >= 3 ? "#fff" : "#2A2540"}"><span>${n}</span><b>${nf0.format(pV[k])}</b></div>`).join("");
  const costo = (x, k) => (x && x[k] > 0 ? x.spend / x[k] : null);
  const costoVenta = (x) => (x && x.ventas > 0 && x.spendVenta > 0 ? x.spendVenta / x.ventas : null);
  const filaRow = (n, a, b, fmt, pol) => `<tr><td>${n}</td><td>${a == null ? "—" : fmt(a)}</td>${q ? `<td>${b == null ? "—" : fmt(b)}</td><td>${variacion(a, b, pol, "")}</td>` : ""}</tr>`;
  const pctTxt = (v) => nf1.format(v * 100) + "%";
  const r = (x, n, d) => (x && x[d] > 0 ? x[n] / x[d] : null);
  const filas = [
    filaRow("CTR", r(p, "clics", "impresiones"), r(q, "clics", "impresiones"), pctTxt, 1),
    filaRow("CPM", p.impresiones ? (p.spend / p.impresiones) * 1000 : null, q?.impresiones ? (q.spend / q.impresiones) * 1000 : null, money, -1),
    filaRow("Costo por clic", costo(p, "clics"), costo(q, "clics"), money, -1),
    filaRow("Costo por visita", costo(p, "visitas"), costo(q, "visitas"), money, -1),
    filaRow("Costo por carrito", costo(p, "carritos"), costo(q, "carritos"), money, -1),
    filaRow("Costo por pago iniciado", costo(p, "pagos"), costo(q, "pagos"), money, -1),
    conectada ? filaRow("Costo por venta", costoVenta(pV), costoVenta(qV), money, -1) : "",
    filaRow("Visita a carrito", r(p, "carritos", "visitas"), r(q, "carritos", "visitas"), pctTxt, 1),
    filaRow("Carrito a pago", r(p, "pagos", "carritos"), r(q, "pagos", "carritos"), pctTxt, 1),
  ].join("");
  return { titulo: "Embudo de ventas", fuente: `Impresiones, visitas, carritos y pagos: Meta Ads.${conectada ? " Ventas: Tiendanube, órdenes pagadas." : ""}`, cuerpo: `<div class="i-dos"><div class="i-embudo">${bloques}</div>
    <table class="i-tab i-der"><thead><tr><th>Indicador</th><th>${esc(ctx.tituloPer)}</th>${q ? `<th>${esc(mayus(ctx.etq))}</th><th>Var.</th>` : ""}</tr></thead><tbody>${filas}</tbody></table></div>` };
}
function hojaHistorico(ctx) {
  const { rh, iniMes, finMes, b2b, op } = ctx;
  if (!rh) return null;
  const meses = [];
  for (let m = iniMes; m <= finMes; m = mesAntes(m, -1)) meses.push({ m, spend: 0, b2b: 0, fac: 0, ventas: 0, mensajes: 0 });
  (rh.dias || []).forEach((d) => { const x = meses.find((y) => y.m === d.day.slice(0, 7)); if (x) { x.spend += num(d.spend); x.b2b += num(d.spend_b2b); x.fac += num(d.revenue); x.ventas += num(d.orders); x.mensajes += num(d.messages); } });
  const conVentas = meses.some((x) => x.ventas > 0), parcial = op.b !== ultimoDia(finMes);
  const nombre = (x) => mesTxt(x.m) + (parcial && x.m === finMes ? "*" : "");
  if (!meses.some((x) => x.fac > 0)) {
    return { titulo: "Histórico de inversión y conversaciones", fuente: "Meta Ads." + (parcial ? ` * ${mayus(mesLargo(finMes))} hasta el ${ddmm(op.b)}.` : ""), cuerpo: `${columnas(meses.map((x) => mayus(nombre(x))), [{ nombre: "Inversión", color: COL[0], valores: meses.map((x) => x.spend) }], { alto: meses.length > 8 ? 210 : 310 })}
      <table class="i-tab i-compacta"><thead><tr><th>Mes</th><th>Inversión</th><th>Conversaciones</th><th>Costo por conversación</th></tr></thead><tbody>${meses.map((x) => `<tr><td>${esc(mayus(nombre(x)))}</td><td>${money(x.spend)}</td><td>${nf0.format(x.mensajes)}</td><td>${x.mensajes ? money(x.spend / x.mensajes) : "—"}</td></tr>`).join("")}</tbody></table>` };
  }
  const merDe = (x) => { const inv = x.spend - x.b2b; return inv > 0 ? x.fac / inv : null; };
  const filas = meses.map((x) => `<tr><td>${esc(mayus(nombre(x)))}</td><td>${money(x.spend)}</td><td>${money(x.fac)}</td><td><b>${merTxt(merDe(x))}</b></td>${conVentas ? `<td>${nf0.format(x.ventas)}</td><td>${x.ventas ? money(x.fac / x.ventas) : "—"}</td>` : ""}</tr>`).join("");
  const series = [{ nombre: "Facturación", color: COL[0], valores: meses.map((x) => x.fac) }, { nombre: "Inversión", color: COL_INV, valores: meses.map((x) => x.spend) }];
  const altoGraf = meses.length > 8 ? 210 : 310;
  return { titulo: "Histórico de inversión, facturación y retorno", fuente: F_MIX + (parcial ? ` * ${mayus(mesLargo(finMes))} hasta el ${ddmm(op.b)}.` : ""), cuerpo: `${leyenda(series)}${columnas(meses.map((x) => mayus(nombre(x))), series, { alto: altoGraf, rotulos: meses.length <= 12 })}
    <table class="i-tab i-compacta"><thead><tr><th>Mes</th><th>Inversión</th><th>Facturación</th><th>${b2b ? "MER tienda" : "MER"}</th>${conVentas ? "<th>Ventas</th><th>Ticket</th>" : ""}</tr></thead><tbody>${filas}</tbody></table>` };
}
function hojaDiaria(ctx) {
  const d = completar(ctx.r.dias || [], ctx.op.a, ctx.op.b);
  if (d.length > 62) return null;
  const et = d.map((x) => ddmm(x.day));
  if (!d.some((x) => num(x.revenue) > 0)) {
    return { titulo: "Evolución diaria", fuente: "Meta Ads.", cuerpo: `<h3 class="i-h3">Inversión por día</h3>${columnas(et, [{ nombre: "Inversión", color: COL[0], valores: d.map((x) => num(x.spend)) }], { alto: 240 })}
      <h3 class="i-h3">Conversaciones por día</h3>${columnas(et.map((x) => x), [{ nombre: "Conversaciones", color: COL_INV, valores: d.map((x) => num(x.messages)) }], { alto: 240 })}` };
  }
  return { titulo: "Evolución diaria", fuente: F_MIX, cuerpo: `<h3 class="i-h3">Facturación por día</h3>${columnas(et, [{ nombre: "Facturación", color: COL[0], valores: d.map((x) => num(x.revenue)) }], { alto: 240 })}
    <h3 class="i-h3">Inversión por día</h3>${columnas(et, [{ nombre: "Inversión", color: COL_INV, valores: d.map((x) => num(x.spend)) }], { alto: 240 })}` };
}
function hojaClientes(ctx) {
  const { t, c, etq, r, op } = ctx, tipos = r.tipos || [], de = (k) => tipos.find((x) => x.k === k) || { ventas: 0, total: 0 };
  const n = de("Nuevo"), rec = de("Recurrente"), tv = num(n.ventas) + num(rec.ventas), tf = num(n.total) + num(rec.total);
  if (!tv) return null;
  const v = (a, b) => (op.comp ? variacion(a, b, 1, etq) : "");
  const meses = (r.meses || []).filter((m) => m.mes <= op.b.slice(0, 7));
  const s1 = { nombre: "Nuevos", color: COL[0], tinta: "#fff", valores: meses.map((m) => num(m.nuevos)) }, s2 = { nombre: "Recurrentes", color: "#C9B8F5", tinta: "#2A2540", valores: meses.map((m) => num(m.recurrentes)) };
  const ultimo = meses.at(-1)?.mes, parcial = ultimo === hoyBA().slice(0, 7);
  return { titulo: "Clientes nuevos vs. recurrentes", fuente: F_TIENDA + (parcial ? " * Mes en curso." : ""), cuerpo: `<div class="i-cards c4">
    ${tarjeta("Ventas a clientes nuevos", nf0.format(num(n.ventas)), v(t.nuevos, c?.nuevos))}
    ${tarjeta("Ventas a recurrentes", nf0.format(num(rec.ventas)), v(t.recurrentes, c?.recurrentes))}
    ${tarjeta("Facturación de nuevos", money(num(n.total)), `<small class="i-var neu">${tasa(num(n.total), tf)} de la facturación</small>`)}
    ${tarjeta("Facturación de recurrentes", money(num(rec.total)), `<small class="i-var neu">${tasa(num(rec.total), tf)} de la facturación</small>`)}</div>
    <h3 class="i-h3">Últimos 12 meses</h3>${leyenda([s1, s2])}${apiladas(meses.map((m) => mesTxt(m.mes) + (parcial && m.mes === ultimo ? "*" : "")), s2, s1)}` };
}
function hojaCreativos(ctx) {
  const lista = (ctx.meta?.anuncios || []).filter((x) => !/\(\s*b2b\s*\)/i.test(x.campana || "") && x.compras > 0);
  if (!lista.length) return null;
  // Con menos de 3 compras la muestra es chica: esos entran solo si no alcanza con el resto.
  const firmes = lista.filter((x) => x.compras >= 3), top = (firmes.length >= 3 ? firmes : lista).slice(0, 5);
  const fichas = top.map((x, i) => { const imgs = x.imagenes || []; return `<article class="i-pieza"><div class="i-img" data-imgs="${esc(JSON.stringify(imgs))}" data-i="0">${imgs.length ? `<img src="${esc(imgs[0])}" alt="" referrerpolicy="no-referrer">` : x.vista ? ILUSTRACION_CATALOGO : "<span>Sin vista previa</span>"}<em>${i + 1}</em>${imgs.length > 1 ? `<div class="inf-toma"><button type="button" data-toma="-1" aria-label="Toma anterior">‹</button><span>1/${imgs.length}</span><button type="button" data-toma="1" aria-label="Toma siguiente">›</button></div>` : ""}</div>
    <h4>${esc(x.nombre)}</h4><dl><div><dt>Compras</dt><dd>${nf0.format(x.compras)}</dd></div><div><dt>ROAS</dt><dd>${x.spend > 0 ? merTxt(x.valor / x.spend) : "—"}</dd></div><div><dt>Inversión</dt><dd>${money(x.spend)}</dd></div><div><dt>Facturación</dt><dd>${money(x.valor)}</dd></div><div><dt>Costo x compra</dt><dd>${money(x.spend / x.compras)}</dd></div><div><dt>CTR</dt><dd>${tasa(x.clics, x.impresiones)}</dd></div></dl></article>`; }).join("");
  return { titulo: "Creativos ganadores", fuente: F_META, cuerpo: `<div class="i-piezas n${top.length}">${fichas}</div>` };
}
function hojaCampanas(ctx) {
  const lista = [...(ctx.meta?.campanas || [])].filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
  if (!lista.length) return null;
  const total = lista.reduce((s, x) => s + x.spend, 0), top = lista.slice(0, 13);
  const extra = lista.length > top.length ? ` Las ${top.length} con más inversión de ${lista.length}.` : "";
  return { titulo: "Campañas", fuente: F_META + extra, cuerpo: `<table class="i-tab"><thead><tr><th>Campaña</th><th>Inversión</th><th>% inv.</th><th>Compras</th><th>Costo x compra</th><th>Facturación</th><th>ROAS</th></tr></thead><tbody>
    ${top.map((x) => `<tr><td class="i-nom">${esc(x.nombre)}</td><td>${money(x.spend)}</td><td>${tasa(x.spend, total)}</td><td>${nf0.format(x.compras)}</td><td>${x.compras ? money(x.spend / x.compras) : "—"}</td><td>${money(x.valor)}</td><td>${merTxt(x.valor / x.spend)}</td></tr>`).join("")}</tbody></table>` };
}
function hojaTop(ctx) {
  const p = ctx.r.productos || [];
  if (!p.length) return null;
  const totalU = ctx.t.unidades || p.reduce((s, x) => s + num(x.unidades), 0);
  const maxU = Math.max(...p.map((x) => num(x.unidades)), 1);
  return { titulo: "Top productos vendidos", fuente: `${F_TIENDA} Importes a precio de lista, antes de descuentos.`, cuerpo: `<table class="i-tab i-compacta"><thead><tr><th>#</th><th class="i-nom">Producto</th><th>Unidades</th><th class="i-barcol"></th><th>% unidades</th><th>Importe</th></tr></thead><tbody>
    ${p.slice(0, 15).map((x, i) => `<tr><td>${i + 1}</td><td class="i-nom">${esc(x.nombre)}</td><td>${nf0.format(num(x.unidades))}</td><td class="i-barcol"><i style="width:${(num(x.unidades) / maxU) * 100}%"></i></td><td>${tasa(num(x.unidades), totalU)}</td><td>${money(num(x.total))}</td></tr>`).join("")}</tbody></table>` };
}
function hojaB2b(ctx) {
  const camp = (ctx.r.campanas || []).filter((x) => x.b2b);
  const { t, c, etq } = ctx, v = (a, b, p) => (ctx.op.comp ? variacion(a, b, p, etq) : "");
  return { titulo: "Canal B2B", fuente: "Meta Ads. Campañas con (B2B) en el nombre. No cuentan para el MER tienda.", cuerpo: `<div class="i-cards c4">
    ${tarjeta("Inversión B2B", money(t.b2b), v(t.b2b, c?.b2b, 0))}${tarjeta("% de la inversión", tasa(t.b2b, t.spend))}${tarjeta("Conversaciones", nf0.format(t.mensajesB2b), v(t.mensajesB2b, c?.mensajesB2b, 1))}${tarjeta("Costo por conversación", t.mensajesB2b ? money(t.b2b / t.mensajesB2b) : "—", v(t.mensajesB2b ? t.b2b / t.mensajesB2b : null, c?.mensajesB2b ? c.b2b / c.mensajesB2b : 0, -1))}</div>
    ${camp.length ? `<table class="i-tab i-compacta i-gap"><thead><tr><th>Campaña</th><th>Inversión</th><th>Conversaciones</th><th>Costo</th></tr></thead><tbody>${camp.slice(0, 10).map((x) => `<tr><td class="i-nom">${esc(x.nombre)}</td><td>${money(num(x.spend))}</td><td>${nf0.format(num(x.messages))}</td><td>${num(x.messages) ? money(num(x.spend) / num(x.messages)) : "—"}</td></tr>`).join("")}</tbody></table>` : ""}` };
}
function hojaCorte(ctx, lista, titulo, cab, nombre) {
  if (!(lista || []).length) return null;
  return { titulo, fuente: F_TIENDA, cuerpo: corte(lista, nombre, cab) };
}

/* ---------- Google Slides ---------- */
// Dirección del script de Google (docs/slides/Codigo.gs), en config.js. Sin ella, el botón no aparece.
const SLIDES_URL = CFG.slidesUrl || "";
const aHex = (css) => {
  const m = String(css).match(/[\d.]+/g);
  if (!m) return null;
  const a = m.length > 3 ? Number(m[3]) : 1;
  if (a === 0) return null;
  // Con transparencia, se mezcla contra el blanco de la hoja.
  return "#" + [0, 1, 2].map((i) => Math.round(Number(m[i]) * a + 255 * (1 - a)).toString(16).padStart(2, "0")).join("");
};
async function svgAPng(svg, w, h) {
  const c = svg.cloneNode(true);
  c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  c.setAttribute("width", w); c.setAttribute("height", h);
  c.setAttribute("font-family", "Arial, sans-serif");
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(c));
  await img.decode();
  const lienzo = document.createElement("canvas");
  lienzo.width = w * 2; lienzo.height = h * 2;
  lienzo.getContext("2d").drawImage(img, 0, 0, w * 2, h * 2);
  return lienzo.toDataURL("image/png");
}
// Traduce una hoja ya dibujada a posiciones en puntos: lo que se ve es lo que sale en Slides.
async function hojaASlide(hoja) {
  const base = hoja.getBoundingClientRect(), k = 720 / base.width, items = [];
  const R = (r) => ({ x: (r.left - base.left) * k, y: (r.top - base.top) * k, w: r.width * k, h: r.height * k });
  const tipografia = (cs) => ({ size: Math.round(parseFloat(cs.fontSize) * k * 10) / 10, bold: parseInt(cs.fontWeight, 10) >= 600, color: aHex(cs.color) || "#221E33", align: cs.textAlign });
  const visitar = async (el) => {
    const cs = getComputedStyle(el);
    if (el.classList.contains("inf-toma") || cs.display === "none") return;
    const caja = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") { items.push({ t: "img", ...R(caja), src: await svgAPng(el, Math.round(caja.width), Math.round(caja.height)) }); return; }
    if (tag === "img") {
      if (!el.naturalWidth) return;
      // Misma cuenta que object-fit: contain, para que la pieza no se deforme.
      const esc = Math.min(caja.width / el.naturalWidth, caja.height / el.naturalHeight), w = el.naturalWidth * esc, h = el.naturalHeight * esc;
      const pos = { left: caja.left + (caja.width - w) / 2, top: caja.top + (caja.height - h) / 2, width: w, height: h };
      let src = el.src;
      if (new URL(src, location.href).origin === location.origin) {
        const l = document.createElement("canvas"); l.width = el.naturalWidth; l.height = el.naturalHeight;
        const g = l.getContext("2d"); g.filter = cs.filter === "none" ? "none" : cs.filter; g.drawImage(el, 0, 0);
        src = l.toDataURL("image/png");
      }
      items.push({ t: "img", ...R(pos), src });
      return;
    }
    // Las tablas salen como textos y líneas: una tabla real de Slides impone una altura mínima por fila y se pasa de la hoja.
    const celda = tag === "td" || tag === "th";
    const fondo = aHex(cs.backgroundColor), bordes = ["Top", "Right", "Bottom", "Left"].map((s) => parseFloat(cs[`border${s}Width`]) > 0);
    const conPieza = el.classList.contains("i-img") && el.querySelector("img, svg");
    if (el !== hoja && !conPieza) {
      const rad = parseFloat(cs.borderTopLeftRadius) || 0, total = bordes.every(Boolean);
      if (fondo || total) items.push({ t: "forma", ...R(caja), fill: fondo, line: total ? aHex(cs.borderTopColor) : null, tipo: rad >= Math.min(caja.width, caja.height) / 2 ? "ELLIPSE" : rad > 0 ? "ROUND_RECTANGLE" : "RECTANGLE" });
      // En una tabla, una sola línea por fila en lugar de una por celda.
      if (celda) {
        if (bordes[2] && el === el.parentElement.cells[0]) { const f = R(el.parentElement.getBoundingClientRect()); items.push({ t: "linea", x: f.x, y: f.y + f.h, w: f.w, h: 0.75, color: aHex(cs.borderBottomColor) }); }
      } else if (!total) {
        const b = R(caja);
        if (bordes[0]) items.push({ t: "linea", x: b.x, y: b.y, w: b.w, h: 0.75, color: aHex(cs.borderTopColor) });
        if (bordes[2]) items.push({ t: "linea", x: b.x, y: b.y + b.h, w: b.w, h: 0.75, color: aHex(cs.borderBottomColor) });
      }
    }
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
        const r = document.createRange(); r.selectNodeContents(n);
        items.push({ t: "texto", ...R(r.getBoundingClientRect()), txt: n.textContent.trim(), ...tipografia(cs) });
      } else if (n.nodeType === Node.ELEMENT_NODE) await visitar(n);
    }
  };
  await visitar(hoja);
  return { items };
}
async function abrirEnSlides(boton) {
  // La pestaña se abre ya: si se abre después de esperar, el navegador la bloquea.
  const pestana = window.open("", "_blank");
  if (pestana) pestana.document.write("<title>Armando…</title><p style='font:16px sans-serif;padding:24px'>Armando la presentación. Tarda menos de un minuto.</p>");
  boton.disabled = true; const antes = boton.textContent; boton.textContent = "Armando…";
  try {
    const hojas = [];
    // Google arma siempre en 16:9, sin importar el tamaño que se le pida: cada hoja se redibuja en ese formato para medirla.
    for (const h of document.querySelectorAll("#infPapel .hoja")) {
      h.classList.add("modo-slide");
      try { hojas.push(await hojaASlide(h)); } finally { h.classList.remove("modo-slide"); }
    }
    // Sin encabezados especiales: el script de Google responde sin pedir permiso previo al navegador.
    const r = await fetch(SLIDES_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key: clave, titulo: $("informe").dataset.archivo, hojas }) });
    const j = await r.json();
    if (!j.url) throw new Error(j.error || "sin respuesta");
    if (pestana) pestana.location = j.url; else location.href = j.url;
  } catch (e) {
    console.error("Google Slides", e.message);
    if (pestana) pestana.close();
    alert("No se pudo armar la presentación. Probá de nuevo o descargá el PDF.");
  } finally {
    boton.disabled = false; boton.textContent = antes;
  }
}

/* ---------- Documento ---------- */
function mostrarInforme(op, d) {
  const { r, rc, meta, conMeta, rh, iniMes, finMes } = d, cli = r.cliente;
  const t = totales(r), c = rc ? totales(rc) : null, conectada = (r.tiendas || []).some((x) => x.conectada), b2b = !!cli.separa_b2b;
  const tituloPer = periodoTxt(op.a, op.b);
  const ctx = { op, r, rh, meta, t, c, etq: op.comp?.etq || "", conectada, b2b, tituloPer, iniMes, finMes };
  const avisos = [];
  if (conMeta && !meta) avisos.push("Meta no respondió: faltan Embudo, Creativos y Campañas. Generalo de nuevo en un momento.");
  if (meta?.fallaron) avisos.push(`${meta.fallaron} cuenta(s) de Meta no devolvieron datos: Embudo, Creativos y Campañas pueden quedar incompletos.`);
  if ((r.tiendas || []).some((x) => x.conectada && !x.buyers_done)) avisos.push("El historial de compradores todavía está cargando: Clientes nuevos y CAC pueden no ser definitivos.");
  if (op.temas.includes("emb") && conectada && meta?.periodo?.pagos > 0 && t.ventas > meta.periodo.pagos) avisos.push("Embudo: las ventas de la tienda superan a los pagos iniciados de Meta, así que esa tasa de paso no se muestra.");
  if (op.comp && c && c.fac === 0 && c.spend === 0) avisos.push("El período de comparación no tiene datos: las variaciones no se muestran.");
  const armar = {
    res: () => hojaResultados(ctx), emb: () => hojaEmbudo(ctx), his: () => hojaHistorico(ctx), dia: () => hojaDiaria(ctx), cli: () => hojaClientes(ctx),
    cre: () => hojaCreativos(ctx), cam: () => hojaCampanas(ctx), top: () => hojaTop(ctx), b2b: () => hojaB2b(ctx),
    pag: () => hojaCorte(ctx, r.pagos, "Métodos de pago", "Método", pagoTxt),
    cuo: () => hojaCorte(ctx, r.cuotas, "Cuotas", "Cuotas", (k) => (Number(k) === 1 ? "1 pago" : `${k} cuotas`)),
    env: () => hojaCorte(ctx, r.envios, "Métodos de envío", "Envío", (k) => k),
  };
  const hojas = [];
  TEMAS.filter((x) => op.temas.includes(x.id)).forEach((x) => {
    const h = armar[x.id]();
    if (h) hojas.push(h); else if (!x.meta || meta) avisos.push(`"${x.t}" no tiene datos en este período y no se incluyó.`);
  });
  if (op.notas) hojas.push({ titulo: "Comentarios", fuente: "Equipo de Elevation.", cuerpo: `<div class="i-notas">${esc(op.notas)}</div>` });
  const sub = `${esc(cli.name)} · ${esc(tituloPer)}`;
  const paginas = hojas.map((h, i) => `<section class="hoja"><header><div><h2>${esc(h.titulo)}</h2><p>${sub}${op.comp ? ` · comparado con ${esc(ctx.etq)}` : ""}</p></div><img src="logo-elevation.png" alt="Elevation"></header><div class="hoja-c">${h.cuerpo}</div><footer><span>Fuente: ${esc(h.fuente)}</span><span>${i + 2}</span></footer></section>`).join("");
  const portada = `<section class="hoja portada"><img src="logo-elevation.png" alt="Elevation"><div><p>Análisis de resultados</p><h1>${esc(cli.name)}</h1><h2>${esc(tituloPer)}</h2></div><footer><span>Elevation Media</span><span>Generado el ${esc(conAnio(hoyBA()))}</span></footer></section>`;
  const nombreArchivo = `${cli.name} - Analisis de Resultados ${tituloPer}`.replace(/[\\/:*?"<>|]/g, "-");
  $("informe").innerHTML = `<div class="inf-barra"><button type="button" class="btn" id="infVolver">Volver al portal</button><span>${hojas.length + 1} hojas</span><button type="button" class="btn" id="infEditar">Cambiar temas</button>${SLIDES_URL ? '<button type="button" class="btn" id="infSlides">Abrir en Google Slides</button>' : ""}<button type="button" class="btn pri" id="infPdf">Descargar PDF</button></div>
    ${avisos.length ? `<div class="inf-avisos"><b>Solo para el equipo, no sale en el PDF:</b><ul>${avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
    <div class="inf-papel" id="infPapel">${portada}${paginas}</div>`;
  $("informe").dataset.archivo = nombreArchivo;
  $("informe").hidden = false;
  $("informe").scrollTop = 0;
  document.body.classList.add("con-informe");
}
function cerrarInforme() { $("informe").hidden = true; $("informe").innerHTML = ""; document.body.classList.remove("con-informe"); }
$("informe").addEventListener("click", (e) => {
  // Cambiar la toma de una pieza. No sale en el PDF: se imprime la que quedó elegida.
  const cambiar = e.target.closest("[data-toma]");
  if (cambiar) {
    const caja = cambiar.closest(".i-img"), imgs = JSON.parse(caja.dataset.imgs);
    const i = (Number(caja.dataset.i) + Number(cambiar.dataset.toma) + imgs.length) % imgs.length;
    caja.dataset.i = i;
    caja.querySelector("img").src = imgs[i];
    caja.querySelector(".inf-toma span").textContent = `${i + 1}/${imgs.length}`;
    return;
  }
  if (e.target.id === "infVolver") return cerrarInforme();
  if (e.target.id === "infEditar") { cerrarInforme(); return abrirFormInforme(); }
  if (e.target.id === "infSlides") return abrirEnSlides(e.target);
  if (e.target.id === "infPdf") {
    const antes = document.title;
    document.title = $("informe").dataset.archivo;
    window.addEventListener("afterprint", () => { document.title = antes; }, { once: true });
    window.print();
  }
});
window.abrirFormInforme = abrirFormInforme;
})();
