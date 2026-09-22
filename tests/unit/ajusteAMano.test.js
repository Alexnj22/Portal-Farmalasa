import { describe, it, expect } from 'vitest';
import { estadoAjuste } from '../../src/views/productos/tabminmax/useMinMaxData';

// Los estados de un MIN·MAX que puso una persona
// (docs/planes-cerrados/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md §4.3).
//
// Existe porque la diferencia entre los estados es la que decide qué mira
// alguien primero, y ninguno se puede comprobar mirando la pantalla hasta que
// haya ajustes reales cargados. Los casos salen de los productos medidos en el
// plan.
//
// Eran tres y desde el 2026-09-04 (e25fc1b3) son cuatro. Con tres, bastaba
// `manual_at` + un cálculo distinto para gritar EN CONFLICTO —que es el estado
// normal de cualquier fila tocada, cada mes—: en Salud 2 lo decían 59 de 65. Hoy
// `a_mano` es lo tecleado sin sello, y EN CONFLICTO / RESPETADO / VOLVIÓ A
// MOVERSE quedan para lo SELLADO —una solicitud aprobada o un motivo
// declarado—, el mismo corte que usa el freno de publicar. Por eso los casos de
// abajo que prueban esos tres llevan su sello: sin él, la regla que miden no es
// la que corre.

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
    _ajuste_solicitud_id: null,
};

// El sello de una solicitud aprobada, sin motivo declarado: aísla la
// comparación de números de la rama de «ya no rota».
const SELLADO = { _manual_at: '2026-07-01T10:00:00Z', _ajuste_solicitud_id: 812 };

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

    it('lo tecleado sin sello es «a mano», aunque el cálculo proponga otro número', () => {
        // El defecto del 2026-09-04: esta fila decía EN CONFLICTO. Es la forma
        // de casi toda fila que alguien tocó en la revisión del mes, y el
        // cálculo del mes que viene la reemplaza como a cualquier otra — no hay
        // nada que decidir. Un indicador que marca 59 de 65 no indica nada.
        const conCalculo = { ...base, _manual_at: '2026-07-01T10:00:00Z', calc_min: 10, calc_max: 289 };
        expect(estadoAjuste(conCalculo)).toBe('a_mano');
        const conBorrador = {
            ...base, _manual_at: '2026-07-01T10:00:00Z',
            draft_status: 'pending', draft_min: 10, draft_max: 260,
        };
        expect(estadoAjuste(conBorrador)).toBe('a_mano');
    });

    it('respeta el ajuste cuando el cálculo no lo contradice', () => {
        const r = { ...base, ...SELLADO, calc_min: 10, calc_max: 30 };
        expect(estadoAjuste(r)).toBe('respetado');
    });

    it('marca conflicto cuando el último cálculo propone otro número', () => {
        // El caso OMEPRAZOL: alguien puso 30 y el cálculo quiere 289.
        const r = { ...base, ...SELLADO, effective_max: 30, calc_min: 10, calc_max: 289 };
        expect(estadoAjuste(r)).toBe('en_conflicto');
    });

    it('marca conflicto cuando hay un borrador sin publicar que difiere', () => {
        const r = {
            ...base, ...SELLADO,
            draft_status: 'pending', draft_min: 10, draft_max: 260,
        };
        expect(estadoAjuste(r)).toBe('en_conflicto');
    });

    it('un borrador que coincide con lo vigente NO es conflicto', () => {
        const r = {
            ...base, ...SELLADO,
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
        // El motivo es opcional; la marca no. Una fila así tiene que poder
        // verse en la lista: sin sello es «a mano» —no `null`, que la sacaría
        // del filtro «Ajustado a mano»—, y con la solicitud aprobada como único
        // sello se compara igual que cualquier otra sellada.
        const tecleado = { ...base, _manual_at: '2026-07-01T10:00:00Z', calc_min: 10, calc_max: 289 };
        expect(estadoAjuste(tecleado)).toBe('a_mano');
        expect(estadoAjuste({ ...tecleado, ...SELLADO })).toBe('en_conflicto');
    });
});
