// El rastreo de una ruta con la app CERRADA — la regla, sin aparato.
//
// Dos rutas pueden pedir el GPS del teléfono: el reparto de Pedidos (quien
// conduce, una posición cada 30 s → `ruta_locations`) y la venta en ruta de
// Torogoz (una por minuto → `dist_registrar_posicion`). El sistema da UNA sola
// tarea de ubicación de fondo por app, así que las dos comparten la misma y
// esto decide, en cada lote de posiciones que manda iOS:
//   - qué rutas siguen vivas (lo guardado en el teléfono, con su fecha),
//   - con qué cadencia se le pide el GPS al sistema (la más frecuente),
//   - y a cuál le toca escribir ahora (cada una con su propio reloj).
//
// La escritura es la MISMA que hace la pantalla abierta: esto sólo decide
// cuándo. Lo usa `apps/mobile/plataforma/rastreoDeFondo.js`.

/** Las dos rutas que rastrean, con su cadencia: tiempo mínimo y metros mínimos. */
export const CADENCIAS = {
    // Igual que el portal: el conductor anota cada 30 s (INTERVALO_POSICION_CONDUCTOR_MS).
    reparto: { intervaloMs: 30_000, distanciaM: 50 },
    // Igual que el portal: una posición por minuto (INTERVALO_RASTREO_MS).
    torogoz: { intervaloMs: 60_000, distanciaM: 100 },
};

/** Un lote llega un poco antes de su minuto: se acepta hasta un 10 % antes. */
const HOLGURA = 0.9;

/** Lo guardado sin las rutas que ya no valen: Torogoz es «en ruta HOY». */
export function rutasVigentes(estado, hoy) {
    const out = {};
    if (estado?.reparto?.rutaId) out.reparto = { rutaId: String(estado.reparto.rutaId) };
    if (estado?.torogoz?.yo && estado.torogoz.fecha === hoy) out.torogoz = { yo: String(estado.torogoz.yo), fecha: hoy };
    return out;
}

/** ¿No queda ninguna ruta viva? Entonces el GPS de fondo se apaga. */
export const sinRutas = (estado) => !estado || Object.keys(estado).length === 0;

/** La cadencia que se le pide al sistema: la más frecuente de las vivas; null si ninguna. */
export function cadenciaDe(estado) {
    const vivas = Object.keys(estado ?? {}).map((k) => CADENCIAS[k]).filter(Boolean);
    if (!vivas.length) return null;
    return {
        intervaloMs: Math.min(...vivas.map((c) => c.intervaloMs)),
        distanciaM: Math.min(...vivas.map((c) => c.distanciaM)),
    };
}

/** ¿Le toca escribir a esta ruta? La primera posición siempre; después, su intervalo. */
export function tocaEscribir(tipo, ultimaMs, ahoraMs) {
    const c = CADENCIAS[tipo];
    if (!c) return false;
    if (!Number.isFinite(ultimaMs)) return true;
    return ahoraMs - ultimaMs >= c.intervaloMs * HOLGURA;
}

/** De un lote de posiciones de iOS, la más reciente con coordenadas (o null). */
export function ultimaPosicion(locations) {
    let mejor = null;
    for (const l of locations ?? []) {
        const lat = l?.coords?.latitude;
        const lng = l?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const at = Number(l.timestamp) || 0;
        if (!mejor || at >= mejor.at) mejor = { lat, lng, precision: l.coords.accuracy ?? null, at };
    }
    return mejor;
}

/**
 * Qué rutas escriben con este lote. Devuelve la lista de tipos y las nuevas
 * marcas de «última escritura» (en ms) para guardar.
 */
export function quienesEscriben(estado, ultimas, ahoraMs) {
    const tipos = Object.keys(estado ?? {}).filter((t) => tocaEscribir(t, ultimas?.[t], ahoraMs));
    const nuevas = { ...(ultimas ?? {}) };
    for (const t of tipos) nuevas[t] = ahoraMs;
    return { tipos, ultimas: nuevas };
}

/** Una ruta de reparto rastrea mientras está «en ruta»; completada o pendiente, no. */
export const repartoSigueEnRuta = (status) => status === 'en_ruta';
