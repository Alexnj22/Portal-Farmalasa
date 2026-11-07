/**
 * Lo que Saly necesita para LEER los resultados de una encuesta a clientes
 * (pedido del usuario 2026-11-07: «el portal no me dice nada, sólo me dice
 * tantas; debe ser inteligente»).
 *
 * La IA no cuenta: los números se los da esto, ya calculados, y ella los
 * interpreta. Lo que la pantalla no muestra y vale la pena decir son los
 * CRUCES: «entre quienes nos eligen por precio, el 64 % no conoce la app,
 * contra 38 % en general». Se calculan todos contra todos —preguntas
 * cerradas, sucursal y canal— y sólo viajan los que se apartan del total con
 * un grupo de tamaño suficiente. Determinista y probado: lo que Saly cita es
 * un número que existe.
 *
 * Puro: sin red ni navegador (lo usan el portal y, mañana, la app).
 */
import { ACUERDO, CARITAS, opcionesConTexto, preguntasEnOrden } from './encuestasClientes';

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const recortar = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Las preguntas que se pueden cruzar, con cómo se lee la categoría de cada
 * respuesta. El NPS se agrupa en promotor / pasivo / detractor: once columnas
 * de 0 a 10 no dicen nada con pocas respuestas.
 */
export function dimensionesCruzables(cuestionario) {
    const dims = [];
    for (const p of preguntasEnOrden(cuestionario)) {
        const nombre = `P${p.numero}. ${recortar(p.texto, 90)}`;
        switch (p.tipo) {
            case 'nps':
                dims.push({ id: p.id, nombre, multiple: false, de: (v) => {
                    const n = Number(v);
                    if (v === null || v === undefined || v === '' || Number.isNaN(n)) return [];
                    return [n >= 9 ? 'Promotor (9-10)' : n >= 7 ? 'Pasivo (7-8)' : 'Detractor (0-6)'];
                } });
                break;
            case 'csat':
                dims.push({ id: p.id, nombre, multiple: false, de: (v) => {
                    const c = CARITAS.find((x) => x.valor === Number(v));
                    return c ? [c.label] : [];
                } });
                break;
            case 'likert':
                dims.push({ id: p.id, nombre, multiple: false, de: (v) => (ACUERDO[Number(v) - 1] ? [ACUERDO[Number(v) - 1]] : []) });
                break;
            case 'si_no':
                dims.push({ id: p.id, nombre, multiple: false, de: (v) => (v === true ? ['Sí'] : v === false ? ['No'] : []) });
                break;
            case 'unica':
            case 'multiple': {
                const rot = Object.fromEntries(opcionesConTexto(p).map((o) => [o.id, recortar(o.texto, 60)]));
                dims.push({ id: p.id, nombre, multiple: p.tipo === 'multiple', de: (v) => {
                    const ids = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v];
                    return ids.map((id) => rot[id]).filter(Boolean);
                } });
                break;
            }
            default:
        }
    }
    return dims;
}

/** Las categorías de una fila en una dimensión. `respuestas` es el jsonb de la fila. */
const categorias = (dim, fila) => dim.de(fila.respuestas?.[dim.id]);

/**
 * Los cruces que se apartan del total. Para cada par (A, B) y cada categoría
 * `a` de A con al menos `minGrupo` respuestas: el % de ese grupo que eligió
 * cada categoría `b` de B, contra el % de todos los que contestaron B. Se
 * queda con las diferencias de `umbral` puntos o más, las más grandes primero
 * y una sola por par de categorías.
 *
 * @returns {{ grupo: string, enGrupo: string, n: number, pctGrupo: number, pctTotal: number, diferencia: number, texto: string }[]}
 */
