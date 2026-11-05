// Marca «regulado» en la ficha del ERP de los productos que deben llevar lote.
//
// Pedido del usuario (2026-11-05): «todos los productos deben llevar lote (a no
// ser que sea insumo), por trazabilidad». En el ERP eso es la casilla
// «regulado» de `editar_producto.php`: sin ella el producto vive en el lote
// GENERICO y ni la compra, ni el traslado, ni la recepción pueden decir qué
// lote es. Lo que ya está en GENERICO se queda así (decisión del usuario); lo
// que entre de aquí en adelante entra con su lote.
//
// Quién se marca lo decide la CATEGORÍA del ERP (INSUMOS, MEDICAMENTOS,
// FORMULAS…), no un adivino por nombre: es el dato que la propia empresa ya
// mantiene. Se pasa con `--categorias=2,3`.
//
// ── Por qué el guardado se reproduce entero ────────────────────────────────
// El ERP no tiene un «cambiar sólo regulado»: `senddata()` de
// `js/funciones/funciones_producto.js` manda la ficha COMPLETA —presentaciones
// con sus 7 precios y costo, descuentos, proveedor, categoría, casillas—. Así
// que se arma el mismo sobre a partir de la ficha recién leída, con un solo
// cambio (`regulado=1`), y después se vuelve a leer y se compara campo por
// campo contra la foto de antes. Una diferencia que no sea `regulado` FRENA la
// corrida entera: es la señal de que el sobre no reproduce bien el formulario
// y seguir sería pisar precios en cientos de fichas.
//
// Diferencia deliberada con el navegador: `senddata()` arma el cuerpo como
// texto SIN codificar, así que un «&» o un «+» en el nombre llega roto. Acá se
// codifica bien: el servidor recibe exactamente lo que la ficha tiene.
//
// Uso:
//   node scripts/erp/regulado-masivo.mjs leer                 → foto de todos los candidatos y resumen por categoría
//   node scripts/erp/regulado-masivo.mjs marcar --categorias=2 --ids=3932      → simula
//   node scripts/erp/regulado-masivo.mjs marcar --categorias=2 --ids=3932 --ejecutar
//   node scripts/erp/regulado-masivo.mjs marcar --categorias=2 --max=50 --ejecutar
//   (los no perecederos se saltan salvo --con-no-perecederos)
//
// Escribe su bitácora en `scripts/erp/salida/` (JSONL, una línea por producto).

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const RAIZ = new URL('../../', import.meta.url).pathname;
const SALIDA = `${RAIZ}scripts/erp/salida`;
const env = Object.fromEntries(readFileSync(`${RAIZ}.env`, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const BASE = 'https://clientesdte3.oss.com.sv/farma_salud';

const args = process.argv.slice(2);
const modo = args[0];
const opt = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const EJECUTAR = args.includes('--ejecutar');
// «Los productos sí llevan vencimiento, sólo los insumos no» (usuario, 2026-11-05):
// con esta opción también se activa «perecedero» al que no la tenga.
const CON_VENCE = args.includes('--perecedero');
// Lo contrario: QUITAR «regulado» (tarjetas, chips, vales… que nunca llevan
// lote). Sólo con --ids: una lista escrita a mano, nunca una categoría.
const QUITAR = args.includes('--quitar');

// ── Sesión en el ERP ─────────────────────────────────────────────────────────
let cookie = null;
async function login() {
    const r = await fetch(`${BASE}/login.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: env.ERP_USUARIO, password: env.ERP_PASSWORD, m: '1' }).toString(),
        redirect: 'manual',
    });
    cookie = r.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('No se pudo iniciar sesión en el sistema.');
}
async function pedir(url, cuerpo) {
    const r = await fetch(url, {
        method: cuerpo ? 'POST' : 'GET',
        headers: {
            Cookie: cookie, 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest',
            Referer: `${BASE}/admin_producto.php`,
            ...(cuerpo ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        },
        body: cuerpo, signal: AbortSignal.timeout(45000),
    });
    return r.text();
}

// ── Lectura de la ficha ──────────────────────────────────────────────────────
const des = (s) => String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const attr = (tag, nombre) => {
    const m = new RegExp(`\\b${nombre}=(["'])([\\s\\S]*?)\\1`).exec(tag);
    return m ? des(m[2]) : null;
};
const inputPorId = (html, id) =>
    new RegExp(`<input\\b[^>]*\\bid=["']${id}["'][^>]*>`).exec(html)?.[0] ?? null;
const valor = (html, id) => (attr(inputPorId(html, id) ?? '', 'value') ?? '');
const marcado = (html, id) => /\bchecked\b/.test(inputPorId(html, id) ?? '');
function seleccion(html, id) {
    const m = new RegExp(`<select[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
    if (!m) return { value: '', label: '' };
    const o = /<option[^>]*value=["']?([^"'>\s]*)["']?[^>]*\bselected\b[^>]*>([^<]*)/.exec(m[1]);
    // Sin `selected`, jQuery `.val()` devuelve la PRIMERA opción.
    const p = o ?? /<option[^>]*value=["']?([^"'>\s]*)["']?[^>]*>([^<]*)/.exec(m[1]);
    return p ? { value: p[1], label: des(p[2]).trim() } : { value: '', label: '' };
}
const celda = (fila, clase) => {
    const m = new RegExp(`<td[^>]*class=['"][^'"]*\\b${clase}\\b[^'"]*['"][^>]*>([\\s\\S]*?)</td>`).exec(fila);
    return m ? des(m[1]) : '';
};

export function leerFicha(id, html) {
    if (!inputPorId(html, 'descripcion')) throw new Error(`La ficha ${id} no se pudo leer (¿sesión vencida?).`);
    const idEnFicha = valor(html, 'id_producto').trim();
    if (idEnFicha !== String(id)) throw new Error(`La ficha pedida es ${id} y la página trae ${idEnFicha}.`);

    const tabla = /id=["']presentacion_table["'][^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
    const presentaciones = tabla.split(/<tr\b/i).slice(1).map(tr => {
        const fila = '<tr' + tr;
        return {
            exis: /^<tr[^>]*class=['"]exis['"]/.test(fila),
            id_prp: attr(/<input[^>]*class=['"]id_pres_prod['"][^>]*>/.exec(fila)?.[0] ?? '', 'value') ?? '0',
            id_pp: attr(/<input[^>]*class=['"]presentacion['"][^>]*>/.exec(fila)?.[0] ?? '', 'value') ?? '',
            des: celda(fila, 'descripcion_p'),
            unidad: celda(fila, 'unidad_p'),
            costo: celda(fila, 'costo'),
            bar: celda(fila, 'bar'),
            precios: [0, 1, 2, 3, 4, 5, 6].map(k => celda(fila, `precio${k}`)),
            oculta: /fa-eye-slash/.test(fila),
        };
    });
    const descuentos = [0, 1, 2, 3, 4, 5, 6].map(k =>
        attr(new RegExp(`<input[^>]*class=["'][^"']*\\bdesc${k}\\b[^"']*["'][^>]*>`).exec(html)?.[0] ?? '', 'value') ?? '0');
    const comp = /<textarea[^>]*\bid=["']composicion["'][^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';
    // `#ubi` y `#minimo` no existen en esta pantalla: el navegador manda
    // `minimo=undefined` y `json_arr=[]`. Si algún día aparecen, se frena.
    const conUbi = /\bid=["']ubi["']/.test(html) || /\bid=["']minimo["']/.test(html);

    return {
        id, nombre: valor(html, 'descripcion'), barcode: valor(html, 'barcode'), marca: valor(html, 'marca'),
        composicion: des(comp),
        proveedor: seleccion(html, 'proveedor'), categoria: seleccion(html, 'id_categoria'),
        laboratorio: seleccion(html, 'id_laboratorio'),
        exento: marcado(html, 'exento'), perecedero: marcado(html, 'perecedero'), activo: marcado(html, 'activo'),
        decimal: marcado(html, 'decimal'), regulado: marcado(html, 'regulado'), antibiotico: marcado(html, 'antibiotico'),
        presentaciones, descuentos, conUbi,
    };
}

/** El mismo sobre que arma `senddata()` con process=edited. */
function sobreDeEdicion(f, regulado, perecedero = f.perecedero) {
    const casilla = (b) => (b ? '1' : 'undefined');
    const num = (t) => { const n = parseFloat(t); return Number.isNaN(n) ? 0 : t; };
    const lista = f.presentaciones.map(p =>
        [p.id_pp, p.des, p.unidad, 0, p.exis ? p.id_prp : 0, p.costo, p.bar,
         p.precios.map(x => `${num(x)}#`).join('')].join(',') + ';').join('');
    const s = new URLSearchParams({
        process: 'edited', id_producto: String(f.id), barcode: f.barcode, descripcion: f.nombre,
        exento: casilla(f.exento), proveedor: f.proveedor.value, id_categoria: f.categoria.value,
        perecedero: casilla(perecedero), lista,
        marca: f.marca, minimo: 'undefined', cuantos: String(f.presentaciones.length),
        estado: f.activo ? '1' : '0', decimals: casilla(f.decimal), composicion: f.composicion,
        id_laboratorio: f.laboratorio.value, json_arr: '[]',
        regulado: regulado ? '1' : '0', antibiotico: f.antibiotico ? '1' : '0',
    });
    f.descuentos.forEach((d, i) => s.append(`desc${i}`, String(Number.isNaN(parseFloat(d)) ? 0 : parseFloat(d))));
    return s.toString();
}

/** Todo lo que NO debe cambiar, en texto comparable. */
const huella = (f) => JSON.stringify({ ...f, regulado: undefined, perecedero: CON_VENCE ? undefined : f.perecedero });

async function ficha(id) {
    // Leer sí se reintenta (no cambia nada); escribir NO: un POST que se cortó
    // pudo haber entrado, y se averigua releyendo la ficha.
    for (let intento = 1; ; intento++) {
        try { return leerFicha(id, await pedir(`${BASE}/editar_producto.php?id_producto=${id}`)); }
        catch (e) {
            if (intento >= 4) throw e;
            await new Promise(r => setTimeout(r, 3000 * intento));
            if (/sesión vencida/.test(e.message)) await login();
        }
    }
}

// ── Candidatos: activos y no regulados en el portal ─────────────────────────
async function candidatos() {
    const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const { error: eA } = await sb.auth.signInWithPassword({ email: `${env.E2E_USER}@farmalasa.app`, password: env.E2E_PASSWORD });
    if (eA) throw eA;
    const ids = [];
    for (let i = 0; ; i += 1000) {
        const { data, error } = await sb.from('products').select('id').eq('activo', true)
            .or('regulado.is.null,regulado.eq.false').order('id').range(i, i + 999);
        if (error) throw error;
        ids.push(...data.map(r => r.id));
        if (data.length < 1000) break;
    }
    return ids;
}

async function enParalelo(lista, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
        while (i < lista.length) { const x = lista[i++]; await fn(x); }
    }));
}

mkdirSync(SALIDA, { recursive: true });

if (modo === 'leer') {
    await login();
    const ids = opt('ids') ? opt('ids').split(',').map(Number) : await candidatos();
    console.log(`leyendo ${ids.length} fichas…`);
    const fichas = []; const fallos = [];
    let hechas = 0;
    await enParalelo(ids, 3, async (id) => {
        try { fichas.push(await ficha(id)); } catch (e) { fallos.push({ id, error: e.message }); }
        if (++hechas % 200 === 0) console.log(`  ${hechas}/${ids.length}`);
    });
    fichas.sort((a, b) => a.id - b.id);
    // Con --ids es una consulta puntual: NO pisa la foto general, que `marcar`
    // usa como lista de trabajo y como referencia tras un corte.
    const destino = opt('ids') ? `${SALIDA}/fichas-consulta.json` : `${SALIDA}/fichas.json`;
    writeFileSync(destino, JSON.stringify(fichas, null, 1));
    const porCat = {};
    for (const f of fichas) {
        const k = `${f.categoria.value} ${f.categoria.label}`;
        porCat[k] ??= { total: 0, regulado_en_erp: 0, inactivo_en_erp: 0, ejemplos: [] };
        porCat[k].total++;
        if (f.regulado) porCat[k].regulado_en_erp++;
        if (!f.activo) porCat[k].inactivo_en_erp++;
        if (porCat[k].ejemplos.length < 6) porCat[k].ejemplos.push(f.nombre);
    }
    console.table(Object.fromEntries(Object.entries(porCat).map(([k, v]) => [k, { total: v.total, ya_regulado: v.regulado_en_erp, inactivo: v.inactivo_en_erp }])));
    for (const [k, v] of Object.entries(porCat)) console.log(`${k}: ${v.ejemplos.join(' · ')}`);
    if (fallos.length) console.log('FALLOS', fallos);
    console.log(`foto en ${destino}`);
} else if (modo === 'marcar') {
    if (QUITAR && !opt('ids')) throw new Error('--quitar sólo con --ids=… (una lista revisada, nunca una categoría).');
    const cats = (opt('categorias') ?? '').split(',').filter(Boolean);
    if (!cats.length) throw new Error('Falta --categorias=… (ids de categoría del sistema).');
    const max = Number(opt('max') ?? Infinity);
    const fotos = existsSync(`${SALIDA}/fichas.json`) ? JSON.parse(readFileSync(`${SALIDA}/fichas.json`, 'utf8')) : [];
    let ids = opt('ids') ? opt('ids').split(',').map(Number)
        : fotos.filter(f => cats.includes(f.categoria.value) && !f.regulado && f.activo
            && (f.perecedero || CON_VENCE || args.includes('--con-no-perecederos'))).map(f => f.id);
    const bitacora = `${SALIDA}/marcar-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const hechos = new Set(existsSync(bitacora) ? readFileSync(bitacora, 'utf8').split('\n').filter(Boolean)
        .map(l => JSON.parse(l)).filter(x => x.resultado === 'marcado').map(x => x.id) : []);
    ids = ids.filter(id => !hechos.has(id)).slice(0, max);
    console.log(`${EJECUTAR ? 'MARCANDO' : 'SIMULANDO'} ${ids.length} producto(s) · categorías ${cats.join(',')}`);
    await login();
    let ok = 0, seguidos = 0;
    for (const id of ids) {
        await new Promise(r => setTimeout(r, 250));   // no apurar al sistema
        let antes;
        try { antes = await ficha(id); }
        catch (e) {
            console.log(`! ${id}: no se pudo leer (${e?.cause?.code ?? e.message})`);
            if (++seguidos >= 5) { console.log('5 errores seguidos: el sistema no está respondiendo. FRENO.'); process.exit(1); }
            await new Promise(r => setTimeout(r, 10000)); await login().catch(() => {});
            continue;
        }
        const anotar = (resultado, extra = {}) => appendFileSync(bitacora,
            JSON.stringify({ id, nombre: antes.nombre, categoria: antes.categoria.label, resultado, ...extra, at: new Date().toISOString() }) + '\n');
        if (QUITAR) {
            if (!antes.regulado) { console.log(`= ${id} ${antes.nombre}: ya no era regulado`); continue; }
        } else if (antes.regulado && (antes.perecedero || !CON_VENCE)) {
            // ¿Lo marcó una corrida que se cortó entre el guardado y la relectura?
            // Se compara contra la foto de `leer` para no dejarlo sin verificar.
            const foto = fotos.find(f => f.id === id);
            if (foto && !foto.regulado) {
                if (huella(antes) !== huella(foto)) { console.log(`✗ ${id} ${antes.nombre}: quedó regulado pero distinto a la foto. FRENO.`); anotar('diferencia', { antes: foto, despues: antes }); process.exit(1); }
                anotar('marcado', { nota: 'verificado contra la foto tras un corte' });
            }
            console.log(`= ${id} ${antes.nombre}: ya era regulado`); continue;
        }
        if (!cats.includes(antes.categoria.value)) { console.log(`- ${id} ${antes.nombre}: categoría ${antes.categoria.label}, no se toca`); continue; }
        if (!antes.activo) { console.log(`- ${id} ${antes.nombre}: inactivo en el sistema, no se toca`); continue; }
        // Sin vencimiento no hay lote que controlar: en «MEDICAMENTOS» así caen
        // cremas, cepillos y colorantes mal categorizados. Se listan aparte.
        if (!QUITAR && !antes.perecedero && !CON_VENCE && !args.includes('--con-no-perecederos')) { console.log(`- ${id} ${antes.nombre}: no perecedero, se deja para revisar`); anotar('omitido', { motivo: 'no perecedero' }); continue; }
        if (antes.conUbi) { console.log(`✗ ${id}: la pantalla trae campos que el sobre no conoce. FRENO.`); anotar('freno', { motivo: 'campos nuevos' }); process.exit(1); }
        if (!antes.presentaciones.length) { console.log(`- ${id} ${antes.nombre}: sin presentaciones, el formulario no guarda`); continue; }
        const cuerpo = sobreDeEdicion(antes, !QUITAR, antes.perecedero || CON_VENCE);
        if (!EJECUTAR) { console.log(`· ${id} ${antes.nombre} [${antes.categoria.label}] → ${cuerpo.length} bytes`); continue; }

        let resp;
        try { resp = await pedir(`${BASE}/editar_producto.php`, cuerpo); }
        catch (e) {
            // La conexión se cayó con el guardado en vuelo: pudo haber entrado.
            // No se reenvía: se averigua releyendo, después de una pausa.
            await new Promise(r => setTimeout(r, 10000));
            await login();
            const ahora = await ficha(id);
            if (ahora.regulado && huella(ahora) === huella(antes)) { anotar('marcado', { nota: 'entró pese al corte' }); ok++; seguidos = 0; console.log(`✓ ${id} ${antes.nombre} (tras corte)`); continue; }
            if (ahora.regulado) { console.log(`✗ ${id} ${antes.nombre}: quedó distinta tras un corte. FRENO.`); anotar('diferencia', { antes, despues: ahora }); process.exit(1); }
            anotar('error', { error: String(e?.cause?.code ?? e.message) });
            console.log(`! ${id} ${antes.nombre}: no entró (${e?.cause?.code ?? e.message}); se reintenta en otra corrida`);
            if (++seguidos >= 5) { console.log('5 errores seguidos: el sistema no está respondiendo. FRENO.'); process.exit(1); }
            continue;
        }
        let j = null; try { j = JSON.parse(resp); } catch { /* abajo */ }
        if (!j || !/success/i.test(j.typeinfo ?? '')) {
            console.log(`✗ ${id} ${antes.nombre}: el sistema no lo aceptó — ${j?.msg ?? resp.slice(0, 200)}. FRENO.`);
            anotar('rechazado', { respuesta: j?.msg ?? resp.slice(0, 500) });
            process.exit(1);
        }
        const despues = await ficha(id);
        if (despues.regulado === QUITAR || (CON_VENCE && !despues.perecedero) || huella(despues) !== huella(antes)) {
            console.log(`✗ ${id} ${antes.nombre}: la ficha quedó distinta. FRENO.`);
            anotar('diferencia', { antes, despues });
            process.exit(1);
        }
        anotar(QUITAR ? 'quitado' : 'marcado');
        ok++; seguidos = 0;
        console.log(`✓ ${id} ${antes.nombre} [${antes.categoria.label}]${QUITAR ? ' — sin lote' : ''}`);
    }
    console.log(`${ok} ${QUITAR ? "quitado(s)" : "marcado(s)"}. Bitácora: ${bitacora}`);
} else {
    console.log('uso: leer | marcar --categorias=… [--ids=…] [--max=N] [--ejecutar]');
}
