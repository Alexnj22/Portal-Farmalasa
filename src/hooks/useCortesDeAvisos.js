import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCortes } from '../data/cortes';
import { conTramoPorSalaYDia } from '../utils/cortesDiagnostico';

/**
 * Los cortes que nombran los avisos «CORTE_NUEVO» de la campana, con su tramo.
 *
 * El aviso trae el id del corte, no el corte: la fila de `notifications` es una
 * foto del momento en que se capturó y el corte cambia después —alguien lo
 * confirma, alguien lo descarta—. Ofrecer «Confirmar» sobre la foto sería el
 * mismo defecto que ya se corrigió en las solicitudes: el botón sigue ahí
 * después de que otro decidió.
 *
 * Va en UNA consulta para toda la lista, no una por aviso: son ~4 cortes por
 * sala por día y la campana puede tener varios del mismo día. Y trae el día
 * entero de cada sala a propósito — el tramo es la resta contra el corte
 * anterior, así que un corte suelto no se puede evaluar solo.
 *
 * Sólo pide cuando el panel está abierto (`activo`): la campana vive en
 * `AppLayout` y se redibuja con cada notificación de cada pantalla.
 */
export default function useCortesDeAvisos(notificaciones, activo) {
    const fechas = useMemo(() => {
        const s = new Set();
        for (const n of notificaciones || []) {
            if (n.type === 'CORTE_NUEVO' && n.metadata?.fecha) s.add(n.metadata.fecha);
        }
        return [...s].sort();
    }, [notificaciones]);

    const desde = fechas[0] ?? null;
    const hasta = fechas[fechas.length - 1] ?? null;

    const [porId, setPorId] = useState(() => new Map());
    const [sello, setSello] = useState(0);

    useEffect(() => {
        if (!activo || !desde) return undefined;
        let vivo = true;
        fetchCortes({ desde, hasta })
            .then((filas) => {
                if (!vivo) return;
                const m = new Map();
                for (const c of conTramoPorSalaYDia(filas || [])) m.set(String(c.id), c);
                setPorId(m);
            })
            .catch(() => { /* sin cortes no hay botones: el aviso sigue llevando a la pantalla */ });
        return () => { vivo = false; };
    }, [activo, desde, hasta, sello]);

    /** Después de resolver uno: se vuelve a leer para que el aviso deje de ofrecerlo. */
    const recargar = useCallback(() => setSello((s) => s + 1), []);

    return { porId, recargar };
}
