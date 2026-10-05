import { describe, expect, it } from 'vitest';
import { conteosMinMax, gruposPorDestino, problemaDeMinMax, sugerenciaMinMax, totalesDeParados } from '@nucleo/utils/gestionDeStock';

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
