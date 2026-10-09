// ─────────────────────────────────────────────────────────────────────────────
// Cuentas puras de Rutas, Generar y Finalizar — sin React, sin navegador.
// ─────────────────────────────────────────────────────────────────────────────
//
// Están aparte de los componentes para poder probarlas solas
// (`tests/unit/logicaDeRutas.test.js`). Cada una nació de un defecto medido:
// el comentario de cada función dice cuál.

// ── Tiempo de parada ─────────────────────────────────────────────────────────
// Minutos que el camión pasa DETENIDO en cada sala: estacionar, bajar las
// cajas, que la sala firme. La tabla de Google sólo sabe de conducir, así que
// una ruta de tres salas se estimaba en 15 min cuando duró 125. Es un número
// fijo y redondo a propósito: se recalibra cuando haya tiempos reales de
// llegada→salida por parada.
export const MIN_POR_PARADA = 10;

/**
 * El tiempo de la ruta con las descargas: conducir + `MIN_POR_PARADA` por cada
 * parada. Una ruta sin paradas no suma descargas.
 * @param {number} minConduciendo
 * @param {number} paradas
 */
export function duracionConParadas(minConduciendo, paradas) {
    const conducir = Number.isFinite(minConduciendo) ? Math.max(0, minConduciendo) : 0;
    const n = Number.isFinite(paradas) ? Math.max(0, paradas) : 0;
    return conducir + n * MIN_POR_PARADA;
}

/**
 * La línea de tiempo de una ruta: para cada parada, el minuto en que se LLEGA
 * (conducción acumulada + descargas de las paradas anteriores).
 * @param {Array<{dur_min?: number|null}>} paradas en orden
 * @returns {number[]} minuto de llegada a cada parada
 */
export function llegadasEstimadas(paradas) {
    let t = 0;
    return paradas.map((p, i) => {
        if (i > 0) t += MIN_POR_PARADA;
        t += p?.dur_min ?? 0;
        return t;
    });
}

// ── Claves y caché de trazados ───────────────────────────────────────────────
// Cada trazado por carretera es una petición que se paga. Un trazado depende
// SÓLO de los puntos y su orden, así que la clave es eso, redondeado a 5
// decimales (~1 m): dos aperturas del mismo mapa o volver a un orden ya visto
// no vuelven a pedir nada.

/**
 * @param {Array<{lat:number,lng:number}|null|undefined>} puntos en orden
 * @returns {string} vacía si no hay al menos dos puntos válidos
 */
export function claveDePuntos(puntos) {
    const validos = (puntos ?? []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validos.length < 2) return '';
    return validos.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
}

/**
 * Un caché en memoria con tope (se descarta el más viejo). Vive lo que vive la
 * página: las coordenadas de las salas no cambian en el día.
 */
export function crearCache(tope = 40) {
    const m = new Map();
    return {
        get(k) {
            if (!m.has(k)) return undefined;
            const v = m.get(k);
            m.delete(k); m.set(k, v);          // el usado pasa al final
            return v;
        },
        set(k, v) {
            if (m.has(k)) m.delete(k);
            m.set(k, v);
            while (m.size > tope) m.delete(m.keys().next().value);
        },
        has: (k) => m.has(k),
        get size() { return m.size; },
        clear: () => m.clear(),
    };
}

// ── ¿El conductor se salió del trazado? ──────────────────────────────────────
// El mapa del conductor recalculaba «cada 2 minutos»… y nunca lo hacía: el
// efecto dependía de una lista nueva en cada render, así que el intervalo se
// reiniciaba antes de cumplirse. Ahora no hay reloj: se recalcula cuando hace
// falta —se alejó del trazado o marcó una entrega— y nunca de más.

export const UMBRAL_DESVIO_M = 300;

/** Metros entre dos puntos, proyección local (sobra para distancias de una ruta). */
function metros(a, b) {
    const R = 6371000;
    const latMedia = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const dx = (b.lng - a.lng) * Math.PI / 180 * Math.cos(latMedia) * R;
    const dy = (b.lat - a.lat) * Math.PI / 180 * R;
    return Math.hypot(dx, dy);
}

