// Prueba las migraciones en un Postgres local, sin tocar producción.
// Uso: node tests/sql.test.mjs <ruta a @electric-sql/pglite/dist/index.js>
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite();
const q = async (s, p) => (await db.query(s, p)).rows;

// Lo que ya existe en producción (MER View), con datos inventados.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.clients (id text primary key, name text, kind text, meta_accounts text[] default '{}', tn_stores text[] default '{}', woo_shops text[] default '{}', active boolean default true);
  create table public.settings (key text primary key, value text);
  create table public.store_daily (day date, source text, store_id text, revenue numeric, primary key (day, source, store_id));
  create table public.meta_daily (day date, account_id text, currency text, spend numeric, messages numeric, primary key (day, account_id));
  create table public.sync_runs (id serial, ran_at timestamptz default now());
  create table public.access_keys (key_hash text primary key, active boolean default true);
  create function public.merview_key_ok(p_key text) returns boolean language sql stable as $$
    select exists(select 1 from public.access_keys where active and key_hash = encode(sha256(convert_to(coalesce(p_key,''),'UTF8')),'hex')) $$;
  insert into public.access_keys(key_hash) values (encode(sha256(convert_to('clave','UTF8')),'hex'));
  insert into public.settings values ('usd_ars','1500');
  insert into public.clients (id,name,kind,meta_accounts,tn_stores) values
    ('a','Cliente A','ecommerce','{m1}','{s1}'),
    ('b','Cliente B','ecommerce','{m2}','{s2}'),
    ('l','Leads','leads','{m3}','{}'),
    ('x','Dado de baja','ecommerce','{m9}','{s9}');
  update public.clients set active=false where id='x';
`);
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_portal.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_compradores.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_fichas_portal.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_portal_vistas.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_portal_rapido.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_link_cliente.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_agencia.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_agencia_12h.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_b2b.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_solo_b2b.sql"), "utf8"));
await db.exec(readFileSync(join(raiz, "supabase/migrations/20261106_historico.sql"), "utf8"));
console.log("ok  la migración corre completa");

const hoy = (await q(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d`))[0].d;
const dia = (n) => new Date(new Date(hoy + "T12:00:00Z").getTime() - n * 864e5).toISOString().slice(0, 10);
const orden = (id, d, total, extra = {}) => ({
  store_id: "s1", order_id: id, number: id, total, currency: "ARS", payment_status: "paid", status: "open", gateway: "Mercado Pago",
  payment_method: "credit_card", installments: 3, shipping_option: "Andreani", unidades: 1, items: [{ n: "Jean", q: 1, p: total }],
  buyer_hash: "h" + id, created_at: `${d}T12:00:00-03:00`, updated_at: `${d}T12:00:00-03:00`, ...extra,
});
const cargar = (filas) => q(`select public.tn_upsert_orders($1::jsonb) n`, [JSON.stringify(filas)]);

await db.exec(`insert into public.tn_installs (store_id, access_token, coverage_from) values ('s1','tok','${dia(2)}')`);
await cargar([
  orden(1, hoy, 1000),
  orden(2, hoy, 500, { buyer_hash: "repite" }),
  orden(3, dia(1), 700, { buyer_hash: "repite" }),
  orden(4, hoy, 9999, { payment_status: "pending", buyer_hash: "p" }),
  orden(5, hoy, 8888, { status: "cancelled", buyer_hash: "c" }),
  orden(7, hoy, 111, { payment_status: "partially_paid", buyer_hash: "pp" }),
]);
await db.exec(`
  insert into public.store_daily values ('${hoy}','tiendanube','s1',111111), ('${dia(5)}','tiendanube','s1',4000), ('${hoy}','tiendanube','s2',2500);
  insert into public.meta_daily values ('${hoy}','m1','ARS',10,0), ('${dia(5)}','m1','ARS',400,0), ('${hoy}','m2','USD',2,0), ('${hoy}','m3','ARS',90,12), ('${hoy}','m9','ARS',777,0);
  insert into public.meta_live (day,account_id,currency,spend,messages) values ('${hoy}','m1','ARS',300,0);
`);

