// ─────────────────────────────────────────────────────────────────────────────
// Volcar el cálculo de `puntuar.mjs` sobre el registro SIN pisar lo escrito
// ─────────────────────────────────────────────────────────────────────────────
//
// `puntuar.mjs --escribir` armaba el registro desde cero y lo escribía entero.
// Eso borraba lo que la regla NO calcula y que alguien escribió a propósito:
// las `verificaciones` de cada área (qué se corrió, qué commit lo cerró), el
// sello de sala, la marca de desbloqueo. Como correrlo costaba esa historia,
// nadie lo corría: cada sesión trasladaba ejes a mano y el registro terminó
// diciendo otra cosa que la regla en casi todas las áreas (2026-10-24: ~900
// líneas de diferencia — evidencias con conteos viejos, hallazgos movidos de
// línea).
//
// La regla de la fusión es una sola: **se reemplaza lo que la regla deriva y
// nada más.** Por eje: `pct`, `evidencia`, `hallazgos` (cualquier otro campo del
// eje se queda). Por área: `ejes`, `pct`, `estado` y la lista plana `hallazgos`,
// que es la concatenación de los de los ejes. Todo lo demás —verificaciones,
// sello, `descongelada_el`, notas, campos que todavía no existen— pasa tal cual.
// Un eje que el registro tiene y la regla no produce también se queda.
//
// `pct` y `estado` se derivan con LA MISMA regla que `auditoria-cli.mjs` y
// `calcularPct` del gate (sello = 100 sólo si los ejes sostienen el 95; un
// desbloqueo abierto nunca vuelve solo a «congelado»). Si divergieran, el gate
// rechazaría el pct que acaba de escribir este archivo.
//
// Es un módulo aparte —y puro— para poder probarlo: `puntuar.mjs` corre la
// batería entera y el barrido al importarse.

import { EJES, TOPE_SIN_SELLO } from './areas.mjs';

const PESO_TOTAL = EJES.reduce((s, e) => s + e.peso, 0);

export function pctDeArea(e) {
    if (!e?.ejes) return 0;
    const bruto = Math.round(EJES.reduce((s, eje) => s + ((e.ejes[eje.id]?.pct ?? 0) * eje.peso), 0) / PESO_TOTAL);
    return (e.sello_sala && bruto >= TOPE_SIN_SELLO) ? 100 : Math.min(bruto, TOPE_SIN_SELLO);
}

export function estadoDeArea(e, desbloqueada = false) {
    if (!e?.ejes || !Object.keys(e.ejes).length) return 'sin-auditar';
    const p = pctDeArea(e);
    if (desbloqueada) return 'en-curso';
    if (p >= 100 && e.sello_sala) return 'congelado';
    if (p >= TOPE_SIN_SELLO) return 'completo';
    return 'en-curso';
}

/**
 * @param {object} viejo        el registro tal como está en disco
 * @param {Record<string, Record<string, {pct:number,evidencia:string,hallazgos:string[]}>>} calculado
 *                              ejes por área, como los devuelve `puntuar()`
 * @param {{ desbloqueadas?: Iterable<string>, hoy?: string, verificacionInicial?: object }} [op]
 * @returns {object} registro nuevo (no muta `viejo`)
 */
export function fusionarRegistro(viejo, calculado, op = {}) {
    const abiertas = new Set(op.desbloqueadas || []);
    const reg = structuredClone(viejo || {});
    reg.areas ||= {};
    if (op.hoy) reg.recalculado = op.hoy;

    for (const [id, ejesNuevos] of Object.entries(calculado)) {
        const nueva = !reg.areas[id];
        const e = reg.areas[id] ||= {};
        const ejes = e.ejes || {};
        for (const [k, v] of Object.entries(ejesNuevos)) {
            ejes[k] = { ...(ejes[k] || {}), pct: v.pct, evidencia: v.evidencia, hallazgos: [...(v.hallazgos || [])] };
        }
        e.ejes = ejes;
        if (nueva) {
            e.sello_sala = null;
            e.verificaciones = op.verificacionInicial ? [op.verificacionInicial] : [];
        }
        e.pct = pctDeArea(e);
        e.estado = estadoDeArea(e, abiertas.has(id));
        // Los conocidos en el orden de EJES; uno que la regla no conoce, al final.
        const orden = [...EJES.map(x => x.id), ...Object.keys(ejes).filter(k => !EJES.some(x => x.id === k))];
        e.hallazgos = orden.flatMap(k => (ejes[k]?.hallazgos || []).map(x => `[${k}] ${x}`));
    }
    return reg;
}
