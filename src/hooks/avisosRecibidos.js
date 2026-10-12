import { useEffect, useRef } from 'react';

/**
 * Lo que llega por la campana, repartido a quien lo quiera escuchar.
 *
 * `useNotificationsChannel` es la ÚNICA suscripción a `notifications` (una por
 * pestaña, filtrada al empleado). Una pantalla que quiere ponerse al día cuando
 * llega un aviso de su tema no abre otra: se cuelga de ésta. Nació del chat con
 * clientes (2026-10-12): el aviso `CHAT_CLIENTE` es un respaldo más para que la
 * bandeja, el hilo y la burbuja se relean aunque su propio canal se haya caído.
 */

const oyentes = new Set();

/** Lo llama el canal de la campana con cada aviso nuevo. Nunca lanza. */
export function anunciarAviso(aviso) {
    oyentes.forEach((fn) => {
        try { fn(aviso); } catch (err) { console.error('avisosRecibidos: un oyente falló', err); }
    });
}

/** `fn(aviso)` con cada aviso nuevo cuyo `type` esté en `tipos`. Devuelve cómo soltarlo. */
export function alLlegarAviso(tipos, fn) {
    const lista = new Set([].concat(tipos));
    const oyente = (aviso) => { if (lista.has(aviso?.type)) fn(aviso); };
    oyentes.add(oyente);
    return () => oyentes.delete(oyente);
}

/** La versión de componente: `fn` puede cambiar en cada render sin resuscribir. */
export function useAlLlegarAviso(tipos, fn) {
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; }, [fn]);
    const clave = [].concat(tipos).join(',');
    useEffect(() => alLlegarAviso(clave.split(','), (a) => fnRef.current?.(a)), [clave]);
}
