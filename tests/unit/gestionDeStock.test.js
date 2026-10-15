import { describe, expect, it } from 'vitest';
import {
    conteosMinMax, cuantosArmables, gruposPorDestino, notaDeEnvioSugerido, problemaDeMinMax, productosDeEnvioSugerido,
    renglonesDeEnvioSugerido, sugerenciaMinMax, totalesDeParados,
} from '@nucleo/utils/gestionDeStock';

describe('gestionDeStock', () => {
    it('agrupa por destino: salas primero (por cantidad), Bodega al final', () => {
        const filas = [
            { destino: 6, costo: 10, existencia: 1 }, { destino: 1, costo: 2, existencia: 3 },
            { destino: 2, costo: 1, existencia: 1 }, { destino: 2, costo: 4, existencia: 2 },
        ];
        const g = gruposPorDestino(filas, 6);
        expect(g.map((x) => x.destino)).toEqual([2, 1, 6]);
        expect(g[0]).toMatchObject({ costo: 5, unidades: 3 });
        expect(totalesDeParados(filas.slice(0, 2), filas, 6)).toMatchObject({ productos: 2, unidades: 4, costo: 12, aSala: 3, aBodega: 1 });
    });
    it('sugiere según rotación, mayoristas y encargos', () => {
        expect(sugerenciaMinMax({ units_sold: 90, revenue: 7000, months_with_sales: 4, invoice_count: 30 }))
            .toMatchObject({ level: 'agregar', minSug: 15, maxSug: 30, reason: 'Buena rotación' });
        expect(sugerenciaMinMax({ units_sold: 60, revenue: 100, months_with_sales: 1, invoice_count: 2 }).level).toBe('mayorista');
        expect(sugerenciaMinMax({ units_sold: 12, revenue: 20, months_with_sales: 1, invoice_count: 2 }).level).toBe('encargo');
        expect(sugerenciaMinMax({ units_sold: 6, revenue: 20, months_with_sales: 7, invoice_count: 6 }).months).toBe(6);
        expect(sugerenciaMinMax({ units_sold: 1, revenue: 3, months_with_sales: 1, invoice_count: 1 }).level).toBe('omitir');
    });
    it('los descartados se cuentan aparte', () => {
        const filas = [{ erp_product_id: 1, units_sold: 1, revenue: 3, months_with_sales: 1, invoice_count: 1 }, { erp_product_id: 2, units_sold: 1, revenue: 3, months_with_sales: 1, invoice_count: 1 }];
        expect(conteosMinMax(filas, new Set([2]))).toMatchObject({ omitir: 1, ignorado: 1 });
    });
    it('valida el Min/Max pedido', () => {
        expect(problemaDeMinMax('15', '30')).toBeNull();
        expect(problemaDeMinMax('0', '1')).toBeNull();
        expect(problemaDeMinMax('31', '30')).toMatch(/Min/);
        expect(problemaDeMinMax('', '30')).toMatch(/Min/);
        expect(problemaDeMinMax('1', '0')).toMatch(/Min/);
    });
});

describe('gestionDeStock · envío sugerido', () => {
    const despacho = new Map([[1, { tipo: 'CAJA', etiqueta: 'CAJA', factor: 10, multiplo: 1, unidades: 10 }], [2, { tipo: 'CAJA', factor: 10, multiplo: 1, unidades: 10 }]]);
    it('a Bodega sólo lo que completa su presentación de despacho, y en ella', () => {
        const g = { destino: 6, filas: [{ erp_product_id: 1, producto: 'A', existencia: 25 }, { erp_product_id: 2, producto: 'B', existencia: 4 }] };
        expect(cuantosArmables(g, despacho, 6)).toBe(1);
        expect(productosDeEnvioSugerido(g, despacho, 6)).toEqual([
            { erp_product_id: 1, descripcion: 'A', presentacion: { tipo: 'CAJA', factor: 10, cantidad: 2 } },
        ]);
    });
    it('a otra sala todo, sin presentación, con tope', () => {
        const g = { destino: 2, filas: Array.from({ length: 25 }, (_, i) => ({ erp_product_id: i + 1, producto: `P${i}`, existencia: 1 })) };
        expect(cuantosArmables(g, despacho, 6)).toBe(25);
        expect(productosDeEnvioSugerido(g, despacho, 6)).toHaveLength(20);
    });
    it('arma los renglones con todo lo que hay y dice lo que no entra', () => {
        const filas = [
            { erp_product_id: 1, descripcion: 'A', cantidad: 3, factor: 1, lote: 'L1', fecha_vencimiento: '2027-01-01' },
            { erp_product_id: 1, descripcion: 'A', cantidad: 2, factor: 1, lote: 'L0', fecha_vencimiento: '2026-12-01' },
        ];
        const pres = new Map([[1, [{ tipo: 'UNIDAD', factor: 1 }]], [3, [{ tipo: 'UNIDAD', factor: 1 }]]]);
        const { listos, fuera } = renglonesDeEnvioSugerido(
            [{ erp_product_id: 1, descripcion: 'A' }, { erp_product_id: 3, descripcion: 'C' }], filas, pres);
        expect(listos).toHaveLength(1);
        expect(listos[0]).toMatchObject({ cantidad: 5, unidades: 5, presentacion_tipo: 'UNIDAD' });
        expect(listos[0].lotes[0]).toMatchObject({ lote: 'L0', unidades: 2 });
        expect(fuera).toEqual([{ descripcion: 'C', motivo: 'ya no hay existencia' }]);
    });
    it('la nota dice por qué, según el destino', () => {
        expect(notaDeEnvioSugerido(6, 6, 'Salud 1', 'Bodega')).toMatch(/ninguna sala/);
        expect(notaDeEnvioSugerido(2, 6, 'Salud 1', 'Salud 2')).toMatch(/en Salud 2 sí se vende/);
    });
});
