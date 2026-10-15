// Catálogos de MIN·MAX que usa la lógica (`hooks/useMinMaxData`) y que la app
// nativa va a necesitar tal cual. Antes vivían en `views/productos/tabminmax/
// constants.js` mezclados con las clases de Tailwind de cada chip. La pantalla
// sigue teniendo su archivo, pero ahí sólo va el ESTILO, indexado por estas
// claves: así una clave nueva aparece en las dos o falla en la pantalla, en vez
// de existir en una sola sin avisar.

/** Nombre de cada estado de stock en la fila y en el título del filtro. */
export const ALERTA_ETIQUETA = {
    out_of_stock: 'Sin stock',
    below_min:    'Bajo mínimo',
    approaching:  'Próx. mínimo',
    ok:           'OK',
    overstocked:  'Exceso',
    dead_stock:   'Sin movimiento',
    no_data:      'Sin historial',
};

/** Los chips de conteo por estado, en el orden en que se muestran. */
export const ESTADOS_DE_STOCK = [
    { key: 'out_of_stock', label: 'Sin stock' },
    { key: 'below_min',    label: 'Bajo mínimo' },
    { key: 'approaching',  label: 'Próx. mínimo' },
    { key: 'ok',           label: 'OK' },
    { key: 'overstocked',  label: 'Excesos' },
    { key: 'dead_stock',   label: 'Sin movimiento' },
    { key: 'no_data',      label: 'Sin historial' },
];

// ── Ajuste a mano ────────────────────────────────────────────────────────────
// Los motivos son los mismos cuatro que acepta el CHECK de
// `product_stock_params.manual_motivo`, y salieron de las 16 razones que la
// gente YA escribía en las solicitudes de cambio — no de una lista inventada.
// Ver docs/planes-cerrados/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md §2.5.
export const MOTIVO_AJUSTE = {
    ya_no_rota:   { label: 'Ya no rota',        detalle: 'Se dejó de vender o sólo se trae por encargo' },
    lo_buscan:    { label: 'Lo están buscando', detalle: 'Hay demanda que no aparece porque no hubo producto' },
    cliente_fijo: { label: 'Cliente fijo',      detalle: 'Un cliente compra una cantidad conocida cada cierto tiempo' },
    otro:         { label: 'Otro',              detalle: 'Queda anotado, y la fila se revisa a mano' },
};

// Los estados de un ajuste. El orden es el de urgencia: lo primero que hay
// que mirar es lo que el cálculo contradice.
//
// «A mano» va primero porque es el más común y el más flojo: sólo dice que el
// número de hoy lo escribió una persona. Los otros tres son SELLADOS —solicitud
// aprobada o motivo declarado— y son los únicos que el cálculo del mes que
// viene respeta.
export const ESTADOS_DE_AJUSTE = [
    { key: 'a_mano',           label: 'A mano',
      ayuda: 'Este número lo escribió una persona en la revisión del mes. El cálculo del mes que viene lo va a reemplazar.' },
    { key: 'en_conflicto',     label: 'En conflicto',
      ayuda: 'Se aprobó una solicitud con este número y el cálculo propone otro. Hay que decidir cuál queda.' },
    { key: 'volvio_a_moverse', label: 'Volvió a moverse',
      ayuda: 'Se marcó como «ya no rota» y volvió a venderse. El motivo dejó de ser cierto.' },
    { key: 'respetado',        label: 'Respetado',
      ayuda: 'El ajuste sigue en pie y el cálculo no lo contradice.' },
];

// ── El historial de un MIN·MAX ───────────────────────────────────────────────
// Las acciones de la bitácora que cuentan qué le pasó al par de un producto en
// una sala, y cómo se rotula cada una. Vivían en la pantalla del portal; la
// app del teléfono pinta el mismo historial, así que van acá. Cada acción que
// se agrega a la lista necesita su rótulo: sin él la píldora publica el código
// crudo (pasó con `MINMAX_REQUEST_APPROVED`, 2026-08-14).
export const ACCIONES_DEL_HISTORIAL_MINMAX = [
    'MINMAX_LIVE_EDIT', 'MINMAX_DRAFT_EDIT',
    'MINMAX_BODEGA_MANUAL_OVERRIDE', 'MINMAX_BODEGA_RESET_MANUAL',
    'MINMAX_UPDATED_FROM_PEDIDO',
    'MINMAX_RESET_CALC', 'MINMAX_RESET_CLEAR', 'MINMAX_DISCARD_DRAFT',
    'MINMAX_ZERO_OUT', 'MINMAX_LIVE_ZERO', 'MINMAX_ZERO_ALL_BRANCHES',
    'MINMAX_REQUEST_APPROVED', 'MINMAX_MOTIVO_AJUSTE',
];

/** Rótulo y tono (`success`/`warning`/`danger`/`neutral`) de cada acción. */
export const HISTORIAL_MINMAX_META = {
    MINMAX_LIVE_EDIT:               { label: 'EN VIVO',        variante: 'success' },
    MINMAX_DRAFT_EDIT:              { label: 'BORRADOR',       variante: 'warning' },
    MINMAX_BODEGA_MANUAL_OVERRIDE:  { label: 'MANUAL BODEGA',  variante: 'neutral' },
    MINMAX_BODEGA_RESET_MANUAL:     { label: 'RESTAURADO',     variante: 'success' },
    MINMAX_UPDATED_FROM_PEDIDO:     { label: 'DESDE PEDIDOS',  variante: 'neutral' },
    MINMAX_RESET_CALC:              { label: 'RESTAURADO',     variante: 'success' },
    MINMAX_RESET_CLEAR:             { label: 'LIMPIADO',       variante: 'neutral' },
    MINMAX_DISCARD_DRAFT:           { label: 'DESCARTADO',     variante: 'neutral' },
    MINMAX_ZERO_OUT:                { label: 'PUESTO EN 0',    variante: 'danger' },
    MINMAX_LIVE_ZERO:               { label: 'PUESTO EN 0',    variante: 'danger' },
    MINMAX_ZERO_ALL_BRANCHES:       { label: '0 EN TODAS LAS SALAS', variante: 'danger' },
    MINMAX_REQUEST_APPROVED:        { label: 'SOLICITUD APROBADA', variante: 'success' },
    // Ésta NO trae old_min/new_min: no cambia números, declara POR QUÉ el
    // número está donde está. Quien la pinte la trata aparte.
    MINMAX_MOTIVO_AJUSTE:           { label: 'MOTIVO',         variante: 'neutral' },
};
