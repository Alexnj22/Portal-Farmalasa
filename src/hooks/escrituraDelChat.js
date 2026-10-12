// Vive en el núcleo para que la usen el portal y la app (2026-10-12).
import { useEffect, useMemo, useState } from 'react';

// «Está escribiendo…» (2026-10-12). La base guarda CUÁNDO fue la última tecla
// (`escribiendo_at` del equipo, `cliente_escribiendo_at` del cliente) y la marca
// vale 6 s: quien escribe la renueva cada 3 s. Módulo aparte —sin
// componentes— para no romper el fast refresh.

export const VENTANA_ESCRIBIENDO_MS = 6_000;

/** ¿La marca `at` sigue vigente en el instante `ahora`? (tolera relojes un poco corridos) */
export function escribeAhora(at, ahora) {
    const t = at ? Date.parse(at) : NaN;
    return Number.isFinite(t) && Math.abs(ahora - t) < VENTANA_ESCRIBIENDO_MS;
}

/**
 * Un reloj de 1 s que corre SÓLO mientras alguna de las `marcas` puede seguir
 * vigente: así la indicación se apaga sola a los 6 s sin esperar otro aviso de
 * realtime, y una bandeja quieta no redibuja nada cada segundo.
 */
export function useRelojDeEscritura(marcas) {
    const [ahora, setAhora] = useState(() => Date.now());
    const ultima = useMemo(() => (marcas || []).reduce((max, at) => {
        const t = at ? Date.parse(at) : NaN;
        return Number.isFinite(t) && t > max ? t : max;
    }, -Infinity), [marcas]);

    useEffect(() => {
        if (!Number.isFinite(ultima)) return undefined;
        let reloj = null;
        const tic = () => {
            const n = Date.now();
            setAhora(n);
            if (n - ultima >= VENTANA_ESCRIBIENDO_MS && reloj) { clearInterval(reloj); reloj = null; }
        };
        const primero = setTimeout(tic, 0);
        reloj = setInterval(tic, 1_000);
        return () => { clearTimeout(primero); if (reloj) clearInterval(reloj); };
    }, [ultima]);

    return ahora;
}
