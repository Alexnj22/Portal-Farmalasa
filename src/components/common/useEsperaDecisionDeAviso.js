import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@nucleo/context/AuthContext';
import { avisoEsperaDecisionConMayoristas, esAvisoDeMayorista } from '@nucleo/utils/accionesDeAviso';
import { fetchSolicitudesMayorista } from '@nucleo/data/mayoristas';

/* ¿Este aviso todavía espera una DECISIÓN de quien lo ve? — para la campana y
 * el historial del portal, con la misma regla que la pestaña Avisos de la app.
 *
 * Lo que espera no se marca leído al tocarlo ni con «Leídas» (2026-10-12, «si
 * toco una y era solicitud se desaparece aun sin confirmar ni descartar»): se
 * queda hasta que se decide. Para solicitudes, Mín·Máx, traslados y envíos lo
 * cierra el trigger con `metadata.resuelta`.
 *
 * El aviso `MAYORISTA_SOLICITUD` (2026-10-14) no tiene ese sello: espera
 * mientras su cliente siga en estado 'solicitado'. Por eso se lee el conjunto
 * de clientes solicitados — sólo si quien mira puede aprobarlos y hay un aviso
 * de mayorista en la lista, para no pagar la consulta en cada apertura. Si la
 * lectura falla queda `null` y el aviso no se da por pendiente: preferible a
 * dejarlo trabado para siempre.
 *
 * @param avisos  la lista que se está mostrando
 * @param activo  si vale la pena leer ahora (la campana abierta)
 */
export default function useEsperaDecisionDeAviso({ avisos = [], activo = true } = {}) {
    const { hasPermission } = useAuth();
    const decideMayoristas = hasPermission('mayoristas', 'can_approve');
    const [mayoristasSolicitados, setMayoristasSolicitados] = useState(null);

    // Cambia cuando entra o sale un aviso de mayorista: ahí vale releer.
    const claveDeMayoristas = useMemo(() => avisos
        .filter(n => esAvisoDeMayorista(n) && !n.read_at && !n.deleted_at)
        .map(n => n.id).sort().join(','), [avisos]);

    useEffect(() => {
        if (!activo || !decideMayoristas || !claveDeMayoristas) return undefined;
        let vigente = true;
        fetchSolicitudesMayorista()
            .then(filas => {
                if (vigente) setMayoristasSolicitados(new Set((filas || []).map(m => String(m.customer_id))));
            })
            .catch(err => {
                console.error('No se pudieron leer las solicitudes de mayorista:', err);
                if (vigente) setMayoristasSolicitados(null);
            });
        return () => { vigente = false; };
    }, [activo, decideMayoristas, claveDeMayoristas]);

    return useCallback(
        (n) => avisoEsperaDecisionConMayoristas(n, hasPermission, mayoristasSolicitados),
        [hasPermission, mayoristasSolicitados],
    );
}