export function crucesNotables(cuestionario, filas, { extras = [], minGrupo = 5, umbral = 15, max = 15 } = {}) {
    const dims = [...extras, ...dimensionesCruzables(cuestionario)];
    const lista = filas || [];
    const cats = new Map(dims.map((d) => [d, lista.map((f) => categorias(d, f))]));
    const hallazgos = [];
    for (const A of dims) {
        const ca = cats.get(A);
        const grupos = new Map();
        ca.forEach((cs, i) => cs.forEach((c) => { if (!grupos.has(c)) grupos.set(c, []); grupos.get(c).push(i); }));
        for (const B of dims) {
            if (B === A) continue;
            const cb = cats.get(B);
            // El total de B: quienes la contestaron.
            const contestaron = cb.reduce((n, cs) => n + (cs.length ? 1 : 0), 0);
            if (contestaron < minGrupo) continue;
            const totalPor = new Map();
            cb.forEach((cs) => cs.forEach((c) => totalPor.set(c, (totalPor.get(c) || 0) + 1)));
            for (const [a, idx] of grupos) {
                const enAmbas = idx.filter((i) => cb[i].length);
                if (enAmbas.length < minGrupo) continue;
                // Un grupo que es casi todo el total no se aparta de nada.
                if (enAmbas.length > contestaron * 0.85) continue;
                const cuenta = new Map();
                enAmbas.forEach((i) => cb[i].forEach((c) => cuenta.set(c, (cuenta.get(c) || 0) + 1)));
                for (const [b, tot] of totalPor) {
                    const nb = cuenta.get(b) || 0;
                    const pg = pct(nb, enAmbas.length);
                    const pt = pct(tot, contestaron);
                    const dif = pg - pt;
                    if (Math.abs(dif) < umbral) continue;
                    hallazgos.push({
                        grupo: `${A.nombre} = «${a}»`, enGrupo: `${B.nombre} = «${b}»`, n: enAmbas.length,
                        pctGrupo: pg, pctTotal: pt, diferencia: dif,
                        clave: [A.id, a, B.id, b].join('|'), par: [A.id, a, B.id, b].sort().join('|'),
                        texto: `Entre quienes respondieron ${A.nombre} = «${a}» (${enAmbas.length} respuestas), el ${pg} % eligió «${b}» en ${B.nombre}, contra ${pt} % en general.`,
                    });
                }
            }
        }
    }
    // A→B y B→A dicen lo mismo con otras palabras: queda la de mayor diferencia.
    const vistos = new Set();
    return hallazgos
        .sort((x, y) => Math.abs(y.diferencia) - Math.abs(x.diferencia) || y.n - x.n)
        .filter((h) => (vistos.has(h.par) ? false : (vistos.add(h.par), true)))
        .slice(0, max)
        .map(({ clave, par, ...h }) => h); // eslint-disable-line no-unused-vars -- `clave`/`par` sólo sirven para ordenar
}

/**
 * La sucursal y el canal también son dimensiones: ¿Salud 2 se aparta del
 * resto? Sólo cuando hay más de uno. Leen `respuestas._sucursal` /
 * `respuestas._canal`, que `paqueteParaSaly` copia de la fila.
 */
export function dimensionesDeContexto(filas) {
    const lista = filas || [];
    const de = (v) => (v ? [String(v)] : []);
    return [['_sucursal', 'Sucursal', 'sucursal'], ['_canal', 'Canal', 'canal']]
        .filter(([, , campo]) => new Set(lista.map((f) => f[campo]).filter(Boolean)).size > 1)
        .map(([id, nombre]) => ({ id, nombre, multiple: false, de }));
}

/**
 * El paquete que viaja a Saly: los números ya contados, los cruces notables,
 * los lugares de campo y los comentarios (sin nombres ni teléfonos).
 */
