import { fetchApprovalRequestById } from './requests';
import { fetchMinMaxChangeRequestById } from './minmaxRequests';
import { adaptarMinMax } from '../store/slices/requestsSlice';
import { ERP_NAMES } from '../constants/erp';

/* La solicitud que hay detrás de un aviso de la campana.
 *
 * Un aviso no trae la solicitud: trae su id. Y de qué TABLA sacarla no se
 * deduce del id —un Min/Max vive en `minmax_change_requests`, con otras
 * columnas y otro ciclo— sino de `metadata.request_type`. Ese dato lo miran hoy
 * dos caminos distintos (el detalle desplegado y la decisión en el sitio), así
 * que vive una sola vez acá.
 */
export const esAvisoDeMinMax = (notif) => notif?.metadata?.request_type === 'MINMAX';

/**
 * Trae la fila CRUDA. Lanza si la lectura falló; devuelve `null` si ya no está
 * —una solicitud borrada y una lectura rota no son lo mismo y no se contestan
 * igual—.
 */
export async function cargarFilaDeAviso(notif) {
    const id = notif?.metadata?.request_id ?? null;
    if (!id) return null;
    const { data, error } = esAvisoDeMinMax(notif)
        ? await fetchMinMaxChangeRequestById(id)
        : await fetchApprovalRequestById(id);
    if (error) throw error;
    return data ?? null;
}

/**
 * La misma fila con la forma que espera `useDecidirSolicitud`: `type`, `status`
 * y —para Min/Max— la fila cruda en `_minmax`, que es de donde salen el
 * producto y el par propuesto al escribir la bitácora.
 *
 * Sin `buscarPersona`: acá no se pinta a nadie, se decide. El adaptador ya
 * cubre ese caso (`buscarPersona?.()`) y el detalle desplegado sí se lo pasa.
 */
export function paraDecidir(fila, esMinMax) {
    if (!fila) return null;
    return esMinMax
        ? adaptarMinMax(fila, sucursalId => ERP_NAMES[sucursalId])
        : fila;
}