/**
 * Distancia en metros de un punto a una polilínea (`[{lat,lng}]` o `[[lat,lng]]`).
 * `Infinity` si la polilínea está vacía.
 */
export function distanciaAPolilineaM(punto, polilinea) {
    const pts = (polilinea ?? []).map(p => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p)
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!punto || !pts.length) return Infinity;
    if (pts.length === 1) return metros(punto, pts[0]);
    const cos = Math.cos(punto.lat * Math.PI / 180);
    const R = 6371000, k = Math.PI / 180 * R;
    // Plano local centrado en el punto.
    const xy = (p) => ({ x: (p.lng - punto.lng) * k * cos, y: (p.lat - punto.lat) * k });
    let mejor = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = xy(pts[i]), b = xy(pts[i + 1]);
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / L2));
        const d = Math.hypot(a.x + t * dx, a.y + t * dy);
        if (d < mejor) mejor = d;
    }
    return mejor;
}

/**
 * ¿Hay que volver a pedir el trazado desde la posición del conductor?
 * Sí cuando cambió lo que falta por entregar (marcó una entrega o se le
 * devolvió una parada), o cuando se alejó más de `umbralM` del trazado vigente.
 * Sin trazado previo, sí (es el primero).
 */
export function debeRecalcular({ pos, polilinea, clavePendientes, claveAnterior, umbralM = UMBRAL_DESVIO_M }) {
    if (!pos) return false;
    if (!clavePendientes) return false;                  // no queda nada por entregar
    if (clavePendientes !== claveAnterior) return true;
    if (!polilinea?.length) return true;
    return distanciaAPolilineaM(pos, polilinea) > umbralM;
}

// ── Sondeo con espera creciente ──────────────────────────────────────────────
// La revisión del traslado se sondeaba cada 3 s hasta 40 veces: 40 lecturas
// para algo que suele tardar ~40 s. Con espera creciente (3, 6, 12, 24 s…) se
// llega igual de pronto a lo rápido y se pregunta mucho menos por lo lento,
// con el MISMO tope total de 2 minutos.

export const SONDEO_TOPE_MS = 120_000;

/**
 * Cuánto esperar antes del sondeo número `intento` (0 = el primero).
 * @returns {number|null} ms, o `null` si ya se pasó el tope total.
 */
export function esperaDeSondeo(intento, { base = 3000, maximo = 24_000, tope = SONDEO_TOPE_MS } = {}) {
    let transcurrido = 0;
    for (let i = 0; i <= intento; i++) {
        const espera = Math.min(maximo, base * 2 ** i);
        if (transcurrido + espera > tope) {
            // El último sondeo cae justo en el tope, no después.
            const resto = tope - transcurrido;
            return i === intento && resto > 0 ? resto : null;
        }
        if (i === intento) return espera;
        transcurrido += espera;
    }
    return null;
}

// ── Resumen por sala antes de confirmar un pedido ────────────────────────────
// «Generar y confirmar» pasaba de la tarjeta al pedido confirmado sin mostrar
// qué se iba a mandar. El resumen sale de la MISMA vista previa que después
// se confirma, así que lo que se ve es lo que se guarda.

/**
 * @param {Array<{erp_sucursal_id:number, cantidad_asignada?:number, sin_stock?:boolean, revision_minmax?:boolean, agotamiento?:boolean}>} filas
 * @returns {Array<{erp_sucursal_id:number, renglones:number, unidades:number, revision:number, sinStock:number, agotamiento:number}>}
 */
export function resumenPorSala(filas) {
    const porSala = new Map();
    for (const f of filas ?? []) {
        const id = f.erp_sucursal_id;
        if (!porSala.has(id)) porSala.set(id, { erp_sucursal_id: id, renglones: 0, unidades: 0, revision: 0, sinStock: 0, agotamiento: 0 });
        const s = porSala.get(id);
        const cant = Number(f.cantidad_asignada) || 0;
        if (f.sin_stock) { s.sinStock++; continue; }
        if (cant > 0) { s.renglones++; s.unidades += cant; }
        if (f.revision_minmax) s.revision++;
        else if (f.agotamiento) s.agotamiento++;
    }
    return [...porSala.values()];
}
