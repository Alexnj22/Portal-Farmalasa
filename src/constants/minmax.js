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
