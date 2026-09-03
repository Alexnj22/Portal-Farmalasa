/* Qué módulo de permisos gobierna DECIDIR cada tipo de solicitud.
 *
 * Espejo de `modulo_de_aprobacion()` en Postgres (migración 20260812222426, y
 * `requests_minmax` en 20260812225237). Desde v2.576.0 aprobar dejó de ser un
 * solo interruptor: la base lo cobra por familia, para poder delegar una parte
 * sin entregar el resto.
 *
 * **La base es la que manda** — la policy rechaza igual. Esto sólo evita
 * ofrecer un botón condenado a rebotar. Si las dos listas dejan de coincidir el
 * síntoma es feo y mudo: un botón que falla sin explicar nada, o uno que falta
 * cuando sí se podía. Al agregar un tipo, se agrega en los DOS lados.
 *
 * ── Por qué en un archivo propio y no en `permissionModules.js` ────────────
 * Dos motivos, y el segundo no es obvio:
 *
 *  1. Lo consultan DOS pantallas —la bandeja y la campana—. Una copia en cada
 *     una es la forma segura de que dentro de un mes digan cosas distintas.
 *  2. `npm run gate:permisos` cruza el REGISTRO contra el CÓDIGO, y no se lee a
 *     sí mismo: un módulo cuya única mención viviera dentro de
 *     `permissionModules.js` figuraría como «declarado y que nadie consulta»,
 *     o sea como un interruptor muerto. Acá los literales quedan del lado del
 *     código, que es donde de verdad están.
 *
 * Los traslados NO figuran: no se deciden desde la bandeja sino en Traslados,
 * que relee la existencia de la sala antes de despachar. Lo que no está acá cae
 * en el módulo del ámbito —`requests` para la sala, `requests_personales` para
 * lo de la persona—, igual que en la policy.
 */
export const MODULO_QUE_DECIDE = {
    ANNULMENT_REQUEST:         'requests_facturacion',
    PAYMENT_CHANGE_REQUEST:    'requests_facturacion',
    VENDOR_CHANGE_REQUEST:     'requests_facturacion',
    CLIENT_CHANGE_REQUEST:     'requests_facturacion',
    INVENTORY_LOAD_REQUEST:    'requests_inventario',
    INVENTORY_DISCARD_REQUEST: 'requests_inventario',
    MINMAX_CHANGE_REQUEST:     'requests_minmax',
    // Anular o corregir el monto de un movimiento de caja ya anotado. Quien lo
    // anotó NO puede deshacerlo: un movimiento ya contado es dinero, y borrarlo
    // en silencio es justamente lo que la bitácora existe para impedir.
    CAJA_MOVIMIENTO_CHANGE:    'requests_caja',
    // Anular un abono ya cobrado, o corregirle el monto o la forma de pago.
    // Módulo propio y no `requests_caja`: son dos públicos, y con un solo
    // interruptor dar uno regala el otro.
    ABONO_CREDITO_CHANGE:      'requests_cuentas_por_cobrar',
    /* Un abono que se manda a aprobación. Se PIDE con un interruptor y no se
     * deduce de la forma de pago —son dos preguntas distintas—, salvo «Otro»,
     * que la enciende siempre. Es por PAGO y no por abono: una liquidación que
     * cubre tres créditos no necesita tres firmas. */
    ABONO_APROBACION:          'requests_cuentas_por_cobrar',
};

/**
 * Quién resuelve cada familia, dicho para una pantalla.
 *
 * Las tres del dinero se deciden por PERMISO —cualquiera de los que lo tengan—
 * y no por un nombre elegido al crear la solicitud. Pero `approver_id` guarda a
 * UNO (el primer destinatario, para que salga el aviso), y la ficha lo pintaba
 * como si fuera el único: «Pendiente de CARLOS RENDEROS · Esperando hace 53
 * min» sobre algo que podían resolver cuatro personas. Se lee como que hay que
 * esperar a esa persona, y si está de vacaciones, como que no hay a quién
 * recurrir.
 *
 * Decisión del usuario (2026-09-03): nombrar el ÁREA, sin cara. Es el mismo
 * criterio que ya usaba el ajuste de Min/Max —«Quien administre Min/Max»— y por
 * el mismo motivo.
 *
 * **Sólo cuando hay más de uno** (refinamiento del mismo día): con un solo
 * aprobador, nombrarlo es el dato útil — se sabe a quién ir a buscar. Cuántos
 * son lo escribe el trigger que los busca, en `metadata.aprobadores_n`; el
 * navegador no puede contarlos.
 */
export const QUIEN_RESUELVE = {
    CAJA_MOVIMIENTO_CHANGE:    'Quien apruebe correcciones de caja',
    ABONO_CREDITO_CHANGE:      'Quien apruebe cuentas por cobrar',
    ABONO_APROBACION:          'Quien apruebe cuentas por cobrar',
};
