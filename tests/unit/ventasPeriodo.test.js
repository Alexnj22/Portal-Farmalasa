import { describe, expect, it } from 'vitest';
import { filaDeProductoVendido, totalesDeProductos, diasDelRango, horaDeCorte, mesAnteriorDe, mesEnCurso, periodoAnterior, puestosDelMesAnterior, rankingDeVendedores, renglonesDeLaVenta, variacionPorDia, ventasDiariasDelVendedor } from '@nucleo/utils/ventasPeriodo';

describe('ventasPeriodo', () => {
    it('mes en curso hasta hoy', () => {
        expect(mesEnCurso('2026-10-02')).toEqual({ fini: '2026-10-01', ffin: '2026-10-02', label: '2026-10' });
    });
    it('período anterior: corre tantos meses como abarca', () => {
        expect(periodoAnterior('2026-05-05', '2026-05-09')).toEqual({ prevFini: '2026-04-05', prevFfin: '2026-04-09' });
        expect(periodoAnterior('2026-05-01', '2026-07-31')).toEqual({ prevFini: '2026-02-01', prevFfin: '2026-04-30' });
        expect(periodoAnterior('2026-01-01', '2026-12-31')).toEqual({ prevFini: '2025-01-01', prevFfin: '2025-12-31' });
        expect(periodoAnterior('2026-03-31', '2026-03-31')).toEqual({ prevFini: '2026-02-28', prevFfin: '2026-02-28' });
    });
    it('días del rango y variación por día', () => {
        expect(diasDelRango('2026-10-01', '2026-10-01')).toBe(1);
        expect(diasDelRango('2026-02-01', '2026-03-01')).toBe(29);
        expect(variacionPorDia(300, 30, 310, 31)).toBeCloseTo(0, 5);
        expect(variacionPorDia(100, 10, 0, 10)).toBeNull();
    });
    it('hora de corte sólo si el rango termina hoy', () => {
        expect(horaDeCorte('2026-10-02', '2026-10-02', '14:37:51')).toBe('14:37:00');
        expect(horaDeCorte('2026-10-01', '2026-10-02', '14:37:51')).toBeNull();
    });
    it('renglones: sin duplicados, descuento por renglón o por diferencia', () => {
        const a = { erp_product_id: 1, descripcion: 'A', precio_unitario: 2, total_linea: 4, cantidad: 2 };
        expect(renglonesDeLaVenta([a, { ...a }], 4)).toEqual({ productos: [a], descuento: 0 });
        const d = { erp_product_id: -999, descripcion: 'DESC', total_linea: -1.5 };
        expect(renglonesDeLaVenta([a, d], 2.5).descuento).toBe(1.5);
        expect(renglonesDeLaVenta([a], 3).descuento).toBe(1);
        expect(renglonesDeLaVenta([a], 3.995).descuento).toBe(0);
    });
});

describe('vendedores', () => {
    const porCodigo = new Map([['7', { code: '7', name: 'ANA' }]]);
    it('ranking: une salas, aparta los códigos sin ficha', () => {
        const r = rankingDeVendedores([
            { branch_id: 1, cod_vendedor: '7', total_ventas: '10', total_facturas: '2' },
            { branch_id: 2, cod_vendedor: '7', total_ventas: '5', total_facturas: '1' },
            { branch_id: 1, cod_vendedor: '1000', total_ventas: '20', total_facturas: '4' },
            { branch_id: 2, cod_vendedor: '999', total_ventas: '3', total_facturas: '1' },
        ], porCodigo);
        expect(r.conocidos.map(v => [v.cod_vendedor, v.total, v.branchIds])).toEqual([['1000', 20, [1]], ['7', 15, [1, 2]]]);
        expect(r.conocidos[0].especial).toBe('Administración');
        expect(r.sinFicha).toEqual([{ branch_id: 2, total: 3, count: 1 }]);
        expect([r.total, r.facturas]).toEqual([38, 8]);
    });
    it('mes anterior y puestos sin especiales', () => {
        expect(mesAnteriorDe('2026-01-15')).toBe('2025-12-01');
        const p = puestosDelMesAnterior([
            { cod_vendedor: '7', total_sum: 5 }, { cod_vendedor: '8', total_sum: 9 }, { cod_vendedor: '1000', total_sum: 99 }, { cod_vendedor: '7', total_sum: 5 },
        ]);
        expect([...p]).toEqual([['7', 1], ['8', 2]]);
    });
    it('ventas diarias con reparto por sala', () => {
        expect(ventasDiariasDelVendedor([
            { fecha: '2026-10-01', branch_id: 1, total_ventas: '10', total_facturas: '2' },
            { fecha: '2026-10-01', branch_id: 2, total_ventas: '4', total_facturas: '1' },
        ])).toEqual([{ fecha: '2026-10-01', total: 14, count: 3, branches: [{ branch_id: 1, total: 10 }, { branch_id: 2, total: 4 }] }]);
    });
});

describe('productos vendidos', () => {
    it('fila: unidades base por factor, utilidad y margen sobre el neto', () => {
        const f = filaDeProductoVendido({ erp_product_id: 5, descripcion: 'X', cantidad: '3', neto: '100', costo_total: '60',
            presentaciones: [{ presentacion: 'CAJA X30', cantidad: '2', neto: '90', factor: '30' }, { presentacion: 'UNIDAD', cantidad: '1', neto: '10', factor: '1' }] });
        expect([f.cantidad_base, f.utilidad, f.margen, f.costo_unitario]).toEqual([61, 40, 40, 20]);
        expect(filaDeProductoVendido({ cantidad: '2', neto: '0' }).margen).toBeNull();
    });
    it('totales: el costo sólo suma lo que tiene costo', () => {
        const t = totalesDeProductos([{ neto: 100, costo_total: 60, utilidad: 40 }, { neto: 50, costo_total: null, utilidad: null }]);
        expect([t.neto, t.costo, t.utilidad, t.mayor]).toEqual([150, 60, 40, 100]);
        expect(t.margen).toBeCloseTo(26.667, 2);
    });
});
