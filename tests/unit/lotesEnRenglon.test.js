import { describe, it, expect } from 'vitest';
import { partirPorLotes, expandirLotes, lotesDeLaDescripcion } from '../../supabase/functions/_shared/lotesEnRenglon.ts';
import { loteYVence } from '../../supabase/functions/_shared/loteVencimiento.ts';

// Los dos casos reales de Santa Lucía (documentos 7517 del 12-nov y el de MITRADEX del 23-jun).
const CONCOR = {
    codigo: '20000312',
    descripcion: 'CONCOR 5 MG x 30 TAB 7702418000872* LOTE VENCIMIENTO CANTIDAD UM*M55492 30/06/2028 1 CJ*M60396 31/05/2028 6 CJ*|+||CJ|10.00',
    cantidad: 7, precioUni: 24.6, montoDescu: 17.21, ventaGravada: 154.99, ventaExenta: 0, ventaNoSuj: 0, ivaItem: 0,
};
const MITRADEX = {
    codigo: '20000612',
    descripcion: 'MITRADEX 30 MG CJA x 30 TAB 7410000114394* LOTE VENCIMIENTO CANTIDAD UM*0216325 28/02/2028 3 CJ*0403126 30/04/2028 1 CJ*|+||CJ|26.00',
    cantidad: 4, precioUni: 30, montoDescu: 31.2, ventaGravada: 88.8, ventaExenta: 0, ventaNoSuj: 0, ivaItem: 0,
};
const NORMAL = { codigo: '20000310', descripcion: 'CONCOR 10 MG x 30 TAB 7702418000988|M60746|31/03/2028|CJ|10.00', cantidad: 1, ventaGravada: 24.18 };
const suma = (xs, c) => Math.round(xs.reduce((a, x) => a + Number(x[c] ?? 0), 0) * 100) / 100;

describe('partirPorLotes', () => {
    it('CONCOR 5: 1 caja M55492 (06/2028) y 6 cajas M60396 (05/2028)', () => {
        const r = partirPorLotes(CONCOR);
        expect(r.map(x => x.cantidad)).toEqual([1, 6]);
        expect(r.map(x => x.descripcion)).toEqual([
            'CONCOR 5 MG x 30 TAB 7702418000872|M55492|30/06/2028|CJ|10.00',
            'CONCOR 5 MG x 30 TAB 7702418000872|M60396|31/05/2028|CJ|10.00',
        ]);
        expect(suma(r, 'ventaGravada')).toBe(154.99);
        expect(suma(r, 'montoDescu')).toBe(17.21);
        expect(r.every(x => x.precioUni === 24.6 && x.codigo === '20000312')).toBe(true);
    });
    it('el lector de siempre saca lote y mes de cada parte', () => {
        const [a, b] = partirPorLotes(CONCOR).map(x => loteYVence('', x, 2026));
        expect([a.lote, a.vence]).toEqual(['M55492', '2028-06-01']);
        expect([b.lote, b.vence]).toEqual(['M60396', '2028-05-01']);
        const [c, d] = partirPorLotes(MITRADEX).map(x => loteYVence('', x, 2026));
        expect([c.lote, c.vence]).toEqual(['0216325', '2028-02-01']);
        expect([d.lote, d.vence]).toEqual(['0403126', '2028-04-01']);
    });
    it('si la tabla no suma lo facturado, no se parte', () => {
        expect(partirPorLotes({ ...CONCOR, cantidad: 8 })).toBeNull();
    });
    it('una fila que no se entiende: no se adivina', () => {
        expect(lotesDeLaDescripcion(CONCOR.descripcion.replace('M60396 31/05/2028 6 CJ', 'M60396 seis CJ'))).toBeNull();
    });
    it('un renglón normal no se toca', () => {
        expect(partirPorLotes(NORMAL)).toBeNull();
    });
});

describe('expandirLotes', () => {
    it('corre las posiciones y lo dice en la firma', () => {
        const { items, firma } = expandirLotes([NORMAL, CONCOR, NORMAL]);
        expect(items).toHaveLength(4);
        expect(items[3]).toBe(NORMAL);
        expect(firma).toBe('L1:M55492x1,M60396x6');
    });
    it('sin nada que partir, firma vacía (no invalida pantallas abiertas)', () => {
        expect(expandirLotes([NORMAL]).firma).toBe('');
    });
});
