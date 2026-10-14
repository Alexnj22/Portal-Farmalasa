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

/* ¿Este aviso todavía espera una DECISIÓN de quien lo ve? (2026-10-12)
 *
 * Reporte del usuario: «si toco una y era solicitud se desaparece aun sin
 * confirmar ni descartar». La campana —del portal y de la app— marcaba leído al
 * tocar, y leído la sacaba de la lista. Pero leer no contesta: una solicitud,
 * un ajuste de Mín·Máx, un traslado o un envío por recibir se quedan hasta que
 * alguien los decide, y entonces el trigger `marcar_notificacion_solicitud_
 * resuelta` escribe `metadata.resuelta` y los da por leídos él mismo.
 *
 * Un envío no se aprueba con un botón (se recibe renglón por renglón), pero
 * igual espera: lo decide la sala con permiso de traslados. */
export function avisoEsperaDecision(n, hasPermission) {
    if (!n || n.metadata?.resuelta || n.deleted_at) return false;
    if (puedeDecidirAviso(n, hasPermission) || trasladoPorResolver(n, hasPermission)) return true;
    return n.type === 'REQUEST_PENDING' && esAvisoDeEnvio(n) && hasPermission('traslados', 'can_approve');
}

/** La clave con la que «Por decidir» nombra lo que un aviso pide decidir. */
export const claveDeDecision = (n) => (n?.type === 'MINMAX_PENDING'
    ? `minmax:${n.metadata?.request_id}`
    : String(n?.metadata?.request_id ?? ''));

/* ── Solicitud de mayorista (2026-10-14) ─────────────────────────────────────
 * Aviso `MAYORISTA_SOLICITUD` (link /mayoristas) a quien aprueba mayoristas
 * cuando un cliente lo pide desde la app. Espera decisión mientras
 * `clientes_mayoristas.estado` de ese `metadata.customer_id` siga en
 * 'solicitado' — no hay `metadata.resuelta` que lo marque. Por eso la regla
 * pide el conjunto de clientes todavía solicitados: sin él (quien no lo
 * cargó) no lo da por pendiente, para no dejar un aviso trabado para siempre. */
export const esAvisoDeMayorista = (n) => n?.type === 'MAYORISTA_SOLICITUD';

export const claveDeMayorista = (customerId) => `mayorista:${customerId}`;

/**
 * `avisoEsperaDecision` más la regla del mayorista.
 * @param {Set<string>} [mayoristasSolicitados]  customer_id con estado 'solicitado'
 */
export function avisoEsperaDecisionConMayoristas(n, hasPermission, mayoristasSolicitados) {
    if (esAvisoDeMayorista(n)) {
        if (!n || n.deleted_at || !mayoristasSolicitados) return false;
        return hasPermission('mayoristas', 'can_approve')
            && mayoristasSolicitados.has(String(n.metadata?.customer_id ?? ''));
    }
    return avisoEsperaDecision(n, hasPermission);
}

/** `claveDeDecision` más el mayorista (para no repetirlo en «Por decidir»). */
export const claveDeDecisionConMayoristas = (n) => (esAvisoDeMayorista(n)
    ? claveDeMayorista(n.metadata?.customer_id)
    : claveDeDecision(n));
