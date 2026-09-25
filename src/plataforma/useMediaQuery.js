import { useSyncExternalStore } from 'react';

/**
 * ¿Se cumple esta media query ahora mismo?
 *
 * Generalización de `useCoarsePointer` (D3.12), creada el 2026-07-27 para que
 * `FilterBar` sepa cuándo colapsar. Misma técnica y por las mismas razones:
 * `useSyncExternalStore` en vez de `useState` + `useEffect` porque el valor vive
 * fuera de React — así no hay render extra al montar, no hay riesgo de leer un
 * valor viejo en el primer pintado, y se actualiza solo al rotar el teléfono o
 * redimensionar la ventana.
 *
 * Ojo con la diferencia respecto de `useCoarsePointer`: **el ancho no reemplaza
 * al puntero**. Para elegir entre calendario propio y rueda del sistema decide
 * el puntero (una tablet ancha sigue siendo un dedo). Para decidir si una barra
 * de filtros entra en la fila del título decide el ANCHO, porque el problema es
 * de espacio, no de cómo se apunta. Son dos preguntas distintas.
 */

const cache = new Map();

function obtenerLista(consulta) {
    if (!cache.has(consulta)) {
        cache.set(consulta, typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia(consulta)
            : null);
    }
    return cache.get(consulta);
}

export default function useMediaQuery(consulta) {
    const lista = obtenerLista(consulta);

    return useSyncExternalStore(
        (avisar) => {
            if (!lista) return () => {};
            // `addEventListener` con respaldo a `addListener`: Safari < 14 solo
            // tiene el viejo, y el kiosco corre en iPads que pueden ser de esa
            // época. Sin el respaldo, ahí la barra nunca se enteraría de un giro
            // de pantalla.
            if (lista.addEventListener) {
                lista.addEventListener('change', avisar);
                return () => lista.removeEventListener('change', avisar);
            }
            lista.addListener(avisar);
            return () => lista.removeListener(avisar);
        },
        () => (lista ? lista.matches : false),
        // En servidor no hay ventana: se asume escritorio, que es el layout
        // completo. Colapsar por defecto escondería los filtros en el primer
        // pintado y se verían aparecer, que es peor.
        () => false,
    );
}
