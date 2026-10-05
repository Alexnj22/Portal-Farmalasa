/**
 * Cuentas por pagar — los totales de arriba y cómo se nombra el estado de un
 * pago. Vivían en `CuentasPorPagarView`; se mudaron el 2026-10-05 para que la
 * app diga lo mismo.
 *
 * Un pago PENDIENTE no baja el saldo —el cheque todavía no salió— pero se
 * cuenta «en trámite», que es lo que evita pagarlo dos veces.
 */

export function totalesCuentasPorPagar(filas) {
    const t = { saldo: 0, vencido: 0, tramite: 0, proveedores: 0, conVencido: 0, sinPlazo: 0 };
    for (const f of filas ?? []) {
        t.proveedores++;
        t.saldo   += Number(f.saldo || 0);
        t.vencido += Number(f.vencido || 0);
        t.tramite += Number(f.en_tramite || 0);
        if (Number(f.vencido) > 0) t.conVencido++;
        if (f.dias_credito == null) t.sinPlazo++;
    }
    return t;
}

/** El rótulo y la severidad de un pago. */
export const ESTADO_PAGO = {
    pendiente: { rotulo: 'Espera aprobación', severidad: 'warning' },
    aprobado:  { rotulo: 'Aprobado',          severidad: 'success' },
    anulado:   { rotulo: 'Anulado',           severidad: 'neutral' },
};

export const FORMAS_DE_PAGO = [
    { value: 'cheque',        label: 'Cheque'        },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'efectivo',      label: 'Efectivo'      },
    { value: 'otro',          label: 'Otro'          },
];
