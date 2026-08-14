import { describe, it, expect } from 'vitest';
import { cajasDeRenglon, construirCajasEspeciales } from '../../src/utils/cajasEspeciales';

// El ancla es el pedido #114 REAL —La Popular, finalizado el 2026-08-14 a las
// 12:24— que salió con 60 etiquetas E1…E60 para 5 cajas de Electrolit. Sus cuatro
// renglones con existencia, tal como quedaron en `pedido_items`:
//
//   ELECTROLIT COCO 625ML       24 unid.  factor 12  → 2 cajas
//   ELECTROLIT FRESA 625ML      12 unid.  factor 12  → 1
//   ELECTROLIT MARACUYA 625 ML  12 unid.  factor 12  → 1
//   ELECTROLIT UVA 625ML        12 unid.  factor 12  → 1
//   ELECTROLIT FRESA KIWI       0 unid.   factor 12  → 0  (no viaja)
//
// El contador de Electrolit del mismo pedido ya decía 5. O sea que los dos
// números salen del mismo hecho físico y tienen que coincidir siempre: es lo que
// estos tests sostienen.
const P114 = [
    { id: 75626, erp_product_id: 2805, caja_especial: true, cantidad_asignada: 24, dispatch_factor: 12, products: { nombre: 'ELECTROLIT COCO 625ML' } },
    { id: 75657, erp_product_id: 2806, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT FRESA 625ML' } },
    { id: 75640, erp_product_id: 2811, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT MARACUYA 625 ML' } },
    { id: 75670, erp_product_id: 2818, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT UVA 625ML' } },
    { id: 75699, erp_product_id: 2807, caja_especial: true, cantidad_asignada: 0,  dispatch_factor: 12, products: { nombre: 'ELECTROLIT FRESA KIWI 625ML' } },
];

describe('cajasDeRenglon', () => {
    it('una caja de 12 es UNA caja, no doce', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 12, dispatch_factor: 12 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 24, dispatch_factor: 12 })).toBe(2);
    });

    it('lo que se despacha por unidad no cambia — andaderas, bastones, sillas', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 1, dispatch_factor: 1 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 3, dispatch_factor: 1 })).toBe(3);
    });

    it('sin unidades asignadas no hay caja', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 0, dispatch_factor: 12 })).toBe(0);
        expect(cajasDeRenglon({})).toBe(0);
    });

    it('una caja a medio llenar sigue siendo una caja', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 6, dispatch_factor: 12 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 13, dispatch_factor: 12 })).toBe(2);
    });

    it('sin factor cae a 1 en vez de dividir por cero', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 5, dispatch_factor: 0 })).toBe(5);
        expect(cajasDeRenglon({ cantidad_asignada: 5 })).toBe(5);
    });
});

describe('construirCajasEspeciales', () => {
    it('el pedido #114 son 5 cajas, no 60', () => {
        expect(construirCajasEspeciales(P114)).toHaveLength(5);
    });

    it('numera E1…En en orden de producto, y las dos cajas del mismo renglón van juntas', () => {
        expect(construirCajasEspeciales(P114).map(c => `${c.label} ${c.product_name}`)).toEqual([
            'E1 ELECTROLIT COCO 625ML',
            'E2 ELECTROLIT COCO 625ML',
            'E3 ELECTROLIT FRESA 625ML',
            'E4 ELECTROLIT MARACUYA 625 ML',
            'E5 ELECTROLIT UVA 625ML',
        ]);
    });

    it('cada caja sabe de qué renglón salió — es lo que liga la etiqueta con la recepción', () => {
        const cajas = construirCajasEspeciales(P114);
        expect(cajas[0].pedido_item_id).toBe(75626);
        expect(cajas[1].pedido_item_id).toBe(75626);
        expect(cajas[2].pedido_item_id).toBe(75657);
    });

    it('deja fuera lo que no viaja: sin marca de especial, o sin unidades', () => {
        expect(construirCajasEspeciales([
            { id: 1, caja_especial: false, cantidad_asignada: 24, dispatch_factor: 12, products: { nombre: 'ALGO' } },
            { id: 2, caja_especial: true,  cantidad_asignada: 0,  dispatch_factor: 12, products: { nombre: 'OTRO' } },
        ])).toEqual([]);
    });

    it('sin renglones no explota', () => {
        expect(construirCajasEspeciales([])).toEqual([]);
        expect(construirCajasEspeciales(null)).toEqual([]);
    });

    it('el total de cajas especiales coincide con el contador de Electrolit del mismo pedido', () => {
        const porContador = P114.reduce((s, r) => s + cajasDeRenglon(r), 0);
        expect(construirCajasEspeciales(P114)).toHaveLength(porContador);
        expect(porContador).toBe(5);
    });
});
