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
};
