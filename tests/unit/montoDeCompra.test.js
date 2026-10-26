import { describe, it, expect } from 'vitest';
import { lineasDeMonto, montosDeLasCompras } from '../../supabase/functions/_shared/montoDeCompra.ts';

/* Casos reales (purchase_receipts, 2026-10). NIT y NRC de `proveedores_maestro`. */
const IMBERTON = { proveedor: 13, identificaciones: ['06140812610145', '1570', '157-0'] };
const ISRAEL = { proveedor: 30, identificaciones: ['12171406701039', '1466461'] };
const COFARSAL = { proveedor: 9, identificaciones: ['06140312700042', '94153'] };
const SIN_NIT = (proveedor) => ({ proveedor, identificaciones: [null, ''] });

/** Renglón del libro de compras: 23 columnas, número 3, NIT 4, percepción 21. */
function libro(numero, nit, perc) {
    const c = Array(23).fill('');
    c[3] = numero; c[4] = nit; c[5] = 'NOMBRE'; c[21] = perc;
    return c.join(';');
}
/** Renglón del anexo de retención: 9 columnas, NIT 3, número 5, monto 8. */
function anexo(numero, nit, monto) {
    const c = Array(9).fill('');
    c[3] = nit; c[5] = numero; c[8] = monto;
    return c.join(';');
}
const perc = (csv) => lineasDeMonto(csv, 3, 4, 21);

describe('la percepción de una compra exige número Y emisor', () => {
    it('6186 / 6188 (5-oct): mismo número, cada una con la suya', () => {
        const csv = [libro('32CBC8C1-E72B-4EE5-', '0614-081261-014-5', '21.8700'),
                     libro('32CBC8C1-E72B-4EE5- ', '1217-140670-103-9', '0.0000')].join('\n');
        const r = montosDeLasCompras([
            { id: 6186, numero: '32CBC8C1-E72B-4EE5-', ...ISRAEL },
            { id: 6188, numero: '32CBC8C1-E72B-4EE5- ', ...IMBERTON },
        ], perc(csv));
        expect(r.get(6186)).toEqual({ valor: 0, motivo: null });
        expect(r.get(6188)).toEqual({ valor: 21.87, motivo: null });
    });

    it('el libro trae el número sólo del OTRO emisor: no se le pega, queda sin decidir', () => {
        const csv = libro('32CBC8C1-E72B-4EE5-', '06140812610145', '21.87');
        const r = montosDeLasCompras([
            { id: 6186, numero: '32CBC8C1-E72B-4EE5-', ...ISRAEL },
            { id: 6188, numero: '32CBC8C1-E72B-4EE5-', ...IMBERTON },
        ], perc(csv));
        expect(r.get(6186)).toEqual({ valor: null, motivo: 'emisor-no-coincide' });
        expect(r.get(6188)).toEqual({ valor: 21.87, motivo: null });
    });

    it('aunque el número sea único en el archivo, si el emisor no es el de la compra no se asigna', () => {
        const csv = libro('DTE-03-M001P001-0000', '06140812610145', '5.00');
        const r = montosDeLasCompras([{ id: 1, numero: 'DTE-03-M001P001-0000', ...COFARSAL }], perc(csv));
        expect(r.get(1)).toEqual({ valor: null, motivo: 'emisor-no-coincide' });
    });

    it('el emisor puede venir con NRC en vez de NIT', () => {
        const r = montosDeLasCompras([{ id: 1, numero: 'X1', ...COFARSAL }], perc(libro('X1', '9415-3', '1.62')));
        expect(r.get(1)).toEqual({ valor: 1.62, motivo: null });
    });

    it('dos valores distintos para el mismo documento: sin decidir, no se elige', () => {
        const csv = [libro('X1', '06140312700042', '1.62'), libro('X1', '06140312700042', '2.47')].join('\n');
        const r = montosDeLasCompras([{ id: 1, numero: 'X1', ...COFARSAL }], perc(csv));
        expect(r.get(1)).toEqual({ valor: null, motivo: 'varios-valores' });
    });

    it('sin renglón en el archivo: cero, como siempre', () => {
        const r = montosDeLasCompras([{ id: 1, numero: 'X9', ...COFARSAL }], perc(libro('X1', '06140312700042', '1.62')));
        expect(r.get(1)).toEqual({ valor: 0, motivo: null });
    });
});

describe('proveedor sin NIT ni NRC', () => {
    it('número único (un emisor, una compra): el cruce de siempre', () => {
        const r = montosDeLasCompras([{ id: 1, numero: 'X1', ...SIN_NIT(77) }], perc(libro('X1', '06140312700042', '3.29')));
        expect(r.get(1)).toEqual({ valor: 3.29, motivo: null });
    });

    it('número con dos emisores en el archivo: no se asigna a ciegas', () => {
        const csv = [libro('X1', '06140312700042', '3.29'), libro('X1', '06140812610145', '3.29')].join('\n');
        const r = montosDeLasCompras([{ id: 1, numero: 'X1', ...SIN_NIT(77) }], perc(csv));
        expect(r.get(1)).toEqual({ valor: null, motivo: 'numero-compartido' });
    });

    it('número con un solo renglón pero dos compras de proveedores distintos: no se asigna', () => {
        const r = montosDeLasCompras([
            { id: 1, numero: 'DTE-03-M001P001-0000', ...SIN_NIT(77) },
            { id: 2, numero: 'DTE-03-M001P001-0000', ...COFARSAL },
        ], perc(libro('DTE-03-M001P001-0000', '06140312700042', '1.04')));
        expect(r.get(1)).toEqual({ valor: null, motivo: 'numero-compartido' });
        expect(r.get(2)).toEqual({ valor: 1.04, motivo: null });
    });
});

describe('retención: el anexo trae el NIT en la 3 y el número en la 5', () => {
    it('cruza por número y emisor', () => {
        const csv = [anexo('X1', '06140312700042', '1.0000'), anexo('X1', '06140812610145', '9.0000')].join('\n');
        const r = montosDeLasCompras([
            { id: 1, numero: 'X1', ...COFARSAL },
            { id: 2, numero: 'X1', ...IMBERTON },
        ], lineasDeMonto(csv, 5, 3, 8));
        expect(r.get(1)).toEqual({ valor: 1, motivo: null });
        expect(r.get(2)).toEqual({ valor: 9, motivo: null });
    });

    it('el anexo vacío (como en toda la historia): cero para todas', () => {
        const r = montosDeLasCompras([{ id: 1, numero: 'X1', ...COFARSAL }], lineasDeMonto('', 5, 3, 8));
        expect(r.get(1)).toEqual({ valor: 0, motivo: null });
    });
});
