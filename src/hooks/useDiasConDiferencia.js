import { useCallback, useEffect, useState } from 'react';
import { fetchDiasConDiferencia, fetchDiferencias } from '../data/cortes';
import { conEstados, unirResoluciones } from '../utils/diferenciasDeCaja';

/* Desde cuándo hay cortes capturados. Antes no existe nada que mirar. */
export const DIFERENCIAS_DESDE = '2026-08-14';

/**
 * Los días con diferencia de TODO el historial, con su estado.
 *
 * No sigue al período de la pantalla, y es a propósito: una diferencia sin
 * resolver o con saldo sigue siendo trabajo pendiente aunque sea de hace un
 * mes — la misma regla que ya tiene el aviso de las diferencias sin resolver
 * (migración `una_diferencia_sin_resolver_no_depende_de_las_fechas_de_la_pantalla`).
 * Todo el historial cuesta 65 ms en la base.
 *
 * `hasta` llega desde afuera (la fecha de hoy en El Salvador) para que la
 * lógica no dependa del reloj del equipo.
 */
export default function useDiasConDiferencia({ activo, hasta }) {
    const [dias, setDias] = useState([]);
    const [resoluciones, setResoluciones] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        if (!activo || !hasta) return;
        setCargando(true);
        const [r, resoluciones] = await Promise.all([
            fetchDiasConDiferencia({ desde: DIFERENCIAS_DESDE, hasta }),
            fetchDiferencias({ desde: DIFERENCIAS_DESDE, hasta }),
        ]);
        setError(r.error);
        setResoluciones(resoluciones || []);
        setDias(conEstados(unirResoluciones(r.dias, resoluciones)));
        setCargando(false);
    }, [activo, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al abrir la pestaña

    return { dias, resoluciones, cargando, error, recargar: cargar };
}
