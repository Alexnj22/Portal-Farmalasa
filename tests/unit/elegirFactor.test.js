// Cuántas unidades trae cada una del proveedor, con el precio como juez (2026-11-05).
import { describe, it, expect } from 'vitest';
import { elegirFactor, empaqueEnLaDescripcion, envaseUnitarioEnLaDescripcion, tamanoDeCajaEnLaDescripcion, factorDebilEnLaDescripcion, tamanosEnLaDescripcion } from '../../supabase/functions/_shared/compraSobre.ts';

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
    it('RINOKEM PLUS «CAJA X 100 CAPS»: el costo subió 40 % y la caja sigue siendo de 100', () => {
        const desc = 'RINOKEM PLUS CAJA X 100 CAPS LOTE: 260265 VENCE: 28/02/2028';
        expect(empaqueEnLaDescripcion(desc)).toBe(true);
        expect(tamanosEnLaDescripcion(desc)).toEqual([100]);
        expect(elegirFactor({ delDoc: null, aprendido: 140, empaque: true, pistas: [100], costoNeto: 8.904, costoUnidad: 0.0637, presentaciones: [1, 10, 100], vinetaUno: 0.27 }))
            .toEqual({ factor: 100, origen: 'documento' });
    });
    it('sin la palabra del empaque, el mismo caso sigue yendo por el precio', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, pistas: [100], costoNeto: 8.904, costoUnidad: 0.0637, presentaciones: [1, 10, 100], vinetaUno: 0.27 }).factor).toBe(140);
    });
    it('una caja nombrada que el precio contradice de plano no se usa (precio de unidad suelta)', () => {
        expect(elegirFactor({ delDoc: null, aprendido: null, empaque: true, pistas: [30], costoNeto: 2.7, costoUnidad: 2.62, presentaciones: [1, 30] }))
            .toEqual({ factor: 1, origen: null });
    });
    it('MEBEZOL «FCO X 30 ML»: un frasco es una unidad aunque el precio dé 2 y lo aprendido diga 2', () => {
        const desc = 'MEBEZOL SUSPENSION FCO X 30 ML LOTE: 260669 VENCE: 30/06/2028';
        expect(envaseUnitarioEnLaDescripcion(desc)).toBe(true);
        expect(elegirFactor({ delDoc: null, aprendido: 2, unitario: true, pistas: [30], costoNeto: 1.7225, costoUnidad: 0.837, presentaciones: [1], vinetaUno: 3.75 }))
            .toEqual({ factor: 1, origen: 'documento' });
    });
    it('un frasco que dice cuántas piezas trae no es una unidad', () => {
        expect(envaseUnitarioEnLaDescripcion('ACETAMINOFEN 500 MG FCO X 100 TAB')).toBe(false);
        expect(envaseUnitarioEnLaDescripcion('JARABE X 120 ML CAJA X 12 FCO')).toBe(false);
        expect(envaseUnitarioEnLaDescripcion('SUPLEFERR GOTAS FRASCO X 30 ML')).toBe(true);
    });
    it('el tamaño de la caja según la factura', () => {
        expect(tamanoDeCajaEnLaDescripcion('RINOKEM PLUS CAJA X 100 CAPS LOTE: 260265')).toBe(100);
        expect(tamanoDeCajaEnLaDescripcion('XEROGEN SOLUCION ORAL CAJA X 10 SACHETS')).toBe(10);
        expect(tamanoDeCajaEnLaDescripcion('MEBEZOL SUSPENSION FCO X 30 ML')).toBe(null);
        expect(tamanoDeCajaEnLaDescripcion('JARABE CAJA X 120 ML')).toBe(null);
        expect(tamanoDeCajaEnLaDescripcion('JARABE X 120 ML CAJA X 12 FCO')).toBe(12);
        expect(tamanoDeCajaEnLaDescripcion('NOR-CLAMIDA 5 MG X 30 TAB')).toBe(null);
        expect(tamanoDeCajaEnLaDescripcion('Barrita Fresa Sarita|7401090800083|25.000 |Caja')).toBe(25);
    });
});
