import { describe, expect, it } from 'vitest';
import { lineasDelResumen, tasaEnTexto } from '@nucleo/utils/resumenFiscal';

describe('resumenFiscal', () => {
    it('la tasa en texto corto', () => {
        expect(tasaEnTexto(0.0175)).toBe('1.75%');
        expect(tasaEnTexto(0.02)).toBe('2%');
        expect(tasaEnTexto(null)).toBe('0%');
    });
    it('los renglones, con el último según el signo del movimiento', () => {
        const l = lineasDelResumen({ ventas: { debito_fiscal: 100, documentos: 3 }, compras: {}, movimiento_iva: -5 });
        expect(l).toHaveLength(8);
        expect(l[0]).toMatchObject({ monto: 100, signo: '+', detalle: '3 documentos con sello' });
        expect(l[7]).toMatchObject({ etiqueta: 'Movimiento del mes — a favor', fuerte: true });
        expect(lineasDelResumen({ movimiento_iva: 1 })[7].etiqueta).toBe('Movimiento del mes — a pagar');
    });
});
