import { useCallback, useState } from 'react';
import { resolverCorte } from '../data/cortes';
import { mensajeAmigable } from '../utils/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

/**
 * Confirmar o descartar un corte — la ÚNICA escritura, para las cuatro
 * pantallas que la ofrecen: el módulo, la baldosa del Inicio, el detalle y la
 * campana.
 *
 * Existe por la misma razón que `useDecidirSolicitud`: el módulo y la baldosa
 * ya tenían **la misma función copiada** —`confirmarRapido`, idéntica salvo el
 * `origen` y a quién avisarle que recargue— y el detalle una tercera versión
 * con motivo y observación. Agregarle el cuarto camino desde la campana sin
 * juntarlas primero era garantizar que alguna se quedara atrás: el día que
 * cambie qué se escribe en la bitácora, o qué dice el aviso de error, hay que
 * poder cambiarlo en un solo sitio.
 *
 * Lo que NO decide es CUÁNDO se confirma de un clic y cuándo hay que abrir el
 * detalle — eso vive en `TarjetaCorte` (`seConfirmaDeUnClic`), que es la regla
 * de pantalla. Acá sólo se escribe.
 *
 * Devuelve `true` si quedó guardado, para que el llamador decida qué hacer
 * después (recargar su lista, cerrar su diálogo, apagar su aviso).
 */
export default function useResolverCorte({ nombreSala = {}, origen = 'modulo' } = {}) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const [ocupadoId, setOcupadoId] = useState(null);

    const resolver = useCallback(async (corte, estado, { motivo = null, observaciones = null } = {}) => {
        if (!corte || ocupadoId) return false;
        setOcupadoId(corte.id);
        const { error } = await resolverCorte(corte.id, estado, { motivo, observaciones });
        setOcupadoId(null);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return false;
        }
        const sala = nombreSala[corte.branch_id] || '';
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: corte.id,
            sucursal: sala,
            fecha: corte.fecha,
            hora: corte.hora,
            diferencia: corte.tramo,
            motivo: motivo || undefined,
            origen,
        });
        showToast?.(
            estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado',
            `${sala} · ${String(corte.hora || '').slice(0, 5)}`.trim(), 'success',
        );
        return true;
    }, [ocupadoId, showToast, appendAuditLog, user, nombreSala, origen]);

    return { resolver, ocupadoId };
}
