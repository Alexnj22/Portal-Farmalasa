import { describe, it, expect } from 'vitest';
import { juzgarPresentacion, costoUnidadAntes, tamanosDelNombre } from '@nucleo/utils/presentacionDeCompra';

// Casos reales de la carga de compras (2026-11-07). Los costos de antes son
// los del catálogo; los nuevos, el neto de la factura ÷ lo que entra.
const VALPAKINE = [{ factor: 1, nombre: 'BLISTER', costo: 3.9183 }, { factor: 4, nombre: 'CAJA', costo: 15.6733 }];
const TRAMACET = [{ factor: 1, nombre: 'UNIDAD', costo: 0.9096 }, { factor: 10, nombre: 'BLISTER', costo: 9.0963 }, { factor: 20, nombre: 'CAJA', costo: 18.1925 }];
const COMBINATER = [{ factor: 1, nombre: 'CAJA', costo: 18.87 }];
const CONDONES = [{ factor: 1, nombre: 'UNIDAD', costo: 0.5 }, { factor: 16, nombre: 'CAJA', costo: 8 }];

describe('tamanosDelNombre', () => {
    it('lee el tamaño y no las medidas', () => {
        expect(tamanosDelNombre('VALPAKINE 500MG X 40 TABLETAS')).toEqual([40]);
        expect(tamanosDelNombre('JARABE X 120 ML')).toEqual([]);
        expect(tamanosDelNombre('COMBINATER 2.5MG X TABLETAS')).toEqual([]);
    });
});

describe('costoUnidadAntes', () => {
    it('usa la de 1, o la más chica ÷ su tamaño', () => {
        expect(costoUnidadAntes(VALPAKINE)).toBeCloseTo(3.9183, 4);
        expect(costoUnidadAntes([{ factor: 30, costo: 27 }])).toBeCloseTo(0.9, 4);
        expect(costoUnidadAntes([{ factor: 1, costo: 0 }])).toBeNull();
    });
});

describe('juzgarPresentacion', () => {
    it('VALPAKINE: factura «x 40», Bodega en blísteres, mismo costo → sin aviso', () => {
        const r = juzgarPresentacion({ tam: 40, presentaciones: VALPAKINE, nombre: 'VALPAKINE 500MG X 40 TABLETAS',
            factor: 4, costoNuevoUnidad: 15.675 / 4, costoAntesUnidad: costoUnidadAntes(VALPAKINE) });
        expect(r).toMatchObject({ aviso: null, motivo: 'costo-igual' });
    });

    it('VALPAKINE sin costo anterior: lo salva el nombre', () => {
        const r = juzgarPresentacion({ tam: 40, presentaciones: VALPAKINE, nombre: 'VALPAKINE 500MG X 40 TABLETAS', factor: 4 });
        expect(r).toMatchObject({ aviso: null, motivo: 'nombre-lo-dice' });
    });

    it('COMBINATER: CAJA (1) y nombre sin tamaño → sin aviso aun sin costo', () => {
        const r = juzgarPresentacion({ tam: 30, presentaciones: COMBINATER, nombre: 'COMBINATER 2.5MG X TABLETAS', factor: 1 });
        expect(r).toMatchObject({ aviso: null, motivo: 'caja-es-la-unidad' });
    });

    it('CONDONES: «16X3 DISP X48» cargado como 16, mismo costo → sin aviso', () => {
        const r = juzgarPresentacion({ tam: 48, presentaciones: CONDONES, nombre: 'CONDONES VIVE AMOR X 16 SOB.',
            factor: 16, costoNuevoUnidad: 0.51, costoAntesUnidad: 0.5 });
        expect(r.aviso).toBeNull();
    });

    it('TRAMACET: la caja pasa de 20 a 30 y se carga como CAJA (20) → confirmado, +50 %', () => {
        // Caja de 30 a $27.29: cargada como 20 unidades, cada una cuesta 1.364.
        const r = juzgarPresentacion({ tam: 30, presentaciones: TRAMACET, nombre: 'TRAMACET X 20 TABLETAS',
            factor: 20, costoNuevoUnidad: 27.29 / 20, costoAntesUnidad: costoUnidadAntes(TRAMACET) });
        expect(r.aviso).toBe('confirmado');
        expect(r.tamanoBodega).toBe(20);
        expect(r.sube).toBeCloseTo(50, 0);
    });

    it('TRAMACET: la caja de 30 cargada como 30 sueltas → sigue avisando (falta crearla)', () => {
        const r = juzgarPresentacion({ tam: 30, presentaciones: TRAMACET, nombre: 'TRAMACET X 20 TABLETAS',
            factor: 30, costoNuevoUnidad: 27.29 / 30, costoAntesUnidad: costoUnidadAntes(TRAMACET) });
        expect(r.aviso).toBe('cambio');
    });

    it('subió el precio sin cambiar la caja (+20 %) → decide el nombre, no inventa cambio', () => {
        const r = juzgarPresentacion({ tam: 20, presentaciones: [{ factor: 1, nombre: 'UNIDAD', costo: 1 }, { factor: 10, nombre: 'BLISTER', costo: 10 }],
            nombre: 'X X 20 TABLETAS', factor: 10, costoNuevoUnidad: 1.2, costoAntesUnidad: 1 });
        expect(r).toMatchObject({ aviso: null, motivo: 'nombre-lo-dice' });
    });

    it('CAJA (1) con «X 30» en el nombre y factura de 60, costo al doble → confirmado', () => {
        const r = juzgarPresentacion({ tam: 60, presentaciones: [{ factor: 1, nombre: 'CAJA', costo: 10 }],
            nombre: 'PRODUCTO 5MG X 30 TABLETAS', factor: 1, costoNuevoUnidad: 20, costoAntesUnidad: 10 });
        expect(r.aviso).toBe('confirmado');
    });

    it('CAJA (1) con «X 30» y factura de 60, sin costo → avisa (el nombre dice otro tamaño)', () => {
        const r = juzgarPresentacion({ tam: 60, presentaciones: [{ factor: 1, nombre: 'CAJA' }],
            nombre: 'PRODUCTO 5MG X 30 TABLETAS', factor: 1 });
        expect(r.aviso).toBe('cambio');
    });

    it('Bodega ya tiene la presentación del tamaño → nada que decir', () => {
        expect(juzgarPresentacion({ tam: 20, presentaciones: TRAMACET, nombre: 'TRAMACET X 20 TABLETAS', factor: 20 }).aviso).toBeNull();
    });

    it('sin tamaño en la factura → nada que decir', () => {
        expect(juzgarPresentacion({ tam: null, presentaciones: TRAMACET, nombre: 'TRAMACET X 20 TABLETAS', factor: 20 }).aviso).toBeNull();
    });
});

describe('tamanosDelNombre — decimales y porcentajes', () => {
    it('«X 2.0MG», «X 0,5 MG» y «X 5%» no son tamaños', () => {
        expect(tamanosDelNombre('ACREA X 2.0MG X 21 COMP')).toEqual([21]);
        expect(tamanosDelNombre('GOTAS X 0,5 MG X 20')).toEqual([20]);
        expect(tamanosDelNombre('CREMA X 5% X 30G')).toEqual([]);
    });
});
