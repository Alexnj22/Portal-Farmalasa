// Rastreo de la ruta en segundo plano (borrador 0033).
//
// Pedido del usuario (2026-10-01): mientras el vendedor está en ruta, la app
// sigue su posición aunque el teléfono esté bloqueado. Sólo en la app
// (Capacitor): en el navegador `vercel.json` apaga la ubicación y además no
// puede medir con la pantalla apagada. La pieza que mide es la misma del
// conductor de pedidos (`seguirPosicion`, plugin BackgroundGeolocation), que
// en Android muestra el aviso fijo «Ruta activa» mientras rastrea.
//
// La regla —qué es «en ruta», cuándo se anota y cada cuánto— vive en el
// núcleo (`data/distribucionRastreo.js`) y la usa también la app nativa. Acá
// quedan los hooks de React del portal.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { estaEnRuta, marcarEnRuta, escucharEnRuta, arrancarRastreo } from '@nucleo/data/distribucionRastreo';

export const esApp = () => !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

/** ¿Este teléfono está en ruta hoy? Con el botón para iniciar y terminar. */
export function useEnRuta(yo) {
    const activa = useSyncExternalStore(
        (avisar) => {
            const dejar = escucharEnRuta(avisar);
            // Otra pestaña del mismo navegador también cuenta.
            window.addEventListener('storage', avisar);
            return () => { dejar(); window.removeEventListener('storage', avisar); };
        },
        () => estaEnRuta(yo),
        () => false,
    );
    return { activa, iniciar: () => marcarEnRuta(yo, true), terminar: () => marcarEnRuta(yo, false) };
}

/**
 * Lo monta el marco de Torogoz: mientras el teléfono esté en ruta, mide y
 * anota un punto por minuto. Devuelve si está midiendo y el último problema.
 */
export function useRastreoDeRuta(yo) {
    const { activa } = useEnRuta(yo);
    const [problema, setProblema] = useState(null);
    useEffect(() => {
        if (!activa || !esApp() || !yo) return undefined;
        return arrancarRastreo({ mensaje: 'Ruta de Torogoz activa.', alProblema: setProblema });
    }, [activa, yo]);
    return { midiendo: activa && esApp(), problema };
}
