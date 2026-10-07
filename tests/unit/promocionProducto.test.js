import { describe, expect, it } from 'vitest';
import {
    destinoDelDescuento, generalDePromocionNuevo, renglonDePromocionNuevo, renglonesParaAgregar, renglonesParaCrear,
} from '@nucleo/utils/promocionesUtils';

const salas = [{ id: 1, name: 'Salud 1' }, { id: 2, name: 'Salud 2' }, { id: 3, name: 'Salud 3' }];

describe('promoción por producto', () => {
    it('un producto nace con lo general y confirmado', () => {
        const g = { ...generalDePromocionNuevo(salas), fin: '2026-12-31', lote_total: '100' };
        const r = renglonDePromocionNuevo({ id: 7, nombre: 'X' }, g);
        expect(r).toMatchObject({ erp_product_id: 7, fin: '2026-12-31', lote_total: '100', confirmado: true, ajustado: false });
        expect(r.salas).not.toBe(g.salas);
    });
    it('el cuerpo de crear_promocion: vacío no es cero y sólo las salas marcadas', () => {
        const g = { ...generalDePromocionNuevo(salas), fin: '2026-12-31', supplier_id: '9' };
        const r = { ...renglonDePromocionNuevo({ id: 7, nombre: 'X' }, g), salas: { 1: true, 2: false }, reparto: { 1: '40', 2: '9' } };
        const [c] = renglonesParaCrear([r]);
        expect(c.lote_total).toBeNull();
        expect(c.supplier_id).toBe(9);
        expect(c.bono_vendedor).toBe(1);
        expect(c.reparto).toEqual([{ branch_id: 1, unidades: 40 }]);
        const [sin] = renglonesParaCrear([{ ...r, tiene_bono: false }]);
        expect(sin).toMatchObject({ paga: null, supplier_id: null, bono_vendedor: 0 });
    });
    it('a qué sala va el descuento', () => {
        expect(destinoDelDescuento(salas, {}, {})).toEqual({ todas_las_salas: true, branch_id: 1 });
        expect(destinoDelDescuento(salas, { 2: true }, {})).toEqual({ todas_las_salas: false, branch_id: 2 });
        expect(destinoDelDescuento(salas, { 1: true, 3: true }, { todas: false, branchId: '3' })).toEqual({ todas_las_salas: false, branch_id: 3 });
    });
});

describe('renglonesParaAgregar', () => {
    it('heredan vigencia, salas y bono; el proveedor por nombre', () => {
        const promo = { salas: [1, 2], renglones: [
            { inicio: '2026-10-01', fin: '2026-10-31', tiene_bono: true, paga: 'proveedor', proveedor: 'ACME', bono_vendedor: '2', bono_adm: '0.5', bono_bodega: '0.25', unidades_por_bono: 3 },
            { inicio: '2026-10-05', fin: '2026-11-15' },
        ] };
        const { renglones } = renglonesParaAgregar(promo, [{ id: 9 }], [{ value: '44', label: 'ACME' }]);
        expect(renglones[0]).toMatchObject({ erp_product_id: 9, inicio: '2026-10-01', fin: '2026-11-15', supplier_id: '44', bono_vendedor: 2, unidades_por_bono: 3 });
        expect(renglones[0].reparto).toEqual([{ branch_id: 1, unidades: 0 }, { branch_id: 2, unidades: 0 }]);
    });
    it('sin dar con el proveedor no se arma nada', () => {
        const promo = { renglones: [{ tiene_bono: true, paga: 'proveedor', proveedor: 'X' }] };
        expect(renglonesParaAgregar(promo, [{ id: 1 }], []).error).toMatch(/proveedor/);
    });
});
