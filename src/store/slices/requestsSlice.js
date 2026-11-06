import { notifyEmployees } from '../../utils/notify';
// El horario se escribe UN día a la vez desde el 2026-08-27: leer el roster,
// tocarle una clave y reescribirlo entero pierde lo que otra sesión haya
// guardado en otro día de esa misma semana.

// ============================================================================
// 📋 SOLICITUDES — Employee-initiated requests requiring admin approval
// ============================================================================

// Bucket B (DESIGN.md §6) — categórico genuino, sin jerarquía de severidad
// entre tipos de solicitud. chart-1..9 asignados por hue más cercano al
// crudo original; 3 pares reusan token (mismo criterio que el crudo
// original, que ya repetía 'purple' entre PERMIT/VENDOR_CHANGE_REQUEST).
// `variante` es el nombre de la variante de `Badge`/`SegmentedControl`; el
// `color`/`border` de al lado es la MISMA paleta escrita a mano y queda solo
// para los sitios que aún no migraron. Se agregó el 2026-07-28 al migrar los
// chips (D3.5): sin él, cada vista sacaba el `chart-N` con un regex sobre la
// clase de Tailwind — que es adivinar el dato en vez de tenerlo.
export const REQUEST_TYPES = {
    VACATION:     { label: 'Vacaciones',         color: 'bg-warning/10 text-warning-text', border: 'border-warning/30', variante: 'warning' },
    PERMIT:       { label: 'Permiso / licencia', color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    SHIFT_CHANGE: { label: 'Cambio de turno',    color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    OVERTIME:     { label: 'Horas extra',        color: 'bg-chart-4/10 text-chart-4-text', border: 'border-chart-4/30', variante: 'chart-4' },
    ADVANCE:      { label: 'Anticipo salarial',  color: 'bg-success/10 text-success-text', border: 'border-success/30', variante: 'success' },
    CERTIFICATE:  { label: 'Constancia Laboral', color: 'bg-chart-1/10 text-chart-1-text', border: 'border-chart-1/30', variante: 'chart-1' },
    DISABILITY:             { label: 'Incapacidad',             color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    /* Faltaba, y era el único de los 16 tipos que la base admite sin rótulo acá
     * (2026-08-15). No es hipotético: lo crea el plan de vacaciones cuando
     * alguien pide correr sus fechas, y `fetchVacationChangeRequests` lo
     * consulta. Postgres YA lo sabía nombrar —el disparador del aviso lo llama
     * «Cambio de vacaciones» desde hace meses—, así que quien lo pedía recibía
     * un aviso en castellano y después lo encontraba en la bandeja rotulado
     * `VACATION_CHANGE`. Se usa la misma cadena que la base, no una parecida.
     * El mismo amarillo que VACATION: es la misma familia. */
    VACATION_CHANGE:        { label: 'Cambio de vacaciones', color: 'bg-warning/10 text-warning-text', border: 'border-warning/30', variante: 'warning' },
    SHIFT_EXCEPTION:        { label: 'Excepción de turno', color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    ANNULMENT_REQUEST:      { label: 'Anulación de factura',    color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    PAYMENT_CHANGE_REQUEST: { label: 'Cambio de forma de pago', color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    VENDOR_CHANGE_REQUEST:  { label: 'Cambio de vendedor',      color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    CLIENT_CHANGE_REQUEST:  { label: 'Cambio de cliente',       color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    INVENTORY_LOAD_REQUEST:    { label: 'Carga de inventario',    color: 'bg-chart-1/10 text-chart-1-text', border: 'border-chart-1/30', variante: 'chart-1' },
    INVENTORY_DISCARD_REQUEST: { label: 'Descarte de inventario', color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    // Faltaba, y se notaba: la Bandeja agrupa por tipo usando este rótulo, así
    // que un traslado pendiente encabezaba su sección con la clave cruda
    // `INVENTORY_TRANSFER_REQUEST`. Su pantalla propia es `/traslados` —acá se
    // ve para saber que existe, no para resolverlo.
    INVENTORY_TRANSFER_REQUEST:{ label: 'Traslado entre salas',   color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    // Una sala manda producto a otra sin que se lo pidan. También faltaba.
    INVENTORY_TRANSFER_PUSH:   { label: 'Envío entre salas',      color: 'bg-chart-3/10 text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' },
    // Anular o corregir el monto de un movimiento de caja ya anotado. Sin este
    // rótulo la bandeja agrupaba la sección bajo la clave cruda
    // `CAJA_MOVIMIENTO_CHANGE` — el mismo defecto que arriba, y por eso va con
    // el mismo comentario a la vista.
    ABONO_APROBACION:          { label: 'Abono por aprobar', color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    ABONO_CREDITO_CHANGE:      { label: 'Corrección de un abono', color: 'bg-chart-6/10 text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' },
    CAJA_MOVIMIENTO_CHANGE:    { label: 'Corrección de caja',     color: 'bg-chart-4/10 text-chart-4-text', border: 'border-chart-4/30', variante: 'chart-4' },
    // Un ingreso con tarjeta o transferencia que llegó sin foto del comprobante.
    CAJA_INGRESO_AUTORIZACION: { label: 'Movimiento sin comprobante', color: 'bg-chart-4/10 text-chart-4-text', border: 'border-chart-4/30', variante: 'chart-4' },
    // Vive en otra tabla (`minmax_change_requests`) pero se muestra en el mismo
    // centro: para quien mira la sala es una solicitud más. Ver `adaptarMinMax`.
    MINMAX_CHANGE_REQUEST:     { label: 'Ajuste de Min/Max',      color: 'bg-chart-4/10 text-chart-4-text', border: 'border-chart-4/30', variante: 'chart-4' },
    // Un vendedor de Distribución pide un descuento que no puede dar solo
    // (borrador distribucion/0008). La venta queda como preventa hasta que se
    // decida.
    DIST_DESCUENTO:            { label: 'Descuento en una venta', color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
    // Corregir o deshacer un documento sellado de Distribución (auditoría H3):
    // el vendedor ya no invalida solo, lo pide.
    DIST_INVALIDACION:         { label: 'Invalidar un documento', color: 'bg-chart-9/10 text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' },
};

/**
 * El nombre de un tipo de solicitud para mostrar. Nunca la clave cruda: un
 * tipo nuevo sin rótulo se lee «Solicitud», no `CAJA_INGRESO_AUTORIZACION`
 * (usuario, 2026-10-21: «nunca se vean los textos así en ningún lado»).
 */
export const rotuloDeSolicitud = (tipo) => REQUEST_TYPES[tipo]?.label ?? 'Solicitud';

/**
 * Las cuatro solicitudes que hablan de una FACTURA, no del expediente de quien
 * las pide. Salen del widget «Solicitar Modificación a Facturación».
 *
 * Se distinguen del resto por dos cosas, y las dos estaban mal:
 *
 *  1. **Un solo nivel de aprobación.** El escalado genérico las llevaba a tres:
 *     supervisor → supervisor/admin → Talento Humano. RRHH no tiene nada que
 *     decidir sobre la anulación de una factura, y el widget ya le promete a
 *     quien la envía que resuelve Supervisión ("Supervisión fue notificada y
 *     revisará la solicitud").
 *  2. **No dejan rastro en el legajo.** `registerEmployeeEvent` las anotaba en
 *     `employee_events` con `type: 'ANNULMENT_REQUEST'`, o sea que pedir anular
 *     una venta quedaba en el historial laboral del vendedor junto a permisos,
 *     vacaciones e incapacidades. La tabla no tiene CHECK que lo frenara.
 */
export const FACTURACION_REQUEST_TYPES = new Set([
    'ANNULMENT_REQUEST',
    'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST',
    'CLIENT_CHANGE_REQUEST',
]);

/**
 * Las dos que mueven EXISTENCIAS: la carga y el descarte de inventario.
 *
 * Valen las mismas dos razones que para facturación —un nivel de aprobación, y
 * nada que anotar en el legajo de quien la pide— más una tercera propia:
 * aprobar ES sacar o meter producto de verdad, y no se puede deshacer con un
 * clic. Revertir un descarte es hacer una carga por la misma cantidad, con otro
 * asiento en el kardex.
 */
export const INVENTARIO_REQUEST_TYPES = new Set([
    'INVENTORY_LOAD_REQUEST',
    'INVENTORY_DISCARD_REQUEST',
]);

/**
 * La que corrige un movimiento de CAJA ya anotado.
 *
 * Mismas dos razones que las de arriba —un nivel, nada que anotar en el legajo—
 * y una propia: aprobarla **borra o reescribe una línea de la caja del día**.
 * Quien la pidió no la puede aprobar, y eso no lo decide esta pantalla: lo
 * rechaza la propia función.
 */
export const CAJA_REQUEST_TYPES = new Set([
    'CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE',
    'ABONO_APROBACION',
]);

/**
 * La de Distribución: aprobar APLICA el descuento a la venta, rechazar lo deja
 * como estaba. Las dos las hace `dist_resolver_descuento` en la base —que
 * también impide que quien lo pidió se lo apruebe y avisa al vendedor—, así
 * que ni aprobar ni rechazar pasan por el camino genérico.
 */
export const DISTRIBUCION_REQUEST_TYPES = new Set([
    'DIST_DESCUENTO',
    // Invalidar un sellado: aprobarla firma el evento con el nombre de quien
    // aprueba y lo manda a Hacienda (edge `distribucion-dte`).
    'DIST_INVALIDACION',
]);

/**
 * Un ingreso con tarjeta o transferencia sin foto del comprobante
 * (2026-10-17). Aprobar y rechazar los hace `caja_ingreso_resolver` en la base:
 * firma, impide autoaprobar, deja el movimiento en su estado y le avisa a quien
 * lo anotó. Rechazar NO anula el ingreso: queda para reenviarlo con más pruebas.
 */
export const INGRESO_AUTORIZACION_TYPES = new Set([
    'CAJA_INGRESO_AUTORIZACION',
]);

/** Las que se aplican en un sistema externo al aprobarlas. */
export const REQUEST_TYPES_QUE_SE_APLICAN = new Set([
    ...FACTURACION_REQUEST_TYPES,
    ...INVENTARIO_REQUEST_TYPES,
    ...CAJA_REQUEST_TYPES,
    ...DISTRIBUCION_REQUEST_TYPES,
]);

/**
 * OPERATIVAS: hablan de la SALA — su existencia y sus facturas.
 *
 * Las otras hablan de una PERSONA (vacaciones, permiso, incapacidad, anticipo,
 * constancia) y van por el módulo `requests_personales`, con su propia pantalla.
 *
 * **Este conjunto es el espejo de `es_solicitud_operativa()` en Postgres**, que
 * es quien manda: las policies de `approval_requests` deciden con esa función.
 * Si acá se agrega un tipo y allá no —o al revés— la pantalla y el RLS dejan de
 * coincidir, y el síntoma es de los mudos: la lista llega vacía sin error, o
 * peor, muestra de más. Al tocar uno, tocar el otro en la misma sesión.
 *
 * **Y ya pasó** (2026-09-03): las tres de caja se agregaron a
 * `es_solicitud_operativa()` entre el 31-ago y el 2-sep y acá no. El RLS las
 * dejaba pasar como operativas, o sea que la fila LLEGABA al navegador, y esta
 * línea la tiraba — `esOperativa(r.type) === esSucursal` da `false === true`.
 * Quien la pedía la veía en la bandeja PERSONAL, mezclada con vacaciones (entra
 * por `employee_id = auth_employee_id()`); quien tenía que decidirla no la veía
 * en ninguna pantalla, sólo en la campana. Cero filas de esos tipos en
 * producción, así que nadie lo topó — pero el defecto estaba servido.
 */
export const TIPOS_OPERATIVOS = new Set([
    ...FACTURACION_REQUEST_TYPES,
    ...INVENTARIO_REQUEST_TYPES,
    ...CAJA_REQUEST_TYPES,
    ...DISTRIBUCION_REQUEST_TYPES,
    ...INGRESO_AUTORIZACION_TYPES,
    'INVENTORY_TRANSFER_REQUEST',
]);

export const esOperativa = (type) => TIPOS_OPERATIVOS.has(type);

/**
 * Lo devuelve `approveRequest` cuando la rama que falló YA mostró su motivo.
 *
 * El store de toasts tiene UNA sola ranura (`showToast` pisa el anterior y le
 * reinicia el temporizador), así que el aviso genérico de la vista —«No se pudo
 * procesar la acción.»— borraba el mensaje específico que acababa de escribir
 * la rama. Los dos salían; el usuario solo alcanzaba a ver el segundo.
 *
 * Eso escondió un rechazo real el 2026-08-11: la anulación de la 0000068132_COF
 * no entró, el motivo llegó al navegador dentro del cuerpo de la respuesta, y
 * la pantalla lo reemplazó por el genérico. Sin el motivo no había nada que
 * corregir ni que reintentar con criterio.
 *
 * Es un tercer valor a propósito, y no un `false` con bandera aparte: quien
 * agregue mañana una rama que avisa por su cuenta tiene que elegir qué
 * devuelve, y el `if (ok)` de la vista no lo deja pasar por descuido.
 */
export const YA_AVISADO = 'YA_AVISADO';

/**
 * Min/Max no vive en `approval_requests` sino en su propia tabla
 * (`minmax_change_requests`), con otras columnas y otro ciclo. Pero para quien
 * mira la sala **es una solicitud más**, y tenerla en otra pantalla era parte
 * de lo que el usuario pidió arreglar: «que no se tenga que andar perdido
 * buscando en varios lados».
 *
 * Se adapta a la forma de una solicitud para poder mostrarla en la misma lista.
 * El id lleva prefijo para que no choque con un uuid de `approval_requests`, y
 * la fila original viaja en `_minmax` porque decidirla usa sus propias RPC.
 */
export const MINMAX_REQUEST_TYPE = 'MINMAX_CHANGE_REQUEST';

const ESTADO_MINMAX = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };

/**
 * @param buscarPersona  Opcional: `(idOEmail) => empleado | null`. Sirve para
 *   ponerle cara a las dos personas de un ajuste de Min/Max, que su tabla guarda
 *   como texto suelto: quien lo pidió por `requested_by_id` (uuid) y quien lo
 *   decidió por `decided_by`, que es el **correo** con el que entró (así lo
 *   escribe `approve_minmax_request`: `auth.email()`). Sin el buscador se cae al
 *   texto guardado, que es lo que se mostraba hasta ahora.
 */
export function adaptarMinMax(fila, nombreDeSucursal, buscarPersona) {
    const pidio  = buscarPersona?.(fila.requested_by_id) ?? null;
    const decidio = fila.decided_by ? (buscarPersona?.(fila.decided_by) ?? null) : null;
    return {
        id: `minmax:${fila.id}`,
        type: MINMAX_REQUEST_TYPE,
        status: ESTADO_MINMAX[String(fila.status ?? '').toLowerCase()] ?? 'PENDING',
        note: fila.reason ?? null,
        approver_note: fila.decision_note ?? null,
        created_at: fila.requested_at,
        updated_at: fila.decided_at ?? fila.requested_at,
        decided_at: fila.decided_at ?? null,
        employee_id: fila.requested_by_id ?? null,
        employee: pidio
            ?? { id: fila.requested_by_id, name: fila.requested_by_name ?? fila.requested_by ?? 'Alguien' },
        // Sin `decided_by` no hay a quién nombrar: el ajuste no lo decide un
        // aprobador asignado de antemano, lo resuelve quien tenga el permiso.
        approver: decidio
            ?? (fila.decided_by ? { id: fila.decided_by, name: fila.decided_by } : null),
        approvals: [],
        metadata: {
            producto: fila.product_name,
            erp_product_id: fila.erp_product_id,
            erp_sucursal_id: fila.erp_sucursal_id,
            branch_name: nombreDeSucursal?.(fila.erp_sucursal_id) ?? null,
            min_actual: fila.current_min, max_actual: fila.current_max,
            min_pedido: fila.requested_min, max_pedido: fila.requested_max,
            ventas_6m: fila.current_sales_6m,
            // Las dos que separan «vende poco» de «dejó de venderse» (2026-08-14).
            // Son el retrato del momento en que se propuso, como `ventas_6m`.
            ventas_mes: fila.current_sales_mes,
            ultima_venta: fila.current_ultima_venta,
            existencia: fila.current_existencia,
        },
        _minmax: fila,
    };
}

// Bucket A — severidad real del estado de la solicitud.
export const REQUEST_STATUS = {
    PENDING:   { label: 'Pendiente',  color: 'bg-warning/10 text-warning-text',  border: 'border-warning/30',  dot: 'bg-warning', variante: 'warning' },
    APPROVED:  { label: 'Aprobada',   color: 'bg-success/10 text-success-text', border: 'border-success/30', dot: 'bg-success', variante: 'success' },
    REJECTED:  { label: 'Rechazada',  color: 'bg-danger/10 text-danger-text',   border: 'border-danger/30',  dot: 'bg-danger', variante: 'danger' },
    CANCELLED: { label: 'Cancelada',  color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3', variante: 'neutral' },
};

// ── Helpers internos ────────────────────────────────────────────────────────

export const parseMeta = (raw) =>
    typeof raw === 'object' && raw !== null
        ? raw
        : (() => { try { return JSON.parse(raw); } catch { return {}; } })();

/**
 * Notifica al empleado el resultado de su solicitud vía el canal de
 * notificaciones (campana + push). No lanza error — es no-bloqueante.
 */
/**
 * `instruccion` es lo que quien pidió la solicitud tiene que HACER ahora, y no
 * es lo mismo que la nota de quien decidió: la nota es opcional y la escribe una
 * persona; la instrucción la produce el circuito y su ausencia deja trabajo sin
 * terminar. Hoy la única es la del crédito fiscal emitido a quien no es
 * contribuyente — se anula sólo en el sistema y hay que volver a facturar la
 * venta como Consumidor Final, porque si no queda sin documento tributario.
 *
 * Va en el aviso y no sólo en la pantalla del detalle: quien pidió la anulación
 * es una sala, y lo que abre es el aviso.
 */
/* Lo que dibuja la tarjeta de la campana (24-sep): la solicitud en datos —la
 * factura, qué cambia, los productos, las fechas— y la nota de quien decidió.
 * Quién decidió NO va acá: lo firma `avisar_a_empleados` con la sesión de quien
 * llama, así que no se puede escribir a mano. */
// «CCF» y «COF» y no el nombre largo: «más corto y se entiende» (usuario, 24-sep).
const DOC_DE = { CCF: 'CCF', COF: 'COF' };
const numero = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const decisionParaLaTarjeta = (requestType, typeLabel, status, m, approverNote, instruccion) => {
    const items = Array.isArray(m.items) ? m.items : [];
    const cambio = {
        PAYMENT_CHANGE_REQUEST: [m.current_pago, m.new_pago],
        VENDOR_CHANGE_REQUEST:  [m.current_vendor_name, m.new_vendor_name],
        CLIENT_CHANGE_REQUEST:  [m.current_cliente, m.new_client_name],
    }[requestType] ?? [null, null];
    const d = {
        tipo: requestType,
        etiqueta: typeLabel,
        estado: status,
        sala: m.branch_name || null,
        fecha: m.fecha || null,
        monto: numero(m.total ?? m.monto),
        // Con el id de la venta, `avisar_a_empleados` agrega el cliente, la
        // forma de pago y la hora (24-sep: «no sé cuál es»).
        invoice_id: m.invoice_id || null,
        doc: DOC_DE[m.tipo_documento] || null,
        antes: cambio[0] || null,
        despues: cambio[1] || null,
        productos: items.slice(0, 3).map(it => ({
            nombre: it.descripcion || it.nombre || 'Producto',
            cantidad: numero(it.cantidad),
        })),
        mas: Math.max(items.length - 3, 0) || null,
        desde: m.startDate || m.date || null,
        hasta: m.endDate || null,
        nota: approverNote || null,
        instruccion: instruccion || null,
    };
    return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)));
};

export const notifyEmployee = async (employeeId, approverId, requestType, status, approverNote, reqMetadata = {}, instruccion = null) => {
    const typeLabel = REQUEST_TYPES[requestType]?.label || requestType;
    const isApproved = status === 'APPROVED';
    const cola = instruccion ? ` ${instruccion}` : '';
    await notifyEmployees([String(employeeId)], {
        type: 'REQUEST_DECIDED',
        // El estado va después del rótulo y no concordando con él: «Abono por
        // aprobar aprobada» o «Descarte de inventario aprobada» no se leen.
        title: `${typeLabel} · ${isApproved ? 'Aprobada' : 'Rechazada'}`,
        body: isApproved
            ? `Tu solicitud de ${typeLabel} fue aprobada.${approverNote ? ` Nota: "${approverNote}"` : ''}${cola}`
            : `Tu solicitud de ${typeLabel} fue rechazada.${approverNote ? ` Motivo: "${approverNote}"` : ''}`,
        /* La pantalla depende del TIPO, no del aviso. Acá estaba fijo en
         * `/requests-personales`, así que a quien pidió una anulación o un
         * descarte —un dependiente de sala, que no tiene permiso sobre lo
         * personal— el aviso «tu solicitud fue aprobada» lo mandaba a una
         * pantalla que le rebota. Y es el aviso que más se toca: es el que
         * cierra el asunto. */
        link: esOperativa(requestType) ? '/solicitudes' : '/solicitudes-personales',
        push: true,
        metadata: {
            requestType,
            status,
            approverNote: approverNote || null,
            instruccion: instruccion || null,
            // Cambio de turno
            targetEmployeeName: reqMetadata.targetEmployeeName || null,
            date: reqMetadata.date || null,
            myShift: reqMetadata.myShift || null,
            targetShift: reqMetadata.targetShift || null,
            // Vacaciones / Permiso / Incapacidad
            startDate: reqMetadata.startDate || null,
            endDate: reqMetadata.endDate || null,
            days: reqMetadata.days || null,
            permissionDates: reqMetadata.permissionDates || null,
            // Anticipo
            amount: reqMetadata.amount || null,
            // Constancia
            certificateType: reqMetadata.certificateType || null,
            decision: decisionParaLaTarjeta(requestType, typeLabel, status, reqMetadata || {}, approverNote, instruccion),
        },
    });
};

/**
 * El aviso a quien pidió, cuando la decisión SÍ entró pero su respuesta se
 * perdió en el camino (2026-09-30: una anulación aprobada desde el teléfono
 * tardó 16 s con Hacienda, el servidor respondió bien y el teléfono no recibió
 * la respuesta; la anulación quedó hecha y a quien la pidió nunca le llegó el
 * aviso). Lo usa `decidirSolicitud` después de releer la solicitud.
 */
export async function avisarDecisionAlQuePidio(fila, approverId) {
    if (!fila?.employee_id) return;
    const meta = parseMeta(fila.metadata);
    await notifyEmployee(fila.employee_id, approverId, fila.type, fila.status,
        fila.approver_note ?? '', meta, meta?.erp_aplicado?.instruccion ?? null);
}

// ── Helpers de Incapacidad ──────────────────────────────────────────────────



// Las acciones (`createRequestsSlice`) y los ayudantes que sólo ellas usan
// viven en `requestsAcciones.js` y se bajan al primer uso.
