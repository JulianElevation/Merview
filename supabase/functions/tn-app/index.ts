// Backend del Portal Elevation.
// Rutas: GET /callback · POST /webhook · POST /sync · POST /meta-sync
//        POST /privacy/{store-redact,customer-redact,customers-data-request}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  APP_EVENTS, BUYER_FIELDS, campanasMeta, clienteTN, DIAS_HISTORIA, filasCompradores, firmaValida, igualSeguro, insightsMeta,
  nombreTienda, normalizarOrden, ORDER_EVENTS, proximaVentana, ventanaAtras,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CLIENT_SECRET = Deno.env.get("TN_CLIENT_SECRET") ?? "";
const META_TOKEN = Deno.env.get("META_TOKEN") ?? "";
const PAGINA = "https://merview.vercel.app/portal.html";
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/tn-app/webhook`;
const PRESUPUESTO_MS = 110_000; // las funciones se cortan a los 150 segundos

const enFondo = (p: Promise<unknown>) => {
  const conLog = p.catch((e) => console.error("en fondo:", e?.message ?? e));
  // @ts-ignore EdgeRuntime existe en Supabase
  EdgeRuntime.waitUntil(conLog);
};
const responder = (status: number, cuerpo: unknown = { ok: status < 400 }) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const volver = (params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `${PAGINA}?${new URLSearchParams(params)}` } });
const hoyBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const texto = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

async function config(key: string): Promise<string | null> {
  const { data } = await db.from("tn_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function clavesCron(req: Request) {
  const esperado = await config("cron_secret");
  return !!esperado && igualSeguro(esperado, req.headers.get("x-cron-secret") ?? "");
}
async function guardarOrdenes(storeId: string, ordenes: Record<string, any>[]) {
  const validas = await Promise.all(
    ordenes.filter((o) => o?.id && o?.created_at).map((o) => normalizarOrden(storeId, o, CLIENT_SECRET)),
  );
  for (let i = 0; i < validas.length; i += 500) {
    const { error } = await db.rpc("tn_upsert_orders", { p_rows: validas.slice(i, i + 500) });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
  return validas.length;
}
async function marcar(storeId: string, campos: Record<string, unknown>) {
  await db.from("tn_installs").update(campos).eq("store_id", storeId);
}

// Red de seguridad si un webhook no llega.
async function reconciliar(storeId: string, token: string, desde: string) {
  const inicio = new Date().toISOString();
  const ordenes = await clienteTN(storeId, token).ordenes({ updated_at_min: desde });
  const n = await guardarOrdenes(storeId, ordenes);
  await marcar(storeId, { last_sync_at: inicio, last_error: null });
  return n;
}

// Baja un mes de historial. coverage_from se mueve solo si el mes entró completo.
async function bajarHistorial(storeId: string, token: string, coverageFrom: string | null) {
  const v = proximaVentana(coverageFrom, hoyBA());
  if (!v) { await marcar(storeId, { backfill_done: true }); return false; }
  const hasta = coverageFrom ? `${v.hasta}T00:00:00-03:00` : new Date().toISOString();
  const ordenes = await clienteTN(storeId, token).ordenes({ created_at_min: `${v.desde}T00:00:00-03:00`, created_at_max: hasta });
  await guardarOrdenes(storeId, ordenes);
  await marcar(storeId, { coverage_from: v.desde, last_error: null });
  return true;
}

// Después de las órdenes, recorre el resto de la tienda para saber quién ya había comprado.
async function bajarCompradores(storeId: string, token: string, cursor: string) {
  const tn = clienteTN(storeId, token);
  const tope = `${cursor}T00:00:00-03:00`;
  if (!await tn.hayOrdenesAntes(tope)) { await marcar(storeId, { buyers_done: true, last_error: null }); return null; }
  const v = ventanaAtras(cursor);
  const ordenes = await tn.ordenes({ created_at_min: `${v.desde}T00:00:00-03:00`, created_at_max: tope }, BUYER_FIELDS);
  const filas = await filasCompradores(storeId, ordenes, CLIENT_SECRET);
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.rpc("tn_upsert_buyers", { p_rows: filas.slice(i, i + 500) });
    if (error) throw new Error(`compradores: ${error.message}`);
  }
  await marcar(storeId, { buyers_until: v.desde, last_error: null });
  return v.desde;
}

async function callback(url: URL) {
  const code = url.searchParams.get("code");
  if (!code) return volver({ error: "sin_codigo" });
  const clientId = await config("app_id");
  if (!clientId || !CLIENT_SECRET) return volver({ error: "app_sin_configurar" });

  const r = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    console.error("token rechazado", r.status, data?.error_description ?? "");
    return volver({ error: "autorizacion_rechazada" });
  }
  const storeId = String(data.user_id ?? data.store_id);
  const tn = clienteTN(storeId, data.access_token);
  const tienda = await tn.tienda().catch(() => ({}));
  const nombre = nombreTienda(tienda) ?? storeId;
  const { error } = await db.from("tn_installs").upsert({
    store_id: storeId, access_token: data.access_token, scope: data.scope, store_name: nombre,
    currency: (tienda as { main_currency?: string }).main_currency ?? null,
    installed_at: new Date().toISOString(), uninstalled_at: null, last_error: null,
    coverage_from: null, backfill_done: false, buyers_until: null, buyers_done: false,
  });
  if (error) { console.error("guardar instalación", error.message); return volver({ error: "no_se_guardo" }); }

  try {
    await tn.asegurarWebhooks(WEBHOOK_URL, [...ORDER_EVENTS, ...APP_EVENTS]);
  } catch (e) {
    await marcar(storeId, { last_error: texto(e) });
  }
  enFondo(bajarHistorial(storeId, data.access_token, null).catch((e) => marcar(storeId, { last_error: texto(e) })));
  return volver({ instalada: nombre });
}

async function procesarOrden(storeId: string, orderId: string | number) {
  const { data } = await db.from("tn_installs").select("access_token").eq("store_id", storeId).maybeSingle();
  if (!data?.access_token) return;
  const orden = await clienteTN(storeId, data.access_token).orden(orderId);
  if (orden) await guardarOrdenes(storeId, [orden]);
  await marcar(storeId, { last_webhook_at: new Date().toISOString() });
}

async function webhook(req: Request) {
  const cuerpo = await req.text();
  if (!await firmaValida(CLIENT_SECRET, cuerpo, req.headers.get("x-linkedstore-hmac-sha256"))) return responder(401);
  const ev = JSON.parse(cuerpo);
  const storeId = String(ev.store_id);
  if (ev.event === "app/uninstalled") {
    await marcar(storeId, { access_token: null, uninstalled_at: new Date().toISOString() });
  } else if (String(ev.event).startsWith("order/") && ev.id) {
    // Tiendanube corta a los 3 segundos: se responde ya y la orden se busca en segundo plano.
    enFondo(procesarOrden(storeId, ev.id));
  }
  return responder(200);
}

async function enParalelo<T>(lista: T[], cuantos: number, tarea: (x: T) => Promise<void>) {
  const cola = [...lista];
  await Promise.all(Array.from({ length: cuantos }, async () => {
    for (let x = cola.shift(); x !== undefined; x = cola.shift()) await tarea(x);
  }));
}

async function sync(req: Request) {
  if (!await clavesCron(req)) return responder(401);
  const inicio = Date.now();
  const { data: tiendas, error } = await db.from("tn_installs")
    .select("store_id,access_token,last_sync_at,coverage_from,backfill_done").not("access_token", "is", null);
  if (error) return responder(500, { error: error.message });

  let ordenes = 0, fallas = 0, meses = 0;
  await enParalelo(tiendas ?? [], 6, async (t) => {
    // Con margen de 3 minutos para no perder nada entre corrida y corrida.
    const base = t.last_sync_at ? new Date(t.last_sync_at).getTime() - 3 * 6e4 : Date.now() - 2 * 864e5;
    try { ordenes += await reconciliar(t.store_id, t.access_token, new Date(base).toISOString()); }
    catch (e) { fallas++; await marcar(t.store_id, { last_error: texto(e) }); }
  });
  // Con el tiempo que sobra, avanza el historial.
  const pendientes = (tiendas ?? []).filter((t) => !t.backfill_done);
  await enParalelo(pendientes, 4, async (t) => {
    let cobertura = t.coverage_from;
    while (Date.now() - inicio < PRESUPUESTO_MS) {
      try {
        if (!await bajarHistorial(t.store_id, t.access_token, cobertura)) return;
        const v = proximaVentana(cobertura, hoyBA());
        cobertura = v?.desde ?? cobertura; meses++;
      } catch (e) { await marcar(t.store_id, { last_error: texto(e) }); return; }
    }
  });
  // Y cuando termina el historial de órdenes, sigue con los compradores más viejos.
  const { data: conCompradores } = await db.from("tn_installs")
    .select("store_id,access_token,coverage_from,buyers_until")
    .not("access_token", "is", null).eq("backfill_done", true).eq("buyers_done", false);
  let tramos = 0;
  await enParalelo(conCompradores ?? [], 4, async (t) => {
    let cursor: string | null = t.buyers_until ?? t.coverage_from;
    while (cursor && Date.now() - inicio < PRESUPUESTO_MS) {
      try { cursor = await bajarCompradores(t.store_id, t.access_token, cursor); if (cursor) tramos++; }
      catch (e) { await marcar(t.store_id, { last_error: texto(e) }); return; }
    }
  });
  return responder(200, { tiendas: tiendas?.length ?? 0, ordenes, fallas, meses, tramos });
}

async function metaSync(req: Request) {
  if (!await clavesCron(req)) return responder(401);
  if (!META_TOKEN) return responder(200, { omitido: "falta META_TOKEN" });
  const inicio = Date.now();
  const { data: clientes, error } = await db.from("clients").select("meta_accounts").eq("active", true);
  if (error) return responder(500, { error: error.message });
  const cuentas = [...new Set((clientes ?? []).flatMap((c) => c.meta_accounts ?? []))] as string[];
  const { data: estados } = await db.from("meta_state").select("account_id,backfill_done");
  const conHistoria = new Set((estados ?? []).filter((e) => e.backfill_done).map((e) => e.account_id));

  const hoy = hoyBA();
  const atras = (n: number) => new Date(new Date(hoy + "T12:00:00Z").getTime() - n * 864e5).toISOString().slice(0, 10);
  let filas = 0, fallas = 0;
  await enParalelo(cuentas, 5, async (id) => {
    // Meta ajusta días recientes: siempre se releen los últimos 3.
    const completa = !conHistoria.has(id) && Date.now() - inicio < PRESUPUESTO_MS;
    try {
      const datos = await insightsMeta(id, META_TOKEN, atras(completa ? DIAS_HISTORIA : 3), hoy);
      if (datos.length) {
        const { error: e } = await db.rpc("meta_upsert", { p_rows: datos });
        if (e) throw new Error(e.message);
      }
      filas += datos.length;
      await db.from("meta_state").upsert({
        account_id: id, last_ok_at: new Date().toISOString(), last_error: null,
        backfill_done: completa || conHistoria.has(id),
      });
    } catch (e) {
      fallas++;
      await db.from("meta_state").upsert({ account_id: id, last_error: texto(e), backfill_done: conHistoria.has(id) });
    }
  });
  const campanas = await sincronizarCampanas(inicio, atras, hoy).catch((e) => { console.error("campañas", texto(e)); return -1; });
  return responder(200, { cuentas: cuentas.length, filas, fallas, campanas });
}

// Solo clientes marcados. Si esto falla, la inversión de todos ya quedó guardada arriba.
async function sincronizarCampanas(inicio: number, atras: (n: number) => string, hoy: string) {
  const { data: marcados } = await db.from("clients").select("meta_accounts").eq("active", true).eq("separa_b2b", true);
  const cuentas = [...new Set((marcados ?? []).flatMap((c) => c.meta_accounts ?? []))] as string[];
  if (!cuentas.length) return 0;
  const { data: estados } = await db.from("meta_state").select("account_id,campanas_historia").in("account_id", cuentas);
  const conHistoria = new Set((estados ?? []).filter((e) => e.campanas_historia).map((e) => e.account_id));
  let n = 0;
  await enParalelo(cuentas, 3, async (id) => {
    if (Date.now() - inicio > PRESUPUESTO_MS) return;
    const completa = !conHistoria.has(id);
    try {
      const { campanas, filas } = await campanasMeta(id, META_TOKEN, atras(completa ? DIAS_HISTORIA : 3), hoy);
      for (let i = 0; i < Math.max(filas.length, 1); i += 500) {
        const { error } = await db.rpc("meta_campanas_upsert", { p_campanas: i === 0 ? campanas : [], p_filas: filas.slice(i, i + 500) });
        if (error) throw new Error(error.message);
      }
      n += filas.length;
      await db.from("meta_state").update({ campanas_historia: true, campanas_error: null }).eq("account_id", id);
    } catch (e) {
      await db.from("meta_state").update({ campanas_error: texto(e) }).eq("account_id", id);
    }
  });
  return n;
}

async function privacidad(req: Request, ruta: string) {
  const cuerpo = await req.text();
  if (!await firmaValida(CLIENT_SECRET, cuerpo, req.headers.get("x-linkedstore-hmac-sha256"))) return responder(401);
  if (ruta.endsWith("store-redact")) {
    const storeId = String(JSON.parse(cuerpo).store_id);
    await db.from("tn_orders").delete().eq("store_id", storeId);
    await db.from("tn_buyers").delete().eq("store_id", storeId);
    await db.from("tn_installs").delete().eq("store_id", storeId);
  }
  // No se guardan datos personales de compradores: no hay nada que borrar ni informar por persona.
  return responder(200);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^.*\/tn-app/, "") || "/";
  try {
    if (req.method === "GET" && ruta === "/callback") return await callback(url);
    if (req.method === "POST" && ruta === "/webhook") return await webhook(req);
    if (req.method === "POST" && ruta === "/sync") return await sync(req);
    if (req.method === "POST" && ruta === "/meta-sync") return await metaSync(req);
    if (req.method === "POST" && ruta.startsWith("/privacy/")) return await privacidad(req, ruta);
    return responder(404);
  } catch (e) {
    console.error(ruta, texto(e));
    return req.method === "GET" ? volver({ error: "fallo_interno" }) : responder(500);
  }
});
