/**
 * Libros de IVA — los totales de cada libro del mes. Vivía en
 * `LibrosIvaView`; se mudó el 2026-10-05 para que la app sume igual que el
 * portal (y que el ZIP, que los pide por sucursal).
 */

export const IVA_TASA = 0.13;

// El débito fiscal de las ventas a consumidor no está en ninguna columna: se
// calcula, porque el precio al público YA lleva el IVA adentro. Art. 83 lo pide
// explícitamente ("un resumen de cálculo del débito fiscal ... el cual se
// trasladará al libro de operaciones con contribuyentes").
export const debitoDeConsumidor = (gravadas) => gravadas * IVA_TASA / (1 + IVA_TASA);

// ── Totales de un juego de libros ────────────────────────────────────────────
//
// A nivel de módulo y no dentro del componente porque el ZIP los necesita **por
// sucursal**: cada archivo del paquete lleva su propia fila de TOTALES, y
// calcularla sobre el total del mes le pondría a cada sucursal el número de
// todas.
export const calcularTotales = (d) => {
    const suma = (filas, campo) => filas.reduce((s, r) => s + Number(r[campo] || 0), 0);
    const gravadasCons = suma(d.consumidor, 'ventas_gravadas');

    return {
        consumidor:    { docs: suma(d.consumidor, 'documentos'),
                         exentas: suma(d.consumidor, 'ventas_exentas'),
                         gravadas: gravadasCons,
                         debito: debitoDeConsumidor(gravadasCons),
                         total: suma(d.consumidor, 'total_diario') },
        contribuyente: { docs: d.contribuyente.length,
                         exentas: suma(d.contribuyente, 'ventas_exentas'),
                         gravadas: suma(d.contribuyente, 'ventas_gravadas'),
                         debito: suma(d.contribuyente, 'debito_fiscal'),
                         // El 1% que retuvo el cliente. No baja la venta ni el
                         // débito: es impuesto ya enterado por él, y por eso el
                         // total del documento es menor que gravadas + débito.
                         retencion: suma(d.contribuyente, 'retencion_iva'),
                         total: suma(d.contribuyente, 'total') },
        anulados:      { docs: d.anulados.length, exentas: 0, gravadas: 0, debito: 0,
                         total: suma(d.anulados, 'total') },
        // En compras la tercera tarjeta es el crédito fiscal, no el débito:
        // es el impuesto que se resta, no el que se paga.
        compras:       { docs: d.compras.length,
                         exentas:  suma(d.compras, 'compras_exentas'),
                         gravadas: suma(d.compras, 'compras_gravadas'),
                         debito:   suma(d.compras, 'credito_fiscal'),
                         total:    suma(d.compras, 'total') },
        percepcion:    { docs: d.percepcion.length, exentas: 0,
                         gravadas: suma(d.percepcion, 'monto_sujeto'),
                         debito:   suma(d.percepcion, 'percepcion_iva'),
                         total:    suma(d.percepcion, 'monto_sujeto') },
        renta:         { docs: d.renta.length, exentas: 0,
                         gravadas: suma(d.renta, 'base_sin_iva'),
                         debito:   suma(d.renta, 'retencion_10'),
                         total:    suma(d.renta, 'base_sin_iva') },
        retencion:     { docs: d.retencion.length, exentas: 0,
                         gravadas: suma(d.retencion, 'monto_sujeto'),
                         debito:   suma(d.retencion, 'retencion_iva'),
                         total:    suma(d.retencion, 'monto_sujeto') },
        // El IVA que nos retuvieron. `debito` va SIN los anulados: es el que se
        // acredita, y es el que muestra el carril de la pestaña.
        retencionVentas: { docs: (d.retencionVentas || []).length, exentas: 0,
                         gravadas: suma(d.retencionVentas || [], 'monto_sujeto'),
                         debito:   suma((d.retencionVentas || []).filter(r => !r.anulada), 'retencion_iva'),
                         total:    suma(d.retencionVentas || [], 'monto_sujeto') },
        // El IVA va NETO: las notas de crédito bajan el crédito fiscal y las
        // de débito lo suben, así que sumarlas todas juntas daría un ajuste
        // mayor al real. Es el número que contabilidad tiene que mover.
        notas:         { docs: d.notas.length, exentas: 0,
                         gravadas: suma(d.notas.filter(r => r.tipo_dte === '05'), 'monto')
                                 - suma(d.notas.filter(r => r.tipo_dte === '06'), 'monto'),
                         debito:   suma(d.notas.filter(r => r.tipo_dte === '05'), 'iva')
                                 - suma(d.notas.filter(r => r.tipo_dte === '06'), 'iva'),
                         total:    suma(d.notas, 'monto') },
    };
};
