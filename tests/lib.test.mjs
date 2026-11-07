// Correr con: node --test tests/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  agruparAnuncios, analisisMeta, BUYER_FIELDS, campanasMeta, clienteTN, resumirMeta, filasCompradores, filasMeta, firmaValida, hmacHex, insightsMeta, nombreTienda, normalizarOrden, ORDER_FIELDS, proximaVentana, ventanaAtras,
} from "../supabase/functions/tn-app/lib.ts";

const res = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

test("la firma coincide con el HMAC-SHA256 hexadecimal que manda Tiendanube", async () => {
  const body = '{"store_id":123,"event":"order/paid","id":9}';
  const esperada = createHmac("sha256", "secreto").update(body).digest("hex");
  assert.equal(await hmacHex("secreto", body), esperada);
  assert.equal(await firmaValida("secreto", body, esperada), true);
  assert.equal(await firmaValida("secreto", body, esperada.toUpperCase()), true);
});

test("rechaza firma mala, cuerpo alterado, firma ausente o secreto sin configurar", async () => {
  const body = '{"id":9}';
  const buena = createHmac("sha256", "secreto").update(body).digest("hex");
  assert.equal(await firmaValida("secreto", '{"id":10}', buena), false);
  assert.equal(await firmaValida("otro", body, buena), false);
  assert.equal(await firmaValida("secreto", body, null), false);
  assert.equal(await firmaValida("", body, buena), false);
});

const ordenCompleta = {
  id: 1, number: 100, total: "1500.50", subtotal: "1400", discount: "0", shipping_cost_customer: "100.50", currency: "ARS",
  payment_status: "paid", status: "open", gateway_name: "Mercado Pago", created_at: "2026-11-05T10:00:00-0300",
  payment_details: { method: "credit_card", credit_card_company: "visa", installments: "3" },
  fulfillments: [{ shipping: { type: "ship", carrier: { name: "Andreani" }, option: { name: "Andreani Estándar" } } }],
  products: [{ name: "Jean", quantity: "2", price: "700" }, { name: { es: "Remera" }, quantity: 1, price: "100" }],
  contact_email: " Pepe@Mail.com ", contact_name: "Pepe Argento", contact_phone: "1155555555", contact_identification: "20111222",
  customer: { name: "Pepe Argento", email: "pepe@mail.com" }, shipping_address: { address: "Calle Falsa 123" }, note: "dejar en portería",
  client_details: { browser_ip: "1.2.3.4" },
};

test("guarda pago, cuotas, envío y productos, sin ningún dato personal", async () => {
  const n = await normalizarOrden(55, ordenCompleta, "s");
  assert.equal(n.total, 1500.5);
  assert.equal(n.payment_method, "credit_card");
  assert.equal(n.installments, 3);
  assert.equal(n.shipping_option, "Andreani Estándar");
  assert.equal(n.unidades, 3);
  assert.deepEqual(n.items[1], { n: "Remera", q: 1, p: 100 });
  const crudo = JSON.stringify(n).toLowerCase();
  for (const dato of ["pepe", "1155555555", "20111222", "calle falsa", "portería", "1.2.3.4"]) assert.ok(!crudo.includes(dato), dato);
});

test("la huella del comprador es estable, ignora mayúsculas y cambia entre tiendas", async () => {
  const a = await normalizarOrden("1", ordenCompleta, "s");
  const b = await normalizarOrden("1", { ...ordenCompleta, contact_email: "pepe@mail.com" }, "s");
  const c = await normalizarOrden("2", ordenCompleta, "s");
  assert.equal(a.buyer_hash, b.buyer_hash);
  assert.notEqual(a.buyer_hash, c.buyer_hash);
  assert.equal((await normalizarOrden("1", { id: 2, created_at: "x" }, "s")).buyer_hash, null);
});

test("el envío cae en el campo viejo si no hay fulfillments", async () => {
  const n = await normalizarOrden("1", { id: 2, created_at: "x", shipping_option: "Correo" }, "s");
  assert.equal(n.shipping_option, "Correo");
});

