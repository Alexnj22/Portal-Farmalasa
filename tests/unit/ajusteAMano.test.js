import { describe, it, expect } from 'vitest';
import { estadoAjuste } from '../../src/views/productos/tabminmax/useMinMaxData';

// Los tres estados de un MIN·MAX que puso una persona
// (docs/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md §4.3).
//
// Existe porque la diferencia entre los estados es la que decide qué mira
// alguien primero, y ninguno de los tres se puede comprobar mirando la pantalla
// hasta que haya ajustes reales cargados. Los casos salen de los productos
// medidos en el plan.

const base = {
    effective_min: 10,
    effective_max: 30,
    draft_status: 'none',
    draft_min: null,
    draft_max: null,
    calc_min: null,
    calc_max: null,
    last_sale_date: null,
    _manual_at: null,
    _manual_motivo: null,
};

describe('estadoAjuste', () => {
    it('no dice nada de una fila que nadie tocó', () => {
        expect(estadoAjuste(base)).toBe(null);
        expect(estadoAjuste({ ...base, calc_min: 99, calc_max: 200 })).toBe(null);
    });

    it('no revienta con una fila vacía', () => {
        expect(estadoAjuste(null)).toBe(null);
        expect(estadoAjuste(undefined)).toBe(null);
        expect(estadoAjuste({})).toBe(null);
    });

    it('respeta el ajuste cuando el cálculo no lo contradice', () => {
        const r = { ...base, _manual_at: '2026-07-01T10:00:00Z', calc_min: 10, calc_max: 30 };
        expect(estadoAjuste(r)).toBe('respetado');
    });

    it('marca conflicto cuando el último cálculo propone otro número', () => {
        // El caso OMEPRAZOL: alguien puso 30 y el cálculo quiere 289.
        const r = { ...base, _manual_at: '2026-07-01T10:00:00Z', effective_max: 30, calc_min: 10, calc_max: 289 };
        expect(estadoAjuste(r)).toBe('en_conflicto');
    });

    it('marca conflicto cuando hay un borrador sin publicar que difiere', () => {
        const r = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            draft_status: 'pending', draft_min: 10, draft_max: 260,
        };
        expect(estadoAjuste(r)).toBe('en_conflicto');
    });

    it('un borrador que coincide con lo vigente NO es conflicto', () => {
        const r = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            draft_status: 'pending', draft_min: 10, draft_max: 30,
        };
        expect(estadoAjuste(r)).toBe('respetado');
    });

    it('avisa cuando un «ya no rota» volvió a venderse', () => {
        const r = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            _manual_motivo: 'ya_no_rota', last_sale_date: '2026-08-15',
        };
        expect(estadoAjuste(r)).toBe('volvio_a_moverse');
    });

    it('«volvió a moverse» gana sobre «en conflicto»: dice algo más fuerte', () => {
        const r = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            _manual_motivo: 'ya_no_rota', last_sale_date: '2026-08-15',
            calc_min: 10, calc_max: 289,
        };
        expect(estadoAjuste(r)).toBe('volvio_a_moverse');
    });

    it('una venta ANTERIOR al ajuste no lo invalida — es la que motivó bajarlo', () => {
        const r = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            _manual_motivo: 'ya_no_rota', last_sale_date: '2026-06-20',
        };
        expect(estadoAjuste(r)).toBe('respetado');
    });

    it('la venta del MISMO día del ajuste no lo invalida', () => {
        // `last_sale_date` es una fecha sin hora. Compararla contra el instante
        // del ajuste la haría retroceder al leerse como UTC y daría un falso
        // «volvió a moverse» a cualquier ajuste hecho ese mismo día.
        const r = {
            ...base, _manual_at: '2026-07-01T22:00:00Z',
            _manual_motivo: 'ya_no_rota', last_sale_date: '2026-07-01',
        };
        expect(estadoAjuste(r)).toBe('respetado');
    });

    it('sólo «ya no rota» puede volver a moverse — los otros motivos no lo declaran muerto', () => {
        for (const motivo of ['lo_buscan', 'cliente_fijo', 'otro']) {
            const r = {
                ...base, _manual_at: '2026-07-01T10:00:00Z',
                _manual_motivo: motivo, last_sale_date: '2026-08-15',
            };
            expect(estadoAjuste(r)).toBe('respetado');
        }
    });

    it('un ajuste SIN motivo declarado igual cuenta como ajuste', () => {
        // El motivo es opcional; la marca no. Una fila así no se pisa al
        // publicar, y tiene que poder verse en la lista.
        const r = { ...base, _manual_at: '2026-07-01T10:00:00Z', calc_min: 10, calc_max: 289 };
        expect(estadoAjuste(r)).toBe('en_conflicto');
    });
});