const gen = (await q(`select public.portal_general('clave',$1::date,$2::date) r`, [dia(6), hoy]))[0].r;
const cli = Object.fromEntries(gen.clientes.map((c) => [c.id, c]));
assert.equal(cli.x, undefined, "los dados de baja no aparecen");
assert.equal(Number(cli.a.revenue), 1000 + 500 + 700 + 4000, "vivo donde hay cobertura y Master Metrics antes");
assert.equal(Number(cli.a.spend), 300 + 400, "Meta en vivo gana sobre lo cargado por Master Metrics");
assert.equal(Number(cli.b.revenue), 2500, "tienda sin conectar usa Master Metrics");
assert.equal(Number(cli.b.spend), 3000, "cuenta en USD convertida");
assert.equal(Number(cli.l.messages), 12);
assert.equal(Number(cli.a.tiendas_vivo), 1);
const hoyTotal = gen.dias.find((d) => d.day === hoy);
assert.equal(Number(hoyTotal.spend), 300 + 3000, "el total de agencia no suma cuentas de leads");
console.log("ok  tablero general: fuentes, USD, bajas y leads");

const unDia = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
const d0 = unDia.dias[0];
assert.equal(Number(d0.revenue), 1500, "pendiente y cancelada no suman");
assert.equal(Number(d0.orders), 2);
assert.equal(Number(unDia.pendiente.total), 9999 + 111, "pago parcial cuenta como no pagada");
assert.equal(unDia.ordenes_total, 5, "el listado muestra todas las órdenes del período");
assert.equal(Number(d0.nuevos), 1);
assert.equal(Number(d0.recurrentes), 1, "ya había comprado ayer");
assert.deepEqual(unDia.tipos.map((t) => t.k).sort(), ["Nuevo", "Recurrente"]);
assert.equal(unDia.cuotas[0].k, 3);
assert.equal(unDia.pagos[0].k, "credit_card");
assert.equal(unDia.envios[0].k, "Andreani");
console.log("ok  vista de cliente: ventas, pendientes, nuevos/recurrentes y cortes");

// Un duplicado o una versión vieja no cambia nada; una nueva sí.
await cargar([orden(1, hoy, 1)]);
const viejo = await cargar([orden(1, hoy, 2, { updated_at: `${dia(3)}T00:00:00-03:00` })]);
assert.equal(viejo[0].n, 0, "una versión vieja no pisa");
assert.equal(Number((await q(`select total from public.tn_orders where order_id=1`))[0].total), 1);
console.log("ok  idempotencia ante webhooks repetidos y desordenados");

// Cargar el historial después no deja mal marcado al comprador.
await cargar([orden(6, dia(30), 100, { buyer_hash: "h1" })]);
const r2 = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
assert.equal(r2.ordenes.find((o) => o.number === 1).tipo, "Recurrente", "historial cargado después corrige el tipo");
console.log("ok  nuevos/recurrentes con historial cargado hacia atrás");

// Un comprador de hace años, fuera de las órdenes guardadas, deja de contar como nuevo.
const antes = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
assert.equal(antes.ordenes.find((o) => o.number === 2).tipo, "Recurrente");
assert.equal(antes.ordenes.find((o) => o.number === 7).tipo, "Nuevo");
await q(`select public.tn_upsert_buyers($1::jsonb)`, [JSON.stringify([
  { store_id: "s1", buyer_hash: "pp", first_paid_at: "2020-01-01T10:00:00-03:00" },
  { store_id: "s1", buyer_hash: "pp", first_paid_at: "2021-01-01T10:00:00-03:00" },
])]);
const desp = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
assert.equal(desp.ordenes.find((o) => o.number === 7).tipo, "Recurrente");
assert.equal((await q(`select first_paid_at::date::text f from public.tn_buyers where buyer_hash='pp'`))[0].f, "2020-01-01", "se queda con la compra más vieja");
assert.equal(desp.tiendas[0].buyers_done, false);
console.log("ok  compradores de todo el historial");

