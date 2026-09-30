// Quién puede decidir qué DESDE un aviso — la campana del portal y la pestaña
// Notificaciones de la app, con la misma regla (2026-09-30). Vivía dentro de
// `useAccionesDeAviso`, que es de la web; el teléfono la habría tenido que
// copiar, y una copia de «quién puede aprobar» es justo lo que no puede haber.
import { MODULO_QUE_DECIDE } from '../constants/solicitudModulos';

/* Cada solicitud con SU permiso, y desde v2.576.0 eso ya no es «uno por
 * pantalla» sino uno por FAMILIA: quien puede anular una factura no
 * necesariamente puede aprobar un descarte de inventario. El aviso trae el
 * tipo en `metadata.request_type`, así que se resuelve por solicitud y no
 * por una bandera calculada una vez para todas.
 *
 * `MODULO_QUE_DECIDE` es el mismo mapa que usa la bandeja y el espejo de
 * `modulo_de_aprobacion()` en Postgres. */
export function moduloDelAviso(n) {
    if (n?.type === 'MINMAX_PENDING') return 'requests_minmax';
    if (n?.type !== 'REQUEST_PENDING') return null;
    return MODULO_QUE_DECIDE[n.metadata?.request_type] ?? 'requests';
}

/* Un traslado NO se decide con Aprobar: confirmarlo relee la existencia de la
   sala de origen justo antes de despachar. Aprobarlo por fuera lo marcaría
   APROBADO **sin mover nada** y lo haría desaparecer de las tres pestañas de
   Traslados. */
export const esAvisoDeTraslado = (n) => n?.metadata?.request_type === 'INVENTORY_TRANSFER_REQUEST';

/* Un ENVÍO tampoco (24-sep): se acepta o devuelve producto por producto en
   Traslados → Envíos. No tiene módulo en `MODULO_QUE_DECIDE`, así que caía
   en `requests` y a quien pudiera aprobar solicitudes la campana le
   ofrecía «Aprobar» — que lo marcaría aprobado sin tocar un solo renglón. */
export const esAvisoDeEnvio = (n) => n?.metadata?.request_type === 'INVENTORY_TRANSFER_PUSH';

/* `resuelta` la escribe el trigger `marcar_notificacion_solicitud_resuelta`
   en el momento en que la solicitud deja de estar PENDING. Sin eso, el aviso
   seguiría ofreciendo Aprobar/Rechazar sobre algo ya decidido. */
export function puedeDecidirAviso(n, hasPermission) {
    if (esAvisoDeTraslado(n) || esAvisoDeEnvio(n)) return false;
    const modulo = moduloDelAviso(n);
    return !!modulo && hasPermission(modulo, 'can_approve')
        && !!n.metadata?.request_id && !n.metadata?.resuelta;
}

export function trasladoPorResolver(n, hasPermission) {
    return n?.type === 'REQUEST_PENDING' && esAvisoDeTraslado(n) && !n.metadata?.resuelta
        && hasPermission('traslados', 'can_approve');
}
