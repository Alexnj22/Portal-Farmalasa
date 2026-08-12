import { useEffect, useRef } from 'react';

/**
 * Volver a leer cuando la pestaña vuelve a estar visible.
 *
 * Lo que llega por realtime llega SÓLO mientras el socket está vivo, y nada
 * recupera después lo que pasó mientras estuvo caído: una pestaña suspendida
 * —el móvil en segundo plano, el ahorro de memoria del navegador, un corte de
 * red— vuelve mostrando lo de antes y no hay nada en pantalla que lo delate. Es
 * peor que no tener realtime, porque la pantalla parece al día.
 *
 * Y hay pantallas que ni siquiera lo tienen: `approval_requests` no está en la
 * publicación, así que la lista de Solicitudes sólo se entera de lo que decidió
 * su propia pestaña.
 *
 * `msMinimo` es el piso entre lecturas: sin él, alternar entre pestañas dispara
 * una consulta por cada cambio de foco.
 */
export function useRecargarAlVolver(recargar, msMinimo = 15000) {
    const ultimaRef   = useRef(0);
    const recargarRef = useRef(recargar);

    // Por efecto y no durante el render: la función suele venir recreada en cada
    // render del llamador, y escribirle a una ref mientras se renderiza es
    // justamente lo que el compilador de React no admite.
    useEffect(() => { recargarRef.current = recargar; }, [recargar]);

    useEffect(() => {
        const alVolver = () => {
            if (document.visibilityState !== 'visible') return;
            const ahora = Date.now();
            if (ahora - ultimaRef.current < msMinimo) return;
            ultimaRef.current = ahora;
            recargarRef.current?.();
        };
        document.addEventListener('visibilitychange', alVolver);
        return () => document.removeEventListener('visibilitychange', alVolver);
    }, [msMinimo]);
}
