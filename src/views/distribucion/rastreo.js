// Rastreo de la ruta en segundo plano (borrador 0033).
//
// Pedido del usuario (2026-10-01): mientras el vendedor está en ruta, la app
// sigue su posición aunque el teléfono esté bloqueado. Sólo en la app
// (Capacitor): en el navegador `vercel.json` apaga la ubicación y además no
// puede medir con la pantalla apagada. La pieza que mide es la misma del
// conductor de pedidos (`seguirPosicion`, plugin BackgroundGeolocation), que
// en Android muestra el aviso fijo «Ruta activa» mientras rastrea.
//
// «En ruta» es un estado del TELÉFONO: se guarda con la fecha del día, así
// que sobrevive a cerrar la app y se apaga solo al día siguiente. Vive fuera
// de React para que el marco (que mide) y la pantalla de Rutas (que tiene el
// botón) se enteren a la vez.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { seguirPosicion } from '@plataforma/ubicacion';
import { hoySV } from '@nucleo/utils/fecha';
import { registrarPosicion } from '@nucleo/data/distribucion';

export const esApp = () => !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

const clave = (yo) => `torogoz-en-ruta:${yo}`;
const EVENTO = 'torogoz-en-ruta';

function leer(yo) {
    if (!yo) return false;
    try { return localStorage.getItem(clave(yo)) === hoySV(); } catch { return false; }
}
function escribir(yo, activa) {
    try {
        if (activa) localStorage.setItem(clave(yo), hoySV());
        else localStorage.removeItem(clave(yo));
    } catch { /* sin almacenamiento: dura lo que dure la pantalla */ }
    window.dispatchEvent(new Event(EVENTO));
}

/** ¿Este teléfono está en ruta hoy? Con el botón para iniciar y terminar. */
export function useEnRuta(yo) {
    const activa = useSyncExternalStore(
        (avisar) => { window.addEventListener(EVENTO, avisar); window.addEventListener('storage', avisar); return () => { window.removeEventListener(EVENTO, avisar); window.removeEventListener('storage', avisar); }; },
        () => leer(yo),
        () => false,
    );
    return { activa, iniciar: () => escribir(yo, true), terminar: () => escribir(yo, false) };
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
        let ultima = null;
        let detener = null;
        let cerrado = false;
        const anotar = () => {
            if (!ultima) return;
            registrarPosicion(ultima.lat, ultima.lng).catch(e => console.warn('[ruta] no se anotó la posición', e?.message ?? e));
        };
        seguirPosicion((pos) => {
            const primera = !ultima;
            ultima = pos;
            setProblema(null);
            if (primera) anotar();
        }, { mensaje: 'Ruta de Torogoz activa.', alFallar: (m) => setProblema(m) })
            .then((d) => { if (cerrado) d(); else detener = d; })
            .catch((e) => { console.warn('[ruta] no arrancó el GPS', e); setProblema('sin-gps'); });
        const intervalo = setInterval(anotar, 60_000);
        return () => { cerrado = true; detener?.(); clearInterval(intervalo); };
    }, [activa, yo]);
    return { midiendo: activa && esApp(), problema };
}