test("pagina hasta el final y trata el 404 de última página como fin", async () => {
  const urls = [];
  const lote = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
  const f = async (u) => { urls.push(u); return urls.length === 1 ? res(200, lote) : res(404, { description: "Last page is 1" }); };
  const out = await clienteTN("7", "tok", f).ordenes({ updated_at_min: "2026-11-05T00:00:00Z" });
  assert.equal(out.length, 200);
  assert.match(urls[0], /api\.tiendanube\.com\/2025-03\/7\/orders\?/);
  assert.match(urls[1], /page=2/);
});

test("un 404 que no sea de última página es un error, no una tienda sin ventas", async () => {
  await assert.rejects(clienteTN("7", "t", async () => res(404, { code: 404, message: "Not Found" })).ordenes({}), /HTTP 404/);
  assert.deepEqual(await clienteTN("7", "t", async () => res(404, { description: "Last page is 0" })).ordenes({}), []);
});

test("la consulta no pide campos que la API 2025-03 rechaza", () => {
  for (const campo of ["shipping_cost_customer", "shipping_option"]) assert.ok(!ORDER_FIELDS.split(",").includes(campo), campo);
});

test("una orden con error de campos no se confunde con una orden inexistente", async () => {
  await assert.rejects(clienteTN("7", "t", async () => res(404, { description: "Invalid fields for this resource: x" })).orden(1), /Invalid fields/);
  assert.equal(await clienteTN("7", "t", async () => res(404, { message: "Not Found" })).orden(1), null);
});

test("reintenta ante 429 y falla ante errores reales", async () => {
  let n = 0;
  const f = async () => (++n === 1 ? res(429, {}, { "x-rate-limit-reset": "10" }) : res(200, [{ id: 1 }]));
  assert.equal((await clienteTN("7", "t", f, async () => {}).ordenes({})).length, 1);
  await assert.rejects(clienteTN("7", "t", async () => res(401, {})).ordenes({}), /HTTP 401/);
});

test("no duplica webhooks", async () => {
  const posts = [];
  const f = async (u, init) => {
    assert.equal(init.headers.Authorization, "Bearer tok");
    if (init.method === "POST") { posts.push(JSON.parse(init.body).event); return res(201, {}); }
    return res(200, [{ id: 1, event: "order/paid", url: "https://h/w" }, { id: 2, event: "order/created", url: "https://otra/w" }]);
  };
  await clienteTN("7", "tok", f).asegurarWebhooks("https://h/w", ["order/paid", "order/created"]);
  assert.deepEqual(posts, ["order/created"]);
});

test("el historial avanza de a un mes y se detiene en el límite", () => {
  assert.deepEqual(proximaVentana(null, "2026-11-06"), { desde: "2026-10-06", hasta: "2026-11-06" });
  assert.deepEqual(proximaVentana("2026-10-06", "2026-11-06"), { desde: "2026-09-05", hasta: "2026-10-06" });
  assert.deepEqual(proximaVentana("2025-10-20", "2026-11-06", 31, 400), { desde: "2025-10-02", hasta: "2025-10-20" });
  assert.equal(proximaVentana("2025-10-02", "2026-11-06", 31, 400), null);
});

test("lee inversión y mensajes de Meta y sigue la paginación", async () => {
  const urls = [];
  const f = async (u) => {
    urls.push(u);
    return urls.length === 1
      ? res(200, { data: [{ date_start: "2026-11-05", spend: "100.5", impressions: "10", clicks: "2", account_currency: "ARS",
          actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "7" }] }], paging: { next: "https://graph.facebook.com/n" } })
      : res(200, { data: [{ date_start: "2026-11-06", spend: "1", account_currency: "USD" }] });
  };
  const filas = await insightsMeta("9", "t", "2026-11-05", "2026-11-06", f);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { day: "2026-11-05", account_id: "9", currency: "ARS", spend: 100.5, impressions: 10, clicks: 2, messages: 7 });
  assert.equal(filas[1].messages, 0);
  assert.match(urls[0], /act_9\/insights/);
  await assert.rejects(insightsMeta("9", "t", "a", "b", async () => res(400, { error: { message: "token vencido" } })), /token vencido/);
  assert.equal(filasMeta("1", "ARS", [{ date_start: "d" }])[0].spend, 0);
});

