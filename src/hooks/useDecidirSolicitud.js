import { useState, useCallback } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { YA_AVISADO } from '../store/slices/requestsSlice';
import { decidirMinMax } from '../data/minmaxRequests';
import { notifyEmployees } from '../utils/notify';
import { ERP_NAMES } from '../constants/erp';

/* Aprobar o rechazar una solicitud. UNA definición, dos lugares que la usan.
 *
 * Vivía entera dentro de `RequestsView` (`handleDecidir`), y mientras la campana
 * sólo sabía llevar a esa pantalla eso alcanzaba. Desde que la campana decide en
 * el sitio, copiarla habría significado dos versiones de cosas que no se ven
 * hasta semanas después: que un Min/Max aprobado escribe en la bitácora con las
 * claves que lee el historial del producto, que hay que avisarle a quien lo
 * propuso, y que el aviso propio se apaga a mano para no seguir ofreciendo
 * «Aprobar» sobre lo ya resuelto.
 *
 * Lo que NO entra acá es lo que cada pantalla hace DESPUÉS —cerrar su modal,
 * parchar su lista local—: eso va por `onAplicado`.
 *
 * @returns {{ decidir: Function, ocupado: boolean }}
 *   `decidir({ req, modo, nota, aceptadas })` → `true` si se aplicó.
 *   `modo` es `'approve' | 'reject'`; `aceptadas` sólo cuando se dejó algo afuera.
 */
