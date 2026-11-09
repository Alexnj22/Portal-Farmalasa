import { describe, it, expect } from 'vitest';
import { expandirRenglones, partirRenglon, reglaQueManda } from '../../supabase/functions/_shared/particionRenglon.ts';

const PACK = { codigo: '130129|7411200606795', descripcion: 'PACK OFF FAMILY 60 OZ + OFF SPRAY 177ML', cantidad: 1, precioUni: 64.86, montoDescu: 0, ventaGravada: 64.86, ventaExenta: 0, ventaNoSuj: 0, ivaItem: 0 };
const BABY = { codigo: '130176|7503051868122', descripcion: '20% FARM OFF BABY', cantidad: 6, precioUni: 2.97, ventaGravada: 17.82 };
const L = PACK.codigo;
const suma = (xs, c) => Math.round(xs.reduce((a, x) => a + Number(x[c] ?? 0), 0) * 100) / 100;

describe('partirRenglon', () => {
    it('un pack de dos productos: lo cargado en #5935, 9 y 9 a $3.6033', () => {
        const r = partirRenglon(PACK, [{ product_id: 1615, unidades: 9, porcentaje: 50 }, { product_id: 1617, unidades: 9, porcentaje: 50 }], L);
        expect(r.map(x => x.cantidad)).toEqual([9, 9]);
        expect(r[0].precioUni).toBeCloseTo(3.6033, 3);
        expect(suma(r, 'ventaGravada')).toBe(64.86);
    });
    it('el redondeo nunca cambia lo cobrado', () => {
        const it = { ...PACK, ventaGravada: 10, montoDescu: 0.01 };
        const p = [{ product_id: 1, unidades: 1, porcentaje: 33.33 }, { product_id: 2, unidades: 1, porcentaje: 33.33 }, { product_id: 3, unidades: 1, porcentaje: 33.34 }];
        const r = partirRenglon(it, p, L);
        expect(suma(r, 'ventaGravada')).toBe(10);
        expect(suma(r, 'montoDescu')).toBe(0.01);
    });
    it('«2 PACK» que se separa: un producto, el doble de unidades, medio costo', () => {
        const [x] = partirRenglon({ ...PACK, precioUni: 8.49, ventaGravada: 8.49 }, [{ product_id: 4621, unidades: 2, porcentaje: 100 }], L);
        expect(x.cantidad).toBe(2);
        expect(x.precioUni).toBeCloseTo(4.245, 4);
        expect(x.ventaGravada).toBe(8.49);
    });
    it('multiplica por lo facturado', () => {
        const r = partirRenglon({ ...PACK, cantidad: 3, ventaGravada: 30, precioUni: 10 }, [{ product_id: 1, unidades: 2, porcentaje: 100 }], L);
        expect(r[0].cantidad).toBe(6);
        expect(r[0].precioUni).toBe(5);
    });
});

describe('expandirRenglones', () => {
    const partes = [{ product_id: 1615, unidades: 9, porcentaje: 50 }, { product_id: 1617, unidades: 9, porcentaje: 50 }];
    it('sin regla no toca nada y la firma es vacía', () => {
        const items = [PACK, BABY];
        const r = expandirRenglones(items, [L, BABY.codigo], [], 7);
        expect(r.items).toEqual(items);
        expect(r.firma).toBe('');
    });
    it('conserva el orden y marca cada parte', () => {
        const r = expandirRenglones([PACK, BABY], [L, BABY.codigo], [{ llave: L, document_id: null, partes }], 7);
        expect(r.items).toHaveLength(3);
        expect(r.items[0]._parte).toMatchObject({ product_id: 1615, indice: 1, total: 2 });
        expect(r.items[2]).toEqual(BABY);
        expect(r.firma).toContain('1615x9@50');
    });
    it('«dejar entero esta vez» le gana a lo recordado, sólo en esa factura', () => {
        const reglas = [{ llave: L, document_id: null, partes }, { llave: L, document_id: 7, partes: [] }];
        expect(expandirRenglones([PACK], [L], reglas, 7).items).toEqual([PACK]);
        expect(expandirRenglones([PACK], [L], reglas, 8).items).toHaveLength(2);
    });
    it('cambiar la regla cambia la firma (la carga vieja se rechaza)', () => {
        const a = expandirRenglones([PACK], [L], [{ llave: L, document_id: null, partes }], 7).firma;
        const b = expandirRenglones([PACK], [L], [{ llave: L, document_id: null, partes: [partes[0], { ...partes[1], unidades: 8 }] }], 7).firma;
        expect(a).not.toBe(b);
    });
    it('reglaQueManda: sin la de la factura, la general', () => {
        expect(reglaQueManda([{ llave: L, document_id: null, partes }], L, 9).partes).toBe(partes);
        expect(reglaQueManda([], L, 9)).toBe(null);
    });
});