test("del historial viejo solo pide lo mínimo y guarda quién compró", async () => {
  const urls = [];
  const f = async (u) => { urls.push(u); return res(200, [{ id: 1 }]); };
  await clienteTN("7", "t", f).ordenes({ created_at_max: "x" }, BUYER_FIELDS);
  assert.match(urls[0], /fields=id%2Ccontact_email%2Cpayment_status%2Cstatus%2Ccreated_at/);
  assert.ok(!urls[0].includes("aggregates"));
  const filas = await filasCompradores("7", [
    { contact_email: "A@b.com ", payment_status: "paid", status: "open", created_at: "2020-01-01", contact_name: "Pepe" },
    { contact_email: "c@d.com", payment_status: "pending", status: "open", created_at: "2020-01-02" },
    { contact_email: "e@f.com", payment_status: "paid", status: "cancelled", created_at: "2020-01-03" },
    { payment_status: "paid", status: "open", created_at: "2020-01-04" },
  ], "s");
  assert.equal(filas.length, 1);
  assert.deepEqual(Object.keys(filas[0]).sort(), ["buyer_hash", "first_paid_at", "store_id"]);
  assert.equal(filas[0].buyer_hash, (await normalizarOrden("7", { id: 1, created_at: "x", contact_email: "a@b.com" }, "s")).buyer_hash, "misma huella que las órdenes");
  assert.ok(!JSON.stringify(filas).toLowerCase().includes("pepe") && !JSON.stringify(filas).includes("b.com"));
});

test("detecta cuándo terminó el historial de la tienda", async () => {
  assert.equal(await clienteTN("7", "t", async () => res(404, { description: "Last page is 0" })).hayOrdenesAntes("x"), false);
  assert.equal(await clienteTN("7", "t", async () => res(200, [{ id: 1 }])).hayOrdenesAntes("x"), true);
  await assert.rejects(clienteTN("7", "t", async () => res(404, { description: "Invalid fields" })).hayOrdenesAntes("x"), /Invalid/);
  assert.deepEqual(ventanaAtras("2020-03-02", 31), { desde: "2020-01-31", hasta: "2020-03-02" });
});

test("nombre de tienda en cualquier formato", () => {
  assert.equal(nombreTienda({ name: { es: "Mi Tienda", pt: "Minha" } }), "Mi Tienda");
  assert.equal(nombreTienda({ name: "Plana" }), "Plana");
  assert.equal(nombreTienda({}), null);
});

