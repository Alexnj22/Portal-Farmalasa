// Los lugares de campo ya usados, sugeridos al encuestador (2026-11-19).
//
// El usuario: «2 días seguidos voy al mismo lugar, y en una escribo mercado y
// en otra mercado central, lo tomaría como 2 lugares… que mañana al escribir
// mercado lo encuentre como guardado, o por mi ubicación lo sugiera».
//
// La lista sale de `encuesta_cliente_lugares_de_campo()` (todo el equipo,
// agrupada sin mayúsculas, tildes ni espacios de sobra, con el centro de sus
// puntos). Acá sólo se elige qué mostrar:
//   · sin escribir nada → los que están cerca (a ≤ RADIO_CERCA_M), el más
//     cercano primero: «¿Estás en Mercado Central?»;
//   · escribiendo → los que coinciden con lo escrito (la búsqueda única del
//     portal), los cercanos primero y después los más usados.
// Lo que ya está escrito igual (sin importar mayúsculas ni tildes) no se
// sugiere: ya está elegido.
import { coincide, normalizar } from './busqueda';

/** Hasta dónde un lugar guardado cuenta como «aquí». */
export const RADIO_CERCA_M = 300;
const MAX_SUGERENCIAS = 4;

/** Distancia en metros entre dos puntos {lat, lng} (fórmula del haversine). */
export function metrosEntre(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/** «a 120 m» · «a 1.4 km»; sin distancia, null. */
export function distanciaDeLugar(m) {
    if (m == null) return null;
    if (m < 50) return 'aquí';
    return m >= 1000 ? `a ${(m / 1000).toFixed(1)} km` : `a ${Math.round(m / 10) * 10} m`;
}

/**
 * Qué lugares sugerir.
 *   lugares → los de la base: [{ lugar, respuestas, lat, lng }]
 *   texto   → lo que lleva escrito
 *   pos     → la ubicación del teléfono {lat, lng} o null
 * Devuelve [{ lugar, respuestas, distancia, cerca }], como mucho 4.
 */
export function sugerenciasDeLugar(lugares, texto, pos) {
    const escrito = normalizar(texto);
    const conDistancia = (lugares || [])
        .filter((l) => l?.lugar && normalizar(l.lugar) !== escrito)
        .map((l) => {
            const distancia = pos && l.lat != null ? metrosEntre(pos, l) : null;
            return { lugar: l.lugar, respuestas: l.respuestas || 0, distancia, cerca: distancia != null && distancia <= RADIO_CERCA_M };
        });
    const elegidos = escrito
        ? conDistancia.filter((l) => coincide(texto, l.lugar))
        : conDistancia.filter((l) => l.cerca);
    return elegidos
        .sort((a, b) => (b.cerca - a.cerca)
            || (a.cerca && b.cerca ? a.distancia - b.distancia : 0)
            || b.respuestas - a.respuestas
            || (a.distancia ?? Infinity) - (b.distancia ?? Infinity))
        .slice(0, MAX_SUGERENCIAS);
}
