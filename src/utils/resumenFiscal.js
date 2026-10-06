/**
 * Resumen fiscal — cómo se explica el movimiento de IVA del mes, renglón por
 * renglón. Los montos los calcula el servidor (`get_resumen_fiscal`); esto sólo
 * dice en qué orden se muestran y con qué signo. Vivía en `ResumenFiscalView`;
 * se mudó el 2026-10-05 para que la app lo explique igual.
 *
 * `signo` es lo que se MUESTRA, no una operación: el servidor ya mandó el
 * movimiento calculado.
 */

/** Una tasa (0.0175) como porcentaje corto («1.75%»). */
export const tasaEnTexto = (t) => `${(Number(t || 0) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export function lineasDelResumen(datos) {
    const v = datos?.ventas ?? {};
    const c = datos?.compras ?? {};
    const movimiento = Number(datos?.movimiento_iva ?? 0);
    return [
        { etiqueta: 'Débito fiscal — ventas del mes', detalle: `${v.documentos ?? 0} documentos con sello`, monto: v.debito_fiscal, signo: '+' },
        { etiqueta: 'Crédito fiscal — compras registradas', detalle: `${c.documentos_registrados ?? 0} compras`, monto: c.credito_registrado, signo: '−' },
        { etiqueta: 'Crédito fiscal — documentos sin registrar', detalle: `${c.documentos_sin_registrar ?? 0} llegaron del proveedor y no están como compra`, monto: c.credito_sin_registrar, signo: '−' },
        { etiqueta: 'Notas de débito', detalle: `${c.notas_debito_docs ?? 0} documentos`, monto: c.notas_debito_iva, signo: '−' },
        { etiqueta: 'Notas de crédito', detalle: `${c.notas_credito_docs ?? 0} documentos — reducen el crédito`, monto: c.notas_credito_iva, signo: '+' },
        { etiqueta: 'Percepción pagada a proveedores', detalle: 'Anticipo que se acredita', monto: c.percepcion_pagada, signo: '−' },
        { etiqueta: 'Retención que le hicieron a la empresa', detalle: 'Anticipo que se acredita', monto: v.retencion_recibida, signo: '−' },
        { etiqueta: movimiento < 0 ? 'Movimiento del mes — a favor' : 'Movimiento del mes — a pagar', monto: movimiento, signo: '', fuerte: true },
    ];
}