test("trae campañas con su nombre actual, aunque ya no estén en la lista", async () => {
  const urls = [];
  const f = async (u) => {
    urls.push(u);
    if (u.includes("/campaigns")) return res(200, { data: [{ id: "c1", name: "Nombre nuevo (B2B)", objective: "OUTCOME_ENGAGEMENT" }] });
    return res(200, { data: [
      { date_start: "2026-11-05", campaign_id: "c1", campaign_name: "Nombre viejo", spend: "10.5", account_currency: "ARS", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" }] },
      { date_start: "2026-11-05", campaign_id: "c2", campaign_name: "Borrada", spend: "3", account_currency: "USD" },
      { date_start: "2026-11-05", spend: "1" },
    ] });
  };
  const { campanas, filas } = await campanasMeta("9", "t", "2026-11-05", "2026-11-06", f);
  assert.match(urls[0], /act_9\/insights/);
  assert.match(urls[0], /level=campaign/);
  const c = Object.fromEntries(campanas.map((x) => [x.campaign_id, x]));
  assert.equal(c.c1.name, "Nombre nuevo (B2B)", "gana el nombre actual");
  assert.equal(c.c1.objective, "OUTCOME_ENGAGEMENT");
  assert.equal(c.c2.name, "Borrada");
  assert.equal(filas.length, 2, "sin campaña no se guarda");
  assert.deepEqual(filas[0], { day: "2026-11-05", campaign_id: "c1", account_id: "9", currency: "ARS", spend: 10.5, messages: 4 });
  assert.equal(filas[1].currency, "USD");
  await assert.rejects(campanasMeta("9", "t", "a", "b", async () => res(400, { error: { message: "sin permiso" } })), /sin permiso/);
});

const filaMeta = (extra = {}) => ({
  spend: "100", impressions: "1000", inline_link_clicks: "50", account_currency: "ARS",
  actions: [
    { action_type: "landing_page_view", value: "40" }, { action_type: "omni_landing_page_view", value: "42" },
    { action_type: "omni_add_to_cart", value: "10" }, { action_type: "omni_initiated_checkout", value: "5" },
    { action_type: "omni_purchase", value: "2" }, { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" },
  ],
  action_values: [{ action_type: "omni_purchase", value: "900" }],
  ...extra,
});

test("el embudo usa los eventos omni y pasa a pesos las cuentas en dólares", () => {
  assert.deepEqual(resumirMeta(filaMeta()), { spend: 100, impresiones: 1000, clics: 50, visitas: 42, carritos: 10, pagos: 5, compras: 2, valor: 900, mensajes: 3 });
  const usd = resumirMeta(filaMeta({ account_currency: "USD" }), 1000);
  assert.equal(usd.spend, 100000);
  assert.equal(usd.valor, 900000);
  assert.equal(usd.compras, 2, "las compras no se convierten");
  assert.equal(resumirMeta({ spend: "1" }).compras, 0, "sin acciones da cero");
});

test("un anuncio en varios conjuntos suma y toma la imagen del que más invirtió", () => {
  const out = agruparAnuncios([
    filaMeta({ ad_id: "1", ad_name: "Pieza A", spend: "10" }),
    filaMeta({ ad_id: "2", ad_name: "Pieza A", spend: "90" }),
    filaMeta({ ad_id: "3", ad_name: "Pieza B", spend: "5", actions: [{ action_type: "purchase", value: "1" }] }),
  ]);
  assert.equal(out[0].nombre, "Pieza A");
  assert.equal(out[0].id, "2");
  assert.equal(out[0].spend, 100);
  assert.equal(out[0].compras, 4);
});

test("el análisis trae cuenta, comparación, campañas y anuncios; sin imagen no se cae", async () => {
  const llamadas = [];
  const f = async (url) => {
    llamadas.push(url);
    const u = new URL(url);
    if (!u.searchParams.has("time_range")) return res(500, { error: { message: "no" } });
    const rango = JSON.parse(u.searchParams.get("time_range"));
    const nivel = u.searchParams.get("level");
    if (nivel === "account") return res(200, { data: [filaMeta({ spend: rango.since === "2026-09-01" ? "50" : "100" })] });
    if (nivel === "campaign") return res(200, { data: [filaMeta({ campaign_id: "c1", campaign_name: "Camp" })] });
    return res(200, { data: [filaMeta({ ad_id: "a1", ad_name: "Pieza" })] });
  };
  const r = await analisisMeta("9", "tok", "2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30", 1, f);
  assert.equal(r.periodo.spend, 100);
  assert.equal(r.compara.spend, 50);
  assert.equal(r.campanas[0].nombre, "Camp");
  assert.equal(r.anuncios[0].nombre, "Pieza");
  assert.equal(r.anuncios[0].imagen, null);
  assert.ok(llamadas.every((u) => !u.includes("tok")), "el token no viaja en la URL");
  const sin = await analisisMeta("9", "tok", "2026-10-01", "2026-10-31", null, null, 1, f);
  assert.equal(sin.compara, null);
});

test("la imagen se pide por anuncio y el tamaño va sobre la pieza", async () => {
  const f = async (url) => {
    const u = new URL(url);
    assert.ok(!u.searchParams.has("ids"), "Meta ya no acepta ids");
    if (u.searchParams.get("fields") === "creative{id}") return res(200, { id: "a1", creative: { id: "p1" } });
    if (u.pathname.endsWith("/p1")) {
      assert.equal(u.searchParams.get("thumbnail_width"), "600");
      return res(200, { id: "p1", thumbnail_url: "https://img/chica.jpg" });
    }
    const nivel = u.searchParams.get("level");
    return res(200, { data: nivel === "ad" ? [filaMeta({ ad_id: "a1", ad_name: "Pieza" })] : [filaMeta({ campaign_id: "c1" })] });
  };
  const r = await analisisMeta("9", "tok", "2026-10-01", "2026-10-31", null, null, 1, f);
  assert.equal(r.anuncios[0].imagen, "https://img/chica.jpg");
});
