/**
 * Corte Z — el cotejo del Gran Z mensual contra el libro, dicho una vez para
 * el portal (`CorteZView`) y la app. Se mudó el 2026-10-05.
 *
 * El cotejo se ancla en la línea GRAVADAS del ticket, no en su TOTAL: el ticket
 * resta la retención dos veces (ver la nota larga de `CorteZView`).
 */

/** Medio centavo: por debajo de eso es ruido de coma flotante, no una diferencia. */
export const CUADRA_Z = 0.005;
export const cuadraZ = (n) => Math.abs(Number(n) || 0) < CUADRA_Z;

/** Las filas de «Para la declaración», con su clave en `declaracion.factura` / `.ccf`. */
export const FILAS_DECLARACION = [
    ['Ventas exentas',  'exentas'],
    ['Ventas gravadas', 'gravadas'],
    ['Débito fiscal',   'debito'],
    ['IVA retenido',    'retenido'],
];

/**
 * Qué significa cada causa que encontró el cuadre diario, y qué hacer con ella.
 * El texto es de negocio: quien lee esto está armando una declaración, no
 * depurando la carga.
 */
export const CAUSAS_CORTE_Z = {
    // «El sistema perdió…» se leía como si el portal fuera el que la perdió, que
    // es justo al revés. Se dice el HECHO sin atribuirlo.
    origen_perdio_fila: {
        que: 'Venta que ya no está registrada',
        hacer: 'Tiene sello de Hacienda y sigue siendo válida, pero su registro se perdió. Volver a traerla no la recupera: hay que reportarlo para que la restauren.',
    },
    anulado_sin_invalidar: {
        que: 'Venta anulada que nunca se invalidó ante Hacienda',
        hacer: 'Tiene sello y no está en el anexo de anulados, así que para Hacienda sigue vigente. Hay que invalidarla como corresponde, o el libro tiene que llevarla.',
    },
    falta_en_portal: { que: 'Falta esta venta', hacer: 'Se recupera volviendo a traer ese día.' },
    sin_sello: { que: 'Todavía sin el sello de Hacienda', hacer: 'Sin sello no entra al libro. Se resuelve solo cuando el sello llega.' },
    anulado: { que: 'Documento anulado', hacer: 'El libro lo excluye con razón.' },
    dte_inexistente: { que: 'El documento no existe en Hacienda', hacer: 'Hay que revisarlo: el libro no puede llevar una venta sin documento.' },
    monto_distinto: { que: 'El monto no coincide', hacer: 'Se corrige volviendo a traer ese día.' },
    sin_clasificar: { que: 'Sin causa determinada', hacer: 'Hay que revisarlo a mano.' },
};
export const causaDeCorteZ = (clave) => CAUSAS_CORTE_Z[clave] || CAUSAS_CORTE_Z.sin_clasificar;

/** Los documentos que explican el residuo, con su fecha, y lo que queda sin explicar. */
export function documentosQueDifieren(fila) {
    const hallazgos = Array.isArray(fila?.hallazgos) ? fila.hallazgos : [];
    return {
        docs: hallazgos.flatMap((h) => (h.documentos ?? []).map((d) => ({ ...d, fecha: h.fecha }))),
        sinExplicar: hallazgos.reduce((s, h) => s + Math.abs(Number(h.sin_explicar) || 0), 0),
    };
}

/**
 * Los totales del encabezado. Las de ventas gravadas, igual que las tarjetas:
 * sumar los totales del ticket dejaría el encabezado corto por la retención
 * duplicada.
 */
export function totalesCorteZ(filas) {
    let total = 0, factura = 0, ccf = 0, difieren = 0;
    for (const f of filas || []) {
        total   += Number(f.z_total) || 0;
        factura += Number(f.z_factura) || 0;
        ccf     += Number(f.z_ccf) || 0;
        if (!cuadraZ(f.dif_total)) difieren++;
    }
    return { total, factura, ccf, difieren, sucursales: (filas || []).length };
}
