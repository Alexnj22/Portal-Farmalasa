import { describe, it, expect } from 'vitest';
import { emisoresDelLibro, nitsParaLasFichas } from '../../supabase/functions/_shared/nitDeProveedor.ts';

/* NIT y NRC reales de `proveedores_maestro`. */
const IMBERTON_NIT = '06140812610145';
const COFARSAL_NIT = '06140312700042';
const IMBERTON = { proveedor: 13, identificaciones: [IMBERTON_NIT, '1570'] };
const SIN_NIT = (proveedor) => ({ proveedor, identificaciones: [null, ''] });
const SOLO_NRC = (proveedor, nrc) => ({ proveedor, identificaciones: [null, nrc] });

/** Renglón del libro de compras: número 3, NIT 4, nombre 5. */
function libro(numero, nit, nombre) {
    const c = Array(23).fill('');
    c[3] = numero; c[4] = nit; c[5] = nombre;
    return c.join(';');
}
const L = (...renglones) => emisoresDelLibro(renglones.join('\n'));

describe('el NIT que se le ofrece a una ficha exige número Y emisor', () => {
    it('proveedor sin NIT y número único: se ofrece el NIT y el nombre del renglón', () => {
        const r = nitsParaLasFichas([{ id: 1, numero: 'X1', ...SIN_NIT(77) }],
            L(libro('X1', '0614-031270-004-2', 'COFARSAL DE R.L.')));
        expect(r).toEqual([{ supplier_id: 77, nit: COFARSAL_NIT, nombre: 'COFARSAL DE R.L.' }]);
    });

    it('número compartido por dos proveedores del lote (DTE-03-M001P001-0000): el sin NIT no recibe el NIT del otro', () => {
        const r = nitsParaLasFichas([
            { id: 1, numero: 'DTE-03-M001P001-0000', ...SIN_NIT(77) },
            { id: 2, numero: 'DTE-03-M001P001-0000', ...IMBERTON },
        ], L(libro('DTE-03-M001P001-0000', IMBERTON_NIT, 'C.IMBERTON')));
        // Ni al dueño, que ya tiene su NIT: no hay nada que completarle.
        expect(r).toEqual([]);
    });

    it('número único en el archivo pero de otro emisor que el de una ficha con NIT: no se ofrece', () => {
        const r = nitsParaLasFichas([{ id: 1, numero: 'X1', ...IMBERTON }],
            L(libro('X1', COFARSAL_NIT, 'COFARSAL')));
        expect(r).toEqual([]);
    });

    it('número con dos emisores en el archivo: al proveedor sin NIT no se le ofrece ninguno', () => {
        const r = nitsParaLasFichas([{ id: 1, numero: 'X1', ...SIN_NIT(77) }],
            L(libro('X1', COFARSAL_NIT, 'COFARSAL'), libro('X1', IMBERTON_NIT, 'IMBERTON')));
        expect(r).toEqual([]);
    });

    it('ficha con NRC y renglón de otro emisor: no se ofrece', () => {
        const r = nitsParaLasFichas([{ id: 1, numero: 'X1', ...SOLO_NRC(9, '94153') }],
            L(libro('X1', IMBERTON_NIT, 'IMBERTON')));
        expect(r).toEqual([]);
    });

    it('ficha con NRC cuyo renglón viene con ese mismo NRC: nada que completar', () => {
        const r = nitsParaLasFichas([{ id: 1, numero: 'X1', ...SOLO_NRC(9, '94153') }],
            L(libro('X1', '9415-3', 'COFARSAL')));
        expect(r).toEqual([]);
    });

    it('dos NIT distintos para el mismo proveedor en el lote: ninguno', () => {
        const r = nitsParaLasFichas([
            { id: 1, numero: 'X1', ...SIN_NIT(77) },
            { id: 2, numero: 'X2', ...SIN_NIT(77) },
        ], L(libro('X1', COFARSAL_NIT, 'A'), libro('X2', IMBERTON_NIT, 'B')));
        expect(r).toEqual([]);
    });

    it('el mismo NIT con dos nombres: el NIT va, el nombre no', () => {
        const r = nitsParaLasFichas([
            { id: 1, numero: 'X1', ...SIN_NIT(77) },
            { id: 2, numero: 'X2', ...SIN_NIT(77) },
        ], L(libro('X1', COFARSAL_NIT, 'COFARSAL'), libro('X2', COFARSAL_NIT, 'COFARSAL DE R.L.')));
        expect(r).toEqual([{ supplier_id: 77, nit: COFARSAL_NIT, nombre: null }]);
    });

    it('compra sin proveedor o sin renglón: nada', () => {
        const r = nitsParaLasFichas([
            { id: 1, numero: 'X1', proveedor: null, identificaciones: [] },
            { id: 2, numero: 'X9', ...SIN_NIT(77) },
        ], L(libro('X1', COFARSAL_NIT, 'COFARSAL')));
        expect(r).toEqual([]);
    });
});
