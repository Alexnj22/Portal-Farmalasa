import { useSyncExternalStore } from 'react';

/**
 * ¿El dispositivo se maneja con el dedo?
 *
 * Creado en D3.12 (2026-07-27) para decidir entre el calendario propio y el
 * selector nativo del sistema en los controles de fecha.
 *
 * La regla que se acordó, y el razonamiento detrás: **la consistencia es por
 * usuario, no global**. Quien trabaja desde el teléfono ve siempre la rueda del
 * sistema; quien trabaja desde escritorio ve siempre nuestro calendario. Nadie
 * ve las dos mezcladas, que era el riesgo real.
 *
 * `pointer: coarse` y no el ancho de pantalla: lo que decide no es cuánto mide
 * la ventana sino con qué se apunta. Una tablet en horizontal es ancha y sigue
 * siendo un dedo; una ventana de escritorio angosta sigue teniendo mouse.
 *
 * `useSyncExternalStore` en vez de `useState` + `useEffect` porque el valor
 * vive fuera de React: así no hay render extra al montar ni riesgo de leer un
 * valor viejo, y se actualiza solo si el usuario conecta un mouse a la tablet.
 */

const CONSULTA = '(pointer: coarse)';

const suscribir = (avisar) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia(CONSULTA);
    mq.addEventListener('change', avisar);
    return () => mq.removeEventListener('change', avisar);
};

const leer = () =>
    typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(CONSULTA).matches
        : false;

// En servidor asumimos puntero fino: es lo que menos sorprende si el HTML
// llegara pre-renderizado, y se corrige en la primera hidratación.
const leerEnServidor = () => false;

export function useCoarsePointer() {
    return useSyncExternalStore(suscribir, leer, leerEnServidor);
}

export default useCoarsePointer;