// Comparación, ranking y series por mes.
await cargar([
  orden(60, hoy, 3000, { unidades: 3, buyer_hash: "m1", items: [{ n: "Zapato (Azul, 38)", q: 2, p: 1000 }, { n: "Remera", q: 1, p: 1000 }] }),
  orden(61, hoy, 1000, { unidades: 1, buyer_hash: "m2", items: [{ n: "Zapato (Negro, 40)", q: 1, p: 1000 }] }),
  orden(62, dia(1), 900, { unidades: 9, buyer_hash: "m3", items: [{ n: "Remera", q: 9, p: 100 }] }),
  orden(63, hoy, 500, { payment_status: "pending", unidades: 50, buyer_hash: "m4", items: [{ n: "Zapato", q: 50, p: 10 }] }),
]);
const vis = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
const jean = vis.productos.find((p) => p.nombre === "Zapato");
assert.equal(Number(jean.unidades), 3, "agrupa variantes y solo cuenta ventas pagadas");
assert.equal(Number(jean.total), 3000);
assert.ok(Number(vis.unidades) >= 4);
assert.ok(Number(vis.prev.unidades) >= 9, "unidades del período anterior");
assert.ok(Number(vis.prev.revenue) >= 900);
const mesHoy = hoy.slice(0, 7);
assert.ok(Number(vis.meses.find((m) => m.mes === mesHoy).ventas) >= 4);
assert.ok(vis.meses_pagos.some((m) => m.mes === mesHoy && m.k === "credit_card"));
assert.ok(vis.meses_cuotas.some((m) => m.mes === mesHoy && Number(m.k) === 3));
assert.ok(!JSON.stringify(vis).includes("buyer_hash"));
console.log("ok  comparación, ranking y series por mes");

// Ficha solo del portal: se ve en el portal, pero la lista que usa la carga de MER View sigue vacía.
await db.exec(`insert into public.tn_installs (store_id, access_token, coverage_from) values ('1725892','tok','${dia(2)}')`);
await cargar([orden(50, hoy, 4321, { store_id: "1725892", buyer_hash: "lib" })]);
const gen2 = (await q(`select public.portal_general('clave',$1::date,$1::date) r`, [hoy]))[0].r;
const libra = gen2.clientes.find((c) => c.id === "libralatina");
assert.equal(Number(libra.revenue), 4321);
assert.deepEqual(libra.tn_stores, ["1725892"]);
assert.equal(Number(libra.tiendas_vivo), 1);
const fichaLibra = (await q(`select public.portal_cliente('clave','libralatina',$1::date,$1::date) r`, [hoy]))[0].r;
assert.equal(fichaLibra.ordenes[0].number, 50);
assert.deepEqual(fichaLibra.cliente.tn_stores, ["1725892"]);
assert.deepEqual((await q(`select tn_stores from public.clients where id='libralatina'`))[0].tn_stores, []);
assert.equal((await q(`select kind from public.clients where id='cezze'`))[0].kind, "sin_tienda");
console.log("ok  fichas solo del portal, sin tocar la carga de MER View");

// Seguridad.
await assert.rejects(q(`select public.portal_general('mala',now()::date,now()::date)`), /clave_invalida/);
await assert.rejects(q(`select public.portal_cliente('mala','a',now()::date,now()::date)`), /clave_invalida/);
await assert.rejects(q(`select public.portal_cliente('clave','x',now()::date,now()::date)`), /cliente_inexistente/);
await assert.rejects(q(`select public.portal_general('clave','2020-01-01','2026-01-01')`), /rango_invalido/);
const permisos = await q(`select
  has_table_privilege('anon','public.tn_installs','select') tok, has_table_privilege('anon','public.tn_orders','select') ord,
  has_function_privilege('anon','public.tn_upsert_orders(jsonb)','execute') up, has_function_privilege('anon','public.tn_upsert_buyers(jsonb)','execute') upb, has_function_privilege('anon','public.portal_serie(date,date)','execute') serie,
  has_function_privilege('anon','public.portal_general(text,date,date)','execute') gen`);
assert.deepEqual(permisos[0], { tok: false, ord: false, up: false, upb: false, serie: false, gen: true });
const txt = JSON.stringify(r2);
assert.ok(!txt.includes("buyer_hash") && !txt.includes("access_token"), "no salen huellas ni tokens");
console.log("ok  clave, permisos y datos que no salen");