export function useDecidirSolicitud({ onAplicado } = {}) {
    const { user } = useAuth();
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const marcarAvisoResuelto = useStaff(s => s.marcarAvisoDeSolicitudResuelto);

    const [ocupado, setOcupado] = useState(false);

    const decidir = useCallback(async ({ req, modo, nota, aceptadas }) => {
        // Un rechazo sin motivo no es una decisión a medias: es la que no se
        // puede contestar. Lo frena también el servidor, pero acá se evita el
        // viaje.
        if (modo === 'reject' && !nota) return false;
        setOcupado(true);

        // Min/Max se resuelve por su propia RPC y con su propio permiso. No pasa
        // por `approveRequest` porque no vive en `approval_requests`.
        if (req.type === 'MINMAX_CHANGE_REQUEST') {
            const fila = req._minmax ?? {};
            const r = await decidirMinMax(fila.id ?? req.id, modo === 'approve', nota);
            setOcupado(false);
            if (!r.ok) {
                useToastStore.getState().showToast('No se pudo', r.error ?? 'Error al resolver el ajuste.', 'error');
                return false;
            }

            /* La bitácora y el aviso a quien pidió vivían DENTRO de la pestaña
             * de Min/Max, que se quitó al unificar el centro. Sin traerlos,
             * decidir habría seguido funcionando y en silencio habría dejado de
             * avisarle a quien propuso el ajuste y de quedar registrado — dos
             * ausencias que no dan error y que sólo se notan semanas después,
             * cuando alguien pregunta por qué nunca le contestaron.
             *
             * El `target_id` es el PRODUCTO y no la solicitud: es lo que usa el
             * historial de Min/Max para buscar los cambios de un producto
             * puntual. La solicitud queda en el detalle. */
            const aprobo = modo === 'approve';
            /* `old_min`/`old_max`/`new_min`/`new_max` y no `requested_*`: es la
             * forma que lee el historial de MIN·MAX del producto, y sin ella
             * pintaba «MIN — MAX —» en cada aprobación (visto el 2026-08-14 en
             * CIPRO DENK). El par ANTERIOR lo devuelve `approve_minmax_request`,
             * que lo capturó justo antes de pisarlo — el `current_min` de la
             * solicitud es de cuando se creó y puede ser de hace días.
             *
             * Y va quién lo PIDIÓ: el historial ya nombra a quien lo resolvió
             * (es su acción en la bitácora), pero el ajuste no nació ahí. */
            appendAuditLog(aprobo ? 'MINMAX_REQUEST_APPROVED' : 'MINMAX_REQUEST_REJECTED',
                String(fila.erp_product_id ?? ''), {
                    request_id: fila.id, product: fila.product_name,
                    sucursal_id: fila.erp_sucursal_id,
                    old_min: r.data?.previous_min ?? null, old_max: r.data?.previous_max ?? null,
                    new_min: fila.requested_min, new_max: fila.requested_max,
                    requested_min: fila.requested_min, requested_max: fila.requested_max,
                    requested_by_id: fila.requested_by_id ?? null,
                    requested_by_name: fila.requested_by_name ?? null,
                    note: nota || null,
                }).catch(e => console.error('audit MINMAX:', e?.message ?? e));

            if (fila.requested_by_id) {
                notifyEmployees([String(fila.requested_by_id)], {
                    type: 'MINMAX_DECIDED',
                    title: aprobo ? '✅ Ajuste Min/Max aprobado' : '❌ Ajuste Min/Max rechazado',
                    body: aprobo
                        ? `Tu propuesta para ${fila.product_name} (${ERP_NAMES[fila.erp_sucursal_id] ?? fila.erp_sucursal_id}) fue aplicada: MIN ${fila.requested_min} · MAX ${fila.requested_max}.`
                        : `Tu propuesta para ${fila.product_name} fue rechazada.${nota ? ' Motivo: ' + nota : ''}`,
                    link: '/requests',
                    push: true,
                    metadata: {
                        status: aprobo ? 'APPROVED' : 'REJECTED',
                        product_name: fila.product_name,
                        erp_sucursal_id: fila.erp_sucursal_id,
                        requested_min: fila.requested_min, requested_max: fila.requested_max,
                        note: nota || null,
                    },
                }).catch(e => console.error('notify MINMAX:', e?.message ?? e));
            }

            useToastStore.getState().showToast('Listo',
                aprobo ? 'Ajuste de Min/Max aplicado.' : 'Ajuste de Min/Max rechazado.', 'success');

            /* Y se apaga el aviso que pedía esta decisión. En la base lo hace un
             * trigger; acá se refleja al instante para quien acaba de decidir —
             * si no, su propia campana le sigue ofreciendo «Aprobar / Rechazar»
             * sobre lo que ya resolvió. El id del aviso es el de la FILA de
             * Min/Max, sin el prefijo del adaptador. */
            marcarAvisoResuelto(fila.id ?? String(req.id).replace('minmax:', ''),
                aprobo ? 'APPROVED' : 'REJECTED');

            onAplicado?.({ req, modo, nota, minmax: fila });
            return true;
        }

        const resultado = modo === 'approve'
            ? await approveRequest(req.id, user.id, nota, null, aceptadas)
            : await rejectRequest(req.id, user.id, nota);
        setOcupado(false);

        if (resultado === true) {
            useToastStore.getState().showToast(
                'Listo',
                modo === 'approve'
                    ? (aceptadas ? `Se aplicaron ${aceptadas.length} líneas; el resto quedó rechazado.` : 'Solicitud aprobada.')
                    : 'Solicitud rechazada.',
                'success');
            onAplicado?.({ req, modo, nota, minmax: null });
            return true;
        }

        if (resultado !== YA_AVISADO) {
            /* Sólo si nadie explicó ya el motivo. Las ramas que hablan con el
             * sistema de facturación o mueven existencias devuelven el detalle
             * de por qué no entró, y este aviso genérico lo borraba: el store de
             * toasts tiene una sola ranura. */
            useToastStore.getState().showToast('Error', 'No se pudo procesar la acción.', 'error');
        }
        return false;
    // `user` entero y no `user?.id`: el compiler infiere el objeto y con la
    // dependencia más fina se niega a memoizar (`Could not preserve existing
    // manual memoization`), que deja la función sin optimizar en vez de más
    // estable.
    }, [user, approveRequest, rejectRequest, appendAuditLog, marcarAvisoResuelto, onAplicado]);

    return { decidir, ocupado };
}

export default useDecidirSolicitud;
