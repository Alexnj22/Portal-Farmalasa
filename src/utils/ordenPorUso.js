// El Inicio que APRENDE (pedido del usuario del 2026-09-30: «¿podemos hacer
// que aprenda qué se usa más para que salga eso arriba, y se vayan moviendo
// según uso?»).
//
// Cada vez que alguien toca una sección se anota; el puntaje de una sección es
// la suma de sus toques con un peso que se DESGASTA con el tiempo (vida media
// de 14 días): lo que se usa esta semana manda sobre lo que se usó hace dos
// meses. El orden sólo se recalcula al abrir la pantalla, nunca mientras se
// mira: una sección que salta bajo el dedo es peor que un orden imperfecto.
//
// Sin uso, se respeta el orden por defecto; a igual puntaje, también. Así el
// primer día se ve lo pensado, y después lo vivido.

export const VIDA_MEDIA_DIAS = 14;
const MS_DIA = 86400000;

/** Registra un toque: devuelve el registro nuevo (no lo muta). */
export function anotarUso(registro = {}, id, ahora = Date.now()) {
    const previo = registro[id] ?? { puntos: 0, en: ahora };
    return { ...registro, [id]: { puntos: puntosAl(previo, ahora) + 1, en: ahora } };
}

/** El puntaje de una entrada, desgastado hasta `ahora`. */
export function puntosAl(entrada, ahora = Date.now()) {
    if (!entrada) return 0;
    const dias = Math.max(0, (ahora - entrada.en) / MS_DIA);
    return entrada.puntos * Math.pow(0.5, dias / VIDA_MEDIA_DIAS);
}

/** `ids` ordenados por uso; el orden de `ids` desempata. */
export function ordenarPorUso(ids = [], registro = {}, ahora = Date.now()) {
    return ids
        .map((id, i) => ({ id, i, p: puntosAl(registro[id], ahora) }))
        .sort((a, b) => (b.p - a.p) || (a.i - b.i))
        .map((x) => x.id);
}
