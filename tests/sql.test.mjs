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

await db.exec(readFileSync(join(raiz, "supabase/rollback_portal.sql"), "utf8"));
assert.equal((await q(`select count(*)::int n from public.clients`))[0].n, 4);
assert.equal((await q(`select to_regclass('public.tn_orders') t`))[0].t, null);
console.log("ok  la marcha atrás saca todo y deja MER View intacto");