export function paqueteParaSaly({ encuesta, datos, filas = [], comentarios = [], lugares = [], filtro = null }) {
    const preguntas = preguntasEnOrden(encuesta?.cuestionario);
    const porId = Object.fromEntries((datos?.por_pregunta || []).map((p) => [p.id, p]));
    const resumenPreguntas = preguntas.filter((p) => p.tipo !== 'texto').map((p) => {
        const d = porId[p.id] || {};
        const total = d.respuestas || 0;
        const base = { n: p.numero, texto: recortar(p.texto, 160), tipo: p.tipo, respuestas: total };
        if (d.puntaje != null) base.puntaje_0_100 = d.puntaje;
        if (p.tipo === 'numero') return { ...base, promedio: d.promedio ?? null };
        if (p.tipo === 'ranking') {
            const rot = Object.fromEntries(opcionesConTexto(p).map((o) => [o.id, recortar(o.texto, 60)]));
            return { ...base, orden_promedio: Object.entries(d.ranking || {}).sort((a, b) => a[1] - b[1]).map(([id, pos]) => `${rot[id] || id} (${pos})`) };
        }
        const dim = dimensionesCruzables({ secciones: [{ preguntas: [p] }] })[0];
        if (!dim) return base;
        // La distribución se recuenta de las filas con la MISMA regla que los cruces
        // (NPS agrupado); el total de la base manda si no hay filas.
        const cuenta = new Map();
        let contestaron = 0;
        for (const f of filas) {
            const cs = dim.de(f.respuestas?.[p.id]);
            if (cs.length) contestaron += 1;
            cs.forEach((c) => cuenta.set(c, (cuenta.get(c) || 0) + 1));
        }
        const dist = [...cuenta].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c}: ${k} (${pct(k, contestaron)} %)`);
        return { ...base, respuestas: contestaron || total, ...(p.tipo === 'multiple' ? { nota: 'varias por persona: los % son sobre personas' } : {}), distribucion: dist };
    });

    const filasConContexto = filas.map((f) => ({ ...f, respuestas: { ...(f.respuestas || {}), _sucursal: f.sucursal, _canal: f.canal } }));
    const ctx = dimensionesDeContexto(filas);

    return {
        encuesta: recortar(encuesta?.nombre, 120),
        objetivo: recortar(encuesta?.objetivo, 400) || null,
        filtro: filtro || 'todas las sucursales',
        total: datos?.total ?? filas.length,
        por_canal: datos?.por_canal || {},
        nps: datos?.nps?.respuestas ? {
            puntaje: datos.nps.puntaje, promotores: datos.nps.promotores, pasivos: datos.nps.pasivos,
            detractores: datos.nps.detractores, respuestas: datos.nps.respuestas,
        } : null,
        por_tema: (datos?.por_dimension || []).map((d) => `${d.nombre}: ${d.puntaje}/100 (${d.respuestas} resp.)`),
        por_sucursal: (datos?.por_sucursal || []).map((s) => `${s.nombre}: ${s.respuestas} resp.${s.nps != null ? `, NPS ${s.nps}` : ''}`),
        preguntas: resumenPreguntas,
        cruces: crucesNotables(encuesta?.cuestionario, filasConContexto, { extras: ctx }).map((c) => c.texto),
        lugares_de_campo: (lugares || []).slice(0, 15).map((l) => `${recortar(l.lugar, 60)}: ${l.respuestas} resp.${l.nps != null ? `, NPS ${l.nps}` : ''}`),
        comentarios: (comentarios || []).slice(0, 60).map((c) => `[${recortar(c.sucursal, 40)}${c.nps != null ? ` · ${c.nps}/10` : ''}] ${recortar(c.texto, 250)}`),
    };
}

/** Si la lectura se puede (re)hacer: no hay una, o entraron las respuestas nuevas mínimas. */
export function estadoDeLectura(lectura) {
    const hay = !!lectura?.texto;
    const nuevas = lectura?.nuevas ?? 0;
    const minimo = lectura?.minimo_nuevas ?? 5;
    const respuestas = lectura?.respuestas ?? 0;
    const puede = respuestas > 0 && (!hay || nuevas >= minimo);
    return {
        hay, nuevas, puede,
        boton: !hay ? 'Pedirle a Saly que lea los resultados' : puede ? `Actualizar lectura (${nuevas} nuevas)` : 'Lectura al día',
        ayuda: hay && !puede ? `Se actualiza cuando entren ${minimo} respuestas nuevas (van ${nuevas}).` : null,
    };
}

/**
 * La lectura de Saly, en bloques para pintarla: `**Título:**` abre un bloque y
 * cada renglón que empieza con `*`, `-` o `•` es un punto. Un texto sin
 * títulos queda como un solo bloque sin título. Tolera el título y el texto en
 * la misma línea («**En pocas palabras:** Son resultados…»).
 *
 * @returns {{ titulo: string|null, clave: string, texto: string, puntos: string[] }[]}
 */
export function bloquesDeLectura(texto) {
    const bloques = [];
    let actual = null;
    const nuevo = (titulo) => {
        actual = { titulo, clave: claveDeBloque(titulo), texto: '', puntos: [] };
        bloques.push(actual);
    };
    for (const cruda of String(texto || '').split('\n')) {
        let linea = cruda.trim();
        if (!linea) continue;
        const t = linea.match(/^\*\*(.+?):?\*\*:?\s*(.*)$/);
        if (t) {
            nuevo(t[1].replace(/:$/, '').trim());
            linea = t[2].trim();
            if (!linea) continue;
        }
        if (!actual) nuevo(null);
        const punto = linea.match(/^(?:[*•-]|\d+[.)])\s+(.*)$/);
        const limpio = (punto ? punto[1] : linea).replace(/\*\*/g, '').trim();
        if (punto) actual.puntos.push(limpio);
        else actual.texto = actual.texto ? `${actual.texto} ${limpio}` : limpio;
    }
    return bloques.filter((b) => b.texto || b.puntos.length);
}

function claveDeBloque(titulo) {
    const t = String(titulo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (t.includes('pocas palabras')) return 'resumen';
    if (t.includes('numeros')) return 'numeros';
    if (t.includes('explica')) return 'cruces';
    if (t.includes('haria') || t.includes('accion')) return 'acciones';
    return 'otro';
}

/**
 * Lo que Saly le dice a quien entra, según el estado de su lectura. Sin
 * respuestas no dice nada (no hay qué leer).
 */
export function invitacionDeSaly(lectura, { varias = false } = {}) {
    const e = estadoDeLectura(lectura);
    if (!(lectura?.respuestas > 0) && !e.hay) return null;
    if (!e.hay) return varias ? 'Tócame y te digo qué significan los resultados: de todas las sucursales o de una.' : 'Tócame y te digo qué significan los resultados.';
    if (e.puede) return `Entraron ${e.nuevas} respuestas nuevas. ¿Los vuelvo a leer?`;
    return varias ? 'Ya los leí. Tócame si quieres que lea otra sucursal.' : 'Ya los leí: está arriba.';
}