// Link por cliente: abre solo ese cliente y no sirve para nada más.
const tokenDe = async (c, r = false) => (await q(`select public.portal_link_cliente('clave',$1,$2) t`, [c, r]))[0].t;
const tA = await tokenDe("a"), tB = await tokenDe("b");
assert.match(tA, /^[a-f0-9]{64}$/);
assert.notEqual(tA, tB);
assert.equal(await tokenDe("a"), tA, "volver a pedirlo devuelve el mismo link");
const propio = (await q(`select public.portal_mi_tablero($1,$2::date,$2::date) r`, [tA, hoy]))[0].r;
assert.equal(propio.cliente.id, "a");
assert.ok(propio.ordenes.length > 0);
const delEquipo = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
assert.deepEqual(propio.dias, delEquipo.dias, "los mismos números que ve el equipo");
assert.equal(propio.cliente.meta_accounts, undefined);
assert.equal(propio.cliente.tn_stores, undefined);
assert.equal(propio.tiendas[0].last_error, undefined);
assert.equal(propio.tiendas[0].store_id, undefined);
assert.equal(propio.tiendas[0].conectada, true);
const deB = (await q(`select public.portal_mi_tablero($1,$2::date,$2::date) r`, [tB, hoy]))[0].r;
assert.equal(deB.cliente.id, "b", "cada link abre su cliente");
assert.ok(!JSON.stringify(deB).includes("Cliente A"), "no aparece otro cliente");
await assert.rejects(q(`select public.portal_general($1,now()::date,now()::date)`, [tA]), /clave_invalida/);
await assert.rejects(q(`select public.portal_cliente($1,'b',now()::date,now()::date)`, [tA]), /clave_invalida/);
await assert.rejects(q(`select public.portal_cliente($1,'a',now()::date,now()::date)`, [tA]), /clave_invalida/);
await assert.rejects(q(`select public.portal_link_cliente($1,'b')`, [tA]), /clave_invalida/);
await assert.rejects(q(`select public.portal_mi_tablero('clave',now()::date,now()::date)`), /clave_invalida/, "la clave del equipo no entra por acá");
await assert.rejects(q(`select public.portal_mi_tablero('',now()::date,now()::date)`), /clave_invalida/);
await assert.rejects(q(`select public.portal_mi_tablero(null,now()::date,now()::date)`), /clave_invalida/);
await assert.rejects(q(`select public.portal_mi_tablero($1,'2020-01-01','2026-01-01')`, [tA]), /rango_invalido/);
const permLink = (await q(`select
  has_table_privilege('anon','public.client_links','select') tabla,
  has_function_privilege('anon','public.portal_cliente_datos(text,date,date,integer,integer)','execute') datos,
  has_function_privilege('anon','public.portal_mi_tablero(text,date,date,integer,integer)','execute') tablero`))[0];
assert.deepEqual(permLink, { tabla: false, datos: false, tablero: true });
const tA2 = await tokenDe("a", true);
assert.notEqual(tA2, tA);
await assert.rejects(q(`select public.portal_mi_tablero($1,now()::date,now()::date)`, [tA]), /clave_invalida/, "renovar corta el link viejo");
assert.equal((await q(`select public.portal_mi_tablero($1,$2::date,$2::date) r`, [tA2, hoy]))[0].r.cliente.id, "a");
await db.exec(`update public.clients set active=false where id='b'`);
await assert.rejects(q(`select public.portal_mi_tablero($1,now()::date,now()::date)`, [tB]), /cliente_inexistente/, "cliente dado de baja");
await db.exec(`update public.clients set active=true where id='b'`);
console.log("ok  link por cliente: abre solo ese cliente");

