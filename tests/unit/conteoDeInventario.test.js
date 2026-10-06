import { describe, expect, it } from 'vitest';
import { cantidadValida, conteoEditable, guardadoDelRenglon, noUbicado } from '@nucleo/utils/conteoDeInventario';

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
