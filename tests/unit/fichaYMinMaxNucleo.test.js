import { describe, expect, it } from 'vitest';
import {
    alertaDeMargen, calcMargin, clasificarCompras, comprasOrdenadas, historialDePreciosSinRepetir,
    marginLabel, specialLossKeys, worstMarginOf, NIVELES_DE_MARGEN,
} from '@nucleo/utils/preciosDeProducto';
import { diasDeCobertura, estadoDeProyeccion, planDeRestaurarMinMax, proyeccionDeExistencia } from '@nucleo/utils/minmaxGuardar';
import { filtrarQuiebres, resumenDeQuiebres } from '@nucleo/utils/quiebres';

describe('márgenes de la ficha', () => {
    it('calcula el margen sobre el precio y marca pérdida y margen bajo', () => {
        expect(calcMargin(10, 8)).toBeCloseTo(20);
        expect(calcMargin(0, 8)).toBeNull();
        expect(marginLabel(-1).label).toBe('Pérdida');
        expect(marginLabel(10).label).toBe('Margen bajo');
        expect(marginLabel(30)).toBeNull();
    });
    it('el peor margen no cuenta Premium ni Precio 7, pero Premium bajo costo avisa aparte', () => {
        const pp = { costo: 10, vineta: 20, descuento_1: 11, premium: 9, precio_7: 5 };
        expect(worstMarginOf(pp, NIVELES_DE_MARGEN)).toBeCloseTo((11 - 10) / 11 * 100);
        expect(specialLossKeys(pp)).toEqual(['premium']);
        const a = alertaDeMargen([pp]);
        expect(a.peor).toBeCloseTo(9.09, 1);
        expect(a.especiales).toEqual(['premium']);
    });
    it('sin costo no hay alerta', () => {
        expect(alertaDeMargen([{ vineta: 10 }]).peor).toBeNull();
    });
});

describe('historiales de la ficha', () => {
    const hoy = new Date('2026-10-06T12:00:00');
    const compra = (fecha) => ({ purchase_receipts: { fecha } });
    it('clasifica nuevo, reentrada y regular', () => {
        expect(clasificarCompras([compra('2026-09-20')], hoy)).toBe('Nuevo');
        expect(clasificarCompras([compra('2025-06-01'), compra('2026-09-20')], hoy)).toBe('Reentrada');
        expect(clasificarCompras([compra('2026-05-01'), compra('2026-09-20')], hoy)).toBe('Regular');
        expect(clasificarCompras([compra('2025-01-01')], hoy)).toBeNull();
    });
    it('ordena las compras de la más nueva a la más vieja y descarta las sin recibo', () => {
        const r = comprasOrdenadas([compra('2026-01-01'), {}, compra('2026-05-01')]);
        expect(r.map((x) => x.purchase_receipts.fecha)).toEqual(['2026-05-01', '2026-01-01']);
    });
    it('colapsa los snapshots repetidos del historial de precios', () => {
        const h = [
            { id_presentacion: 1, valid_from: '2026-01-01', vineta: 10 },
            { id_presentacion: 1, valid_from: '2026-02-01', vineta: 10 },
            { id_presentacion: 1, valid_from: '2026-03-01', vineta: 12 },
        ];
        expect(historialDePreciosSinRepetir(h).map((r) => r.valid_from)).toEqual(['2026-03-01', '2026-01-01']);
    });
});

describe('restaurar el Min·Máx al calculado', () => {
    it('en vivo si la sala publicó y no hay borrador', () => {
        const p = planDeRestaurarMinMax({ row: { calc_min: 3, calc_max: 9, draft_status: 'none' }, productId: 5, sucursalId: 1, hayPublicado: true, ahora: 'T' });
        expect(p.tipo).toBe('vivo');
        expect(p.payload).toMatchObject({ min_units: 3, max_units: 9, manual_min: null });
    });
    it('al borrador si hay uno pendiente', () => {
        const p = planDeRestaurarMinMax({ row: { calc_min: 3, calc_max: 9, draft_status: 'pending' }, productId: 5, sucursalId: 1, hayPublicado: true });
        expect(p.tipo).toBe('borrador');
        expect(p.payload).toMatchObject({ draft_min: 3, draft_max: 9, draft_status: 'pending' });
    });
    it('sin calculado limpia; en Bodega sólo quita el manual', () => {
        expect(planDeRestaurarMinMax({ row: {}, productId: 5, sucursalId: 1 }).tipo).toBe('limpiar');
        expect(planDeRestaurarMinMax({ row: { manual_min: null, manual_max: null }, productId: 5, sucursalId: 6 }).sinCambio).toBe(true);
        expect(planDeRestaurarMinMax({ row: { manual_min: 2 }, productId: 5, sucursalId: 6 }).tipo).toBe('bodega');
    });
    it('proyección y cobertura', () => {
        expect(proyeccionDeExistencia(10, 0.5, 30)).toBe(0);
        expect(proyeccionDeExistencia(100, 1, 30)).toBe(70);
        expect(diasDeCobertura(10, 2)).toBe(5);
        expect(diasDeCobertura(10, 0)).toBeNull();
    });
});

describe('agotados', () => {
    const filas = [
        { descripcion: 'AMOXICILINA', dias_sin: 30, max_units: 5, hay_ahora: false },
        { descripcion: 'IBUPROFENO', dias_sin: 10, max_units: 0, hay_ahora: true },
    ];
    it('resume y filtra como el portal', () => {
        expect(resumenDeQuiebres(filas, 30)).toEqual({ total: 2, sinNada: 1, reingreso: 1 });
        expect(filtrarQuiebres(filas, { diasFoto: 30 })).toHaveLength(1);
        expect(filtrarQuiebres(filas, { diasFoto: 30, soloConMinMax: false, busca: 'ibu' })).toHaveLength(1);
    });
});

import { avisoDeLote, limiteDeEnvioABodega } from '@nucleo/utils/plazoDeDevolucion';
describe('plazo de devolución', () => {
    it('vence en diciembre con 2 meses → límite el 25 de septiembre', () => {
        const d = limiteDeEnvioABodega('2026-12-15T12:00:00', 2);
        expect(d.getMonth()).toBe(8);
        expect(d.getDate()).toBe(25);
    });
    it('ND avisa a 7 meses', () => {
        const a = avisoDeLote({ fecha_vencimiento: '2027-03-01T12:00:00' }, { es_devolutivo: false }, new Date('2026-10-06T12:00:00'));
        expect(a.reportarND).toBe(true);
        expect(a.limite).toBeNull();
    });
});

describe('estadoDeProyeccion', () => {
    it('no da por agotado lo que todavía no se acaba', () => {
        // 2 u. a 0.06/día: a los 30 días quedan 0.2 (se agota el día 33)
        expect(estadoDeProyeccion(2, 0.06, 30)).toEqual({ unidades: 0, agotado: false, casi: true });
        expect(estadoDeProyeccion(2, 0.06, 60)).toEqual({ unidades: 0, agotado: true, casi: false });
        expect(estadoDeProyeccion(100, 1, 30)).toEqual({ unidades: 70, agotado: false, casi: false });
    });
});
