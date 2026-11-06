import { describe, expect, it } from 'vitest';
import { cantidadValida, conteoEditable, guardadoDelRenglon, noUbicado, factorDelRenglon, pluralDePresentacion, unidadDeConteo, esLoteGenerico, reglaDeLoteYVence, rotuloDeAjuste, avanceSinLote } from '@nucleo/utils/conteoDeInventario';

describe('conteoDeInventario', () => {
    it('se cuenta en borrador o en progreso', () => {
        expect(conteoEditable({ status: 'EN_PROGRESO' })).toBe(true);
        expect(conteoEditable({ status: 'FINALIZADO' })).toBe(false);
        expect(conteoEditable(null)).toBe(false);
    });
    it('cantidad: entero de 0 o más, o vacía', () => {
        expect(cantidadValida('')).toBe(true);
        expect(cantidadValida('0')).toBe(true);
        expect(cantidadValida('3.5')).toBe(false);
        expect(cantidadValida(-1)).toBe(false);
    });
    it('vacío deja pendiente; un número, contado; no ubicado aparte', () => {
        expect(guardadoDelRenglon('', ' ')).toEqual({ fisicoCantidad: null, nota: null, estadoItem: 'PENDIENTE' });
        expect(guardadoDelRenglon('9', 'repisa 2')).toEqual({ fisicoCantidad: 9, nota: 'repisa 2', estadoItem: 'CONTADO' });
        expect(noUbicado()).toEqual({ fisicoCantidad: 0, nota: null, estadoItem: 'SIN_UBICAR' });
    });
});

describe('resumen de la lista de conteos', () => {
    it('cuenta abiertos, por aprobar y sin ajustar', async () => {
        const { resumenDeConteos, valorNetoDelConteo } = await import('@nucleo/utils/conteoDeInventario');
        const r = resumenDeConteos([
            { status: 'EN_PROGRESO' }, { status: 'BORRADOR' }, { status: 'FINALIZADO' },
            { status: 'CERRADO', total_diferencias: 3, ajuste_erp_aplicado: false },
            { status: 'CERRADO', total_diferencias: 3, ajuste_erp_aplicado: true },
        ]);
        expect(r).toEqual({ total: 5, abiertos: 2, porAprobar: 1, sinAjuste: 1 });
        expect(valorNetoDelConteo({ valor_sobrante: 10, valor_faltante: 25.5 })).toBe(-15.5);
    });
});

// ── En qué se cuenta y qué pide cada producto (2026-11-06) ──────────────────

describe('unidad de conteo', () => {
    it('el factor sale de `factor` o del «1xN» del detalle', () => {
        expect(factorDelRenglon({ factor: 100 })).toBe(100);
        expect(factorDelRenglon({ detalle: '1x30' })).toBe(30);
        expect(factorDelRenglon({ detalle: 'raro' })).toBeNull();
    });
    it('plurales del estante', () => {
        expect(pluralDePresentacion('CAJA')).toBe('cajas');
        expect(pluralDePresentacion('BLISTER X 10')).toBe('blísteres');
        expect(pluralDePresentacion('UNIDAD')).toBe('unidades');
        expect(pluralDePresentacion('FRASCO')).toBe('frascos');
        expect(pluralDePresentacion('')).toBe('unidades');
    });
    it('dice cuántas trae cuando trae más de una', () => {
        expect(unidadDeConteo({ presentacion: 'CAJA', detalle: '1x100' }).texto).toBe('Cajas de 100');
        expect(unidadDeConteo({ presentacion: 'CAJA', detalle: '1x1' }).texto).toBe('Cajas');
        expect(unidadDeConteo({ presentacion: 'UNIDAD', factor: 1 }).nombre).toBe('unidades');
    });
});

describe('lote y vencimiento según el producto', () => {
    it('GENERICO y vacío son «sin lote»', () => {
        expect(esLoteGenerico('GENERICO')).toBe(true);
        expect(esLoteGenerico('genérico')).toBe(true);
        expect(esLoteGenerico('')).toBe(true);
        expect(esLoteGenerico('L123')).toBe(false);
    });
    it('regulado pide los dos; perecedero sólo vence; el resto nada', () => {
        expect(reglaDeLoteYVence({ regulado: true })).toEqual({ pideLote: true, pideVence: true });
        expect(reglaDeLoteYVence({ perecedero: true })).toEqual({ pideLote: false, pideVence: true });
        expect(reglaDeLoteYVence({})).toEqual({ pideLote: false, pideVence: false });
    });
    it('rótulo de una línea del ajuste', () => {
        expect(rotuloDeAjuste({ lote: 'L1', vence: '2028-02-01', unidades: 10 })).toBe('+10 unidades · lote L1 (vence 02/2028)');
        expect(rotuloDeAjuste({ lote: 'GENERICO', vence: null, unidades: -1 })).toBe('−1 unidad · sin lote asignado');
    });
});

describe('avance de regulados sin lote', () => {
    const suc = [
        { branch_id: 4, sucursal: 'Salud 1', regulados: 1000, sin_lote: 600 },
        { branch_id: 25, sucursal: 'Salud 2', regulados: 500, sin_lote: 100 },
    ];
    it('suma todas, o sólo la elegida', () => {
        expect(avanceSinLote(suc)).toEqual({ regulados: 1500, sinLote: 700, limpios: 53, sucursal: null });
        expect(avanceSinLote(suc, '25')).toEqual({ regulados: 500, sinLote: 100, limpios: 80, sucursal: 'Salud 2' });
    });
    it('sin datos no inventa avance', () => {
        expect(avanceSinLote([]).limpios).toBe(100);
        expect(avanceSinLote(null).regulados).toBe(0);
    });
});