// Agencia: alertas, altas y bajas.
const ag = async () => (await q(`select public.portal_agencia('clave') r`))[0].r;
await db.exec(`insert into public.meta_state (account_id, last_ok_at) values ('m1', now()), ('m2', now()) on conflict (account_id) do update set last_ok_at = now(), last_error = null`);
let a0 = await ag();
const ficha = (r, id) => r.clientes.find((c) => c.id === id);
const horaBA = (await q(`select extract(hour from now() at time zone 'America/Argentina/Buenos_Aires')::int h`))[0].h;
assert.equal(a0.gasto_medible, horaBA >= 12, "sin foto solo se mide después del mediodía");
assert.equal(ficha(a0, "a").sin_gasto_12h, false, "gastó hoy");
await db.exec(`insert into public.clients (id,name,kind,meta_accounts) values ('z','Sin gastar','ecommerce','{m7}'); insert into public.meta_state (account_id, last_ok_at) values ('m7', now())`);
assert.equal(ficha(await ag(), "z").sin_gasto_12h, horaBA >= 12, "hoy en cero después del mediodía");
assert.ok(Number(ficha(a0, "a").inv_7) > 0, "inversión de la semana para el MER");
assert.equal(ficha(a0, "a").ult_venta, hoy);
assert.equal(ficha(a0, "a").dias_sin_venta, 0);
assert.ok(Number(ficha(a0, "a").inv_hoy) > 0);
assert.equal(ficha(a0, "x"), undefined, "los dados de baja no aparecen en alertas");
assert.ok(a0.tiendas_libres.every((t) => t.id !== "s1"), "tienda ya asignada no es libre");
// m1 gastó 300 hoy; la foto de hace 12 h ya decía 300: no gastó nada desde entonces. m2 no tiene foto: sí gastó.
await db.exec(`
  insert into public.meta_live (day,account_id,currency,spend,messages) values ('${hoy}','m2','ARS',50,0) on conflict do nothing;
  insert into public.meta_foto (tomada_at, day, account_id, spend) values (now() - interval '12 hours 20 minutes', '${hoy}', 'm1', 300);
`);
a0 = await ag();
assert.equal(a0.gasto_medible, true);
assert.equal(ficha(a0, "a").sin_gasto_12h, true, "el gasto no se movió en 12 horas");
assert.equal(ficha(a0, "b").sin_gasto_12h, false, "gastó en estas 12 horas");
assert.equal(ficha(a0, "z").sin_gasto_12h, true, "con foto, tampoco se movió");
await db.exec(`update public.meta_live set spend = 340 where day = '${hoy}' and account_id = 'm1'`);
assert.equal(ficha(await ag(), "a").sin_gasto_12h, false, "volvió a gastar");
await db.exec(`update public.meta_live set spend = 300 where day = '${hoy}' and account_id = 'm1'; update public.meta_state set last_error = 'x' where account_id = 'm1'`);
assert.equal(ficha(await ag(), "a").sin_gasto_12h, false, "si Meta no se puede leer, no se acusa a nadie");
await db.exec(`update public.meta_state set last_error = null where account_id = 'm1'`);
await q(`select public.meta_foto_tomar()`);
assert.ok((await q(`select count(*)::int n from public.meta_foto where account_id='m1'`))[0].n >= 2);
await db.exec(`insert into public.tn_installs (store_id, access_token, coverage_from, store_name) values ('libre','tok','${dia(2)}','Tienda libre')`);
assert.ok((await ag()).tiendas_libres.some((t) => t.id === "libre"));
// Bajas y altas
await q(`select public.portal_baja_cliente('clave','b','2026-11-01','Se fue por precio')`);
let a1 = await ag();
assert.equal(ficha(a1, "b"), undefined, "la baja sale de la agencia");
assert.equal((await q(`select public.portal_general('clave',$1::date,$1::date) r`, [hoy]))[0].r.clientes.some((c) => c.id === "b"), false, "y de General");
assert.deepEqual(a1.inactivos.filter((c) => c.id === "b").map((c) => c.name), ["Cliente B"]);
assert.equal(a1.movimientos[0].tipo, "baja");
assert.equal(a1.movimientos[0].motivo, "Se fue por precio");
await assert.rejects(q(`select public.portal_baja_cliente('clave','b')`), /cliente_inexistente/);
await q(`select public.portal_reactivar_cliente('clave','b',null,'Volvió')`);
a1 = await ag();
assert.ok(ficha(a1, "b"), "se puede revertir");
assert.equal(a1.movimientos[0].tipo, "alta");
const nuevo = (await q(`select public.portal_alta_cliente('clave','Niña Azul S.A.',false,'libre','act_12345678') id`))[0].id;
assert.equal(nuevo, "nina-azul-s-a");
const fichaNueva = (await q(`select * from public.clients where id=$1`, [nuevo]))[0];
assert.deepEqual(fichaNueva.tn_stores_portal, ["libre"]);
assert.deepEqual(fichaNueva.tn_stores, [], "no toca la carga de tiendas de MER View");
assert.deepEqual(fichaNueva.meta_accounts, ["12345678"]);
assert.equal(fichaNueva.kind, "sin_tienda");
await assert.rejects(q(`select public.portal_alta_cliente('clave','Niña Azul S.A.')`), /cliente_existente/);
await assert.rejects(q(`select public.portal_alta_cliente('clave','Otra',false,'libre')`), /tienda_no_disponible/);
await assert.rejects(q(`select public.portal_alta_cliente('clave','   ')`), /nombre_invalido/);
assert.equal((await q(`select public.portal_alta_cliente('clave','De leads',true) id`))[0].id, "de-leads");
// Permisos: ni el link de cliente ni una clave mala escriben nada.
const tCli = (await q(`select public.portal_link_cliente('clave','a') t`))[0].t;
await assert.rejects(q(`select public.portal_agencia($1)`, [tCli]), /clave_invalida/);
await assert.rejects(q(`select public.portal_baja_cliente($1,'a')`, [tCli]), /clave_invalida/);
await assert.rejects(q(`select public.portal_reactivar_cliente('mala','x')`), /clave_invalida/);
await assert.rejects(q(`select public.portal_alta_cliente('mala','Y')`), /clave_invalida/);
const pAg = (await q(`select has_table_privilege('anon','public.client_movimientos','select') m, has_table_privilege('anon','public.meta_foto','select') f, has_function_privilege('anon','public.meta_foto_tomar()','execute') t`))[0];
assert.deepEqual(pAg, { m: false, f: false, t: false });
console.log("ok  agencia: alertas, altas y bajas");

