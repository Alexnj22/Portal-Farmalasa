// Cuántas unidades trae cada una del proveedor, con el precio como juez (2026-11-05).
import { describe, it, expect } from 'vitest';
import { elegirFactor, factorDebilEnLaDescripcion, tamanosEnLaDescripcion } from '../../supabase/functions/_shared/compraSobre.ts';

describe('elegirFactor', () => {
    it('MELOFLEX: lo aprendido (1, de agosto) pierde contra el precio: caja de 10', () => {
        expect(elegirFactor({ delDoc: null, aprendido: 1, costoNeto: 4.8995, costoUnidad: 0.49, presentaciones: [1, 10] }))
            .toEqual({ factor: 10, origen: 'costo', corrige: 1 });
    });
    it('ANARA: aprendió 237 y el precio neto dice 200, que es una presentación', () => {
        expect(elegirFactor({ delDoc: null, aprendido: 237, costoNeto: 27.71 * 0.79, costoUnidad: 0.1095, presentaciones: [1, 4, 200] }))
            .toEqual({ factor: 200, origen: 'costo', corrige: 237 });
    });
    it('lo aprendido que cuadra con el precio se respeta', () => {
        expect(elegirFactor({ delDoc: null, aprendido: 1, costoNeto: 5.59, costoUnidad: 5.59, presentaciones: [1] }))
            .toEqual({ factor: 1, origen: 'aprendido' });
    });
    it('sin costo en el catálogo, lo aprendido manda', () => {
        expect(elegirFactor({ delDoc: null, aprendido: 25, costoNeto: 5.81, costoUnidad: null, presentaciones: [] }))
            .toEqual({ factor: 25, origen: 'aprendido' });
    });
    it('el documento gana a todo', () => {
        expect(elegirFactor({ delDoc: 30, aprendido: 15, costoNeto: 5, costoUnidad: 0.49, presentaciones: [10] }).factor).toBe(30);
    });
    it('un precio que sólo subió no inventa una caja', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, costoNeto: 0.62, costoUnidad: 0.49, presentaciones: [1, 10] }))
            .toEqual({ factor: 1, origen: null });
    });
    it('GRIPE-MED: «DISP. X 50 TAB.» vale porque el catálogo vende la caja de 50', () => {
        const desc = 'GRIPE-MED FORTE MULTISINT DISP. X 50 TAB. LSVF11442 V. 01-03-2028 1';
        expect(factorDebilEnLaDescripcion(desc)).toBe(50);
        expect(elegirFactor({ delDoc: null, debil: 50, aprendido: null, costoNeto: 10.91, costoUnidad: 0.1902, presentaciones: [1, 50] }))
            .toEqual({ factor: 50, origen: 'documento' });
    });
    it('lo que el papel dice a medias no vale si el catálogo no tiene ese tamaño', () => {
        expect(elegirFactor({ delDoc: null, debil: 50, aprendido: null, costoNeto: 0.2, costoUnidad: 0.19, presentaciones: [1] }))
            .toEqual({ factor: 1, origen: null });
    });
    it('NOR-CLAMIDA X 30: el precio da 33 (+10 %), la descripción y el catálogo dicen 30', () => {
        const desc = 'NOR-CLAMIDA 5 MG X 30 TAB L5R3227B V. 01-10-2027 1';
        expect(tamanosEnLaDescripcion(desc)).toEqual([30]);
        expect(elegirFactor({ delDoc: null, aprendido: null, pistas: [30], costoNeto: 2.88, costoUnidad: 2.62 / 30, presentaciones: [30] }))
            .toEqual({ factor: 30, origen: 'costo' });
    });
    it('una pista que el precio contradice no se usa: el producto de 30 vendido suelto', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, pistas: [30], costoNeto: 2.7, costoUnidad: 2.62, presentaciones: [1, 30] }))
            .toEqual({ factor: 1, origen: null });
    });
    it('ATROLIP X 28: el precio da 26 y la factura dice 28, aunque el catálogo no venda 28', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, pistas: [28], costoNeto: 22.18, costoUnidad: 12.04 / 14, presentaciones: [14] }))
            .toEqual({ factor: 28, origen: 'costo' });
    });
    it('NOR-CLAMIDA con su «CAJA» de 1 a costo de tableta: no se inventan 30 cajas', () => {
        expect(elegirFactor({ delDoc: null, aprendido: 1, pistas: [30], costoNeto: 2.87, costoUnidad: 0.0873, presentaciones: [1], vinetaUno: 4.78 }))
            .toEqual({ factor: 1, origen: 'aprendido' });
    });
    it('el freno no toca una caja que el catálogo sí vende', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, pistas: [30], costoNeto: 2.88, costoUnidad: 2.62 / 30, presentaciones: [30], vinetaUno: 9 }))
            .toEqual({ factor: 30, origen: 'costo' });
    });
});
