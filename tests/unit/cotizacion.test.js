import { describe, expect, it } from 'vitest';
import { desgloseConIva, totalesDeCotizacion } from '@nucleo/utils/cotizacion';

describe('cotizacion', () => {
    it('el precio trae el IVA adentro', () => {
        const d = desgloseConIva(11.3, 2);
        expect(d.unitSinIva).toBeCloseTo(10, 6);
        expect(d.subtotalIva).toBeCloseTo(2.6, 6);
        expect(d.total).toBeCloseTo(22.6, 6);
    });
    it('la retención es el 1% de la base y sólo si aplica', () => {
        const items = [{ subtotal: 125 }, { subtotal: '102' }];
        const con = totalesDeCotizacion(items, true);
        expect(con.gross).toBe(227);
        expect(con.base).toBeCloseTo(200.885, 3);
        expect(con.retention).toBeCloseTo(2.009, 3);
        expect(con.total).toBeCloseTo(224.991, 3);
        expect(totalesDeCotizacion(items, false).retention).toBe(0);
        expect(totalesDeCotizacion(null, true).total).toBe(0);
    });
});