// Campañas B2B: solo en clientes marcados, reconocidas por el nombre.
const generalDe = async (id) => (await q(`select public.portal_general('clave',$1::date,$1::date) r`, [hoy]))[0].r.clientes.find((c) => c.id === id);
const clienteDe = async (id) => (await q(`select public.portal_cliente('clave',$1,$2::date,$2::date) r`, [id, hoy]))[0].r;
await q(`select public.meta_campanas_upsert($1::jsonb,$2::jsonb)`, [
  JSON.stringify([
    { campaign_id: "c1", account_id: "m1", name: "Ventas catálogo", objective: "OUTCOME_SALES" },
    { campaign_id: "c2", account_id: "m1", name: "Mensajes (b2b) mayorista", objective: "OUTCOME_ENGAGEMENT" },
    { campaign_id: "c3", account_id: "m1", name: "Interacción sin etiqueta", objective: "OUTCOME_SALES" },
  ]),
  JSON.stringify([
    { day: hoy, campaign_id: "c1", account_id: "m1", currency: "ARS", spend: 200, messages: 2 },
    { day: hoy, campaign_id: "c2", account_id: "m1", currency: "ARS", spend: 60, messages: 40 },
    { day: hoy, campaign_id: "c3", account_id: "m1", currency: "ARS", spend: 40, messages: 150 },
    { day: dia(8), campaign_id: "c2", account_id: "m1", currency: "ARS", spend: 10, messages: 1 },
  ]),
]);
let gA = await generalDe("a"), vA = await clienteDe("a");
assert.equal(Number(gA.spend_b2b), 0, "sin marcar no se separa nada");
assert.equal(Number(vA.dias[0].spend_b2b), 0);
assert.deepEqual(vA.campanas, [], "sin marcar no se muestran campañas");
const espTotal = Number(gA.spend);
await q(`select public.portal_b2b_marcar('clave','a',true)`);
gA = await generalDe("a"); vA = await clienteDe("a");
assert.equal(gA.separa_b2b, true);
assert.equal(Number(gA.spend), espTotal, "la inversión total sigue completa");
assert.equal(Number(gA.spend_b2b), 60, "suma solo la etiquetada, sin importar mayúsculas");
assert.equal(Number(gA.messages_b2b), 40);
assert.equal(Number(vA.dias[0].spend_b2b), 60);
assert.equal(vA.cliente.separa_b2b, true);
const camp = Object.fromEntries(vA.campanas.map((c) => [c.id, c]));
assert.equal(camp.c2.b2b, true);
assert.equal(camp.c2.parece_mensajes, false);
assert.equal(camp.c1.b2b, false);
assert.equal(camp.c1.parece_mensajes, false, "venta común no alerta");
assert.equal(camp.c3.parece_mensajes, true, "objetivo de ventas pero muchas conversaciones");
// Cambiar el nombre corrige también los días anteriores.
await q(`select public.meta_campanas_upsert($1::jsonb,'[]'::jsonb)`, [JSON.stringify([{ campaign_id: "c3", account_id: "m1", name: "Interacción (MSJ)", objective: "OUTCOME_SALES" }])]);
assert.equal(Number((await generalDe("a")).spend_b2b), 60, "(MSJ) ya no separa");
await q(`select public.meta_campanas_upsert($1::jsonb,'[]'::jsonb)`, [JSON.stringify([{ campaign_id: "c3", account_id: "m1", name: "Interacción (B2B)", objective: "OUTCOME_SALES" }])]);
assert.equal(Number((await generalDe("a")).spend_b2b), 100, "al etiquetarla, corrige los días anteriores");
const conPrevio = (await q(`select public.portal_cliente('clave','a',$1::date,$1::date) r`, [hoy]))[0].r;
assert.equal(Number(conPrevio.prev.spend_b2b), 0, "el período anterior de un día no tiene B2B");
const semana = (await q(`select public.portal_cliente('clave','a',$1::date,$2::date) r`, [dia(7), hoy]))[0].r;
assert.equal(Number(semana.prev.spend_b2b), 10, "el período anterior separa su B2B");
const hist = (await q(`select public.portal_historico('clave','a',$1::date,$2::date) r`, [dia(7), hoy]))[0].r;
assert.equal(Math.round(hist.dias.reduce((s, d) => s + Number(d.spend_b2b), 0)), Math.round(Number(semana.dias.reduce((s, d) => s + Number(d.spend_b2b), 0))), "el histórico separa lo mismo que la vista de cliente");
assert.equal(hist.dias.reduce((s, d) => s + Number(d.revenue), 0), semana.dias.reduce((s, d) => s + Number(d.revenue), 0), "el histórico da la misma facturación");
await assert.rejects(q(`select public.portal_historico('mala','a',$1::date,$2::date)`, [dia(7), hoy]), /clave_invalida/);
const agB = ficha(await ag(), "a");
assert.ok(Number(agB.inv_7) >= 0, "la caída de MER usa la inversión sin B2B");
// Permisos
const tA3 = (await q(`select public.portal_link_cliente('clave','a') t`))[0].t;
await assert.rejects(q(`select public.portal_b2b_marcar($1,'a',false)`, [tA3]), /clave_invalida/, "el link de cliente no marca nada");
await assert.rejects(q(`select public.portal_b2b_marcar('mala','a',false)`), /clave_invalida/);
await assert.rejects(q(`select public.portal_b2b_marcar('clave','noexiste',true)`), /cliente_inexistente/);
const pB = (await q(`select has_table_privilege('anon','public.meta_campana_dia','select') d, has_table_privilege('anon','public.meta_campanas','select') n, has_function_privilege('anon','public.portal_b2b(date,date)','execute') f, has_function_privilege('anon','public.meta_campanas_upsert(jsonb,jsonb)','execute') u`))[0];
assert.deepEqual(pB, { d: false, n: false, f: false, u: false });
await q(`select public.portal_b2b_marcar('clave','a',false)`);
assert.equal(Number((await generalDe("a")).spend_b2b), 0, "desmarcar vuelve todo atrás");
console.log("ok  campañas B2B: se separan por nombre solo en clientes marcados");

await db.exec(readFileSync(join(raiz, "supabase/rollback_portal.sql"), "utf8"));
await db.exec(`delete from public.clients where id in ('nina-azul-s-a','de-leads','z')`);
assert.equal((await q(`select count(*)::int n from public.clients`))[0].n, 4);
assert.equal((await q(`select to_regclass('public.tn_orders') t`))[0].t, null);
console.log("ok  la marcha atrás saca todo y deja MER View intacto");
