#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// `npm run verificar:recepcion` — ¿lo que la sala dio por recibido está en el
// inventario?
//
// POR QUÉ EXISTE. Confirmar la recepción hace DOS cosas que se guardan en dos
// sitios distintos: marca el renglón recibido en el portal (`pedido_items`) y
// mete el producto al inventario de la sala (una línea de `pedido_traslado_linea`
// que pasa a `recibida`). La primera no puede fallar sin que se note —la pantalla
// se queda—; la segunda sí: va en su propio `try` a propósito, porque un tropiezo
// del otro lado no puede deshacer un conteo que ya se guardó.
//
// O sea que el estado «lo conté, y NO entró» existe por diseño, es el único que
// deja a la sala sin poder facturar, y hasta hoy no se veía en ninguna pantalla:
// el aviso era un toast que se va solo, la píldora de la tarjeta sólo habla del
// despacho, y `resumen_traslado_pedido` —que calcula justo esto— no la llamaba
// nadie. Este script es el instrumento que faltaba.
//
// LO QUE MIDE, y por qué cada clase es distinta:
//
//   1. SIN INGRESAR  · el portal dice recibido y la línea quedó en 'enviada'.
//      Es EL fallo: el producto salió de bodega, la sala lo contó y el inventario
//      no lo tiene. Se arregla reintentando la recepción — la función sólo toca
//      las líneas 'enviada', así que reintentar es seguro por construcción.
//
//   2. SIN LÍNEA     · el portal dice recibido y no hay línea que lo respalde,
//      en un pedido que SÍ despachó por el sistema. Bodega nunca creó su
//      traslado: reintentar no lo arregla, hay que mirar el despacho.
//
//   3. ENTRÓ SIN CONFIRMAR · la línea dice 'recibida' y el renglón no. El
//      inverso, y son dos casos que no se parecen en nada:
//        · el renglón sigue 'pendiente' → el portal lo espera y ya está adentro;
//        · el renglón está 'anulado'    → el pedido se anuló DESPUÉS de que el
//          producto entró, así que la sala tiene existencias que ningún pedido
//          respalda. Confundir los dos fue el primer defecto de este script: el
//          #102 salió como «pendiente» y era un anulado.
//
//   4. LÍNEAS CON ERROR O AVISO · lo que el otro lado contestó y quedó anotado.
//
// LO QUE NO CUENTA COMO FALLO:
//   · `cantidad_asignada = 0` — esos renglones NACEN en 'recibido' cuando se crea
//     el pedido (todos con el mismo `received_at` y `received_by` NULL). No son
//     una recepción y no tienen nada que trasladar. Medido en el #114: 176 de
//     310 eran de éstos, y contarlos habría dado una alarma falsa del 57%.
//   · Los pedidos SIN una sola línea de traslado — se despacharon a mano, que es
//     todo lo anterior al 2026-08-11. No hay circuito que verificar ahí.
//
// USO
//   npm run verificar:recepcion              # todos los pedidos con traslado
//   npm run verificar:recepcion -- --pedido 114
//   npm run verificar:recepcion -- --detalle # lista renglón por renglón
//
// Sale con código 1 si encuentra algo de la clase 1 o 2 — lo que deja a una sala
// sin producto. Las clases 3 y 4 se informan y no tumban la corrida.
//
// REQUIERE  E2E_USER / E2E_PASSWORD del `.env` (la cuenta de QA). Es de sólo
// lectura: no escribe una fila.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const RAIZ = new URL('..', import.meta.url).pathname;
const env = Object.fromEntries(
    readFileSync(`${RAIZ}.env`, 'utf8')
        .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const SOLO_PEDIDO = arg('pedido') ? Number(arg('pedido')) : null;
const DETALLE     = process.argv.includes('--detalle');

const C = { rojo: '\x1b[31m', verde: '\x1b[32m', amar: '\x1b[33m', gris: '\x1b[90m', neg: '\x1b[1m', off: '\x1b[0m' };

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({
    email: `${env.E2E_USER}@farmalasa.app`, password: env.E2E_PASSWORD,
});
if (authErr) { console.error(`No se pudo entrar con la cuenta de QA: ${authErr.message}`); process.exit(2); }

// PostgREST corta en 1000 filas sin avisar (ver CLAUDE.md). Acá se pagina
// siempre, aunque hoy la tabla tenga 137 filas: el día que cruce el corte, un
// verificador truncado diría «todo bien» sobre la mitad de los datos, que es el
// peor modo de fallar que puede tener un verificador.
async function todas(tabla, columnas, aplicar = q => q) {
    const filas = []; const PASO = 1000;
    for (let desde = 0; ; desde += PASO) {
        const { data, error } = await aplicar(sb.from(tabla).select(columnas)).range(desde, desde + PASO - 1);
        if (error) { console.error(`No se pudo leer ${tabla}: ${error.message}`); process.exit(2); }
        filas.push(...(data ?? []));
        if ((data?.length ?? 0) < PASO) return filas;
    }
}

// ── Lo que hay ──────────────────────────────────────────────────────────────
const lineas = await todas('pedido_traslado_linea',
    'id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad, clave, estado, id_traslado, error_msg, aviso, recibido_at');

if (!lineas.length) {
    console.log('\nNingún pedido despachó por el sistema todavía — no hay circuito que verificar.\n');
    process.exit(0);
}

const pedidoIds = [...new Set(lineas.map(l => l.pedido_id))];
const [pedidos, items, mapas] = await Promise.all([
    todas('pedidos', 'id, numero, status', q => q.in('id', pedidoIds)),
    // Sólo los renglones que de verdad se despacharon. Los de cantidad 0 nacen
    // 'recibido' y no tienen traslado — ver el encabezado.
    todas('pedido_items', 'id, pedido_id, erp_sucursal_id, status, cantidad_asignada, cantidad_enviada, received_at, falta_caja, products(nombre)',
        q => q.in('pedido_id', pedidoIds).gt('cantidad_asignada', 0)),
    todas('erp_sucursal_map', 'erp_sucursal_id, branches(name)'),
]);

const numeroDe = Object.fromEntries(pedidos.map(p => [p.id, p.numero]));
const salaDe   = Object.fromEntries(mapas.map(m => [m.erp_sucursal_id, m.branches?.name ?? `sucursal ${m.erp_sucursal_id}`]));
const lineaDe  = new Map(lineas.map(l => [`${l.pedido_item_id}_${l.erp_sucursal_id}`, l]));

// ── El cruce, por pedido y sala ─────────────────────────────────────────────
const grupos = new Map();
const grupo = (pedidoId, sucId) => {
    const k = `${pedidoId}_${sucId}`;
    if (!grupos.has(k)) grupos.set(k, {
        pedidoId, sucId, numero: numeroDe[pedidoId] ?? '?', sala: salaDe[sucId] ?? `sucursal ${sucId}`,
        confirmados: 0, ingresados: 0, sinIngresar: [], sinLinea: [],
        entroSinConfirmar: [], entroYSeAnulo: [], conError: [], conAviso: [],
    });
    return grupos.get(k);
};
// Sólo las combinaciones pedido+sala que despacharon por el sistema: en un
// pedido de 6 salas puede haber una sola con traslado.
const conTraslado = new Set(lineas.map(l => `${l.pedido_id}_${l.erp_sucursal_id}`));

for (const it of items) {
    const k = `${it.pedido_id}_${it.erp_sucursal_id}`;
    if (!conTraslado.has(k)) continue;
    if (SOLO_PEDIDO && numeroDe[it.pedido_id] !== SOLO_PEDIDO) continue;
    const g = grupo(it.pedido_id, it.erp_sucursal_id);
    const l = lineaDe.get(`${it.id}_${it.erp_sucursal_id}`);
    const confirmado = ['recibido', 'con_diferencia'].includes(it.status);

    if (confirmado) {
        g.confirmados++;
        if (!l)                        g.sinLinea.push({ it });
        else if (l.estado === 'recibida') g.ingresados++;
        else                           g.sinIngresar.push({ it, l });
    } else if (l?.estado === 'recibida') {
        (it.status === 'anulado' ? g.entroYSeAnulo : g.entroSinConfirmar).push({ it, l });
    }
}
for (const l of lineas) {
    if (SOLO_PEDIDO && numeroDe[l.pedido_id] !== SOLO_PEDIDO) continue;
    const g = grupo(l.pedido_id, l.erp_sucursal_id);
    if (l.estado === 'error') g.conError.push(l);
    if (l.aviso)              g.conAviso.push(l);
}

// ── El informe ──────────────────────────────────────────────────────────────
const filas = [...grupos.values()].sort((a, b) => b.numero - a.numero || a.sucId - b.sucId);
console.log(`\n${C.neg}Recepción vs. inventario${C.off}  ${C.gris}· ${filas.length} pedido(s) con traslado por el sistema${C.off}\n`);

let graves = 0, leves = 0;
for (const g of filas) {
    const roto = g.sinIngresar.length + g.sinLinea.length;
    const raro = g.entroSinConfirmar.length + g.entroYSeAnulo.length;
    const marca = roto > 0 ? `${C.rojo}✗${C.off}` : raro > 0 ? `${C.amar}!${C.off}` : `${C.verde}✓${C.off}`;
    graves += roto;
    leves  += raro;

    console.log(`  ${marca} ${C.neg}#${g.numero}${C.off} · ${g.sala.padEnd(12)} `
        + `${String(g.confirmados).padStart(4)} confirmados · ${String(g.ingresados).padStart(4)} en el inventario`
        + (roto > 0 ? `  ${C.rojo}${roto} SIN INGRESAR${C.off}` : ''));

    if (g.sinIngresar.length) {
        const porEstado = {};
        g.sinIngresar.forEach(({ l }) => { porEstado[l.estado] = (porEstado[l.estado] ?? 0) + 1; });
        console.log(`      ${C.rojo}${g.sinIngresar.length} renglón(es) contados cuyo traslado quedó en `
            + `${Object.entries(porEstado).map(([e, n]) => `'${e}' (${n})`).join(', ')}${C.off}`
            + ` ${C.gris}— reintentar la recepción los ingresa${C.off}`);
        if (DETALLE) g.sinIngresar.forEach(({ it, l }) =>
            console.log(`        ${C.gris}H${l.hoja ?? '?'} · ${it.products?.nombre ?? it.id} · ${l.cantidad} · ${l.error_msg ?? l.estado}${C.off}`));
    }
    if (g.sinLinea.length) {
        console.log(`      ${C.rojo}${g.sinLinea.length} renglón(es) contados SIN traslado que los respalde${C.off}`
            + ` ${C.gris}— bodega nunca los despachó por el sistema; reintentar no alcanza${C.off}`);
        if (DETALLE) g.sinLinea.forEach(({ it }) =>
            console.log(`        ${C.gris}${it.products?.nombre ?? it.id} · asignado ${it.cantidad_asignada}${C.off}`));
    }
    if (g.entroSinConfirmar.length) {
        console.log(`      ${C.amar}${g.entroSinConfirmar.length} renglón(es) ya en el inventario que el portal sigue dando por pendientes${C.off}`);
        if (DETALLE) g.entroSinConfirmar.forEach(({ it, l }) =>
            console.log(`        ${C.gris}H${l.hoja ?? '?'} · ${it.products?.nombre ?? it.id}${it.falta_caja ? ' · marcado falta_caja' : ''}${C.off}`));
    }
    if (g.entroYSeAnulo.length) {
        console.log(`      ${C.amar}${g.entroYSeAnulo.length} renglón(es) entraron al inventario y después se anuló el pedido${C.off}`
            + ` ${C.gris}— la sala tiene existencias que ningún pedido respalda${C.off}`);
        if (DETALLE) g.entroYSeAnulo.forEach(({ it, l }) =>
            console.log(`        ${C.gris}H${l.hoja ?? '?'} · ${it.products?.nombre ?? it.id} · ${l.cantidad}${C.off}`));
    }
    if (g.conError.length) console.log(`      ${C.rojo}${g.conError.length} línea(s) en error${C.off} ${C.gris}— ${g.conError[0].error_msg ?? 'sin detalle'}${C.off}`);
    if (g.conAviso.length) console.log(`      ${C.amar}${g.conAviso.length} línea(s) con aviso${C.off} ${C.gris}— ${g.conAviso[0].aviso}${C.off}`);
}

console.log('');
if (graves === 0 && leves === 0) {
    console.log(`${C.verde}✓ Todo lo que la sala dio por recibido está en el inventario.${C.off}\n`);
    process.exit(0);
}
if (graves === 0) {
    console.log(`${C.amar}! Nada quedó sin ingresar. Hay ${leves} renglón(es) que entraron al inventario sin que el portal los cuente como recibidos.${C.off}\n`);
    process.exit(0);
}
console.log(`${C.rojo}✗ ${graves} renglón(es) se dieron por recibidos y NO están en el inventario.${C.off}`);
console.log(`${C.gris}  La sala no los puede facturar. Correr con --detalle para ver cuáles.${C.off}\n`);
process.exit(1);
