import { describe, expect, it } from 'vitest';
import { conteoDeObservaciones, esSolventable, metaObs, observacionesPendientes, sinResolver } from '@nucleo/utils/colasDeFacturacion';

describe('colasDeFacturacion', () => {
    it('un rechazo de Hacienda no se tapa con una resolución vieja', () => {
        const rows = [
            { id: 1, observaciones: ['SUMA_NO_CUADRA'] },
            { id: 2, observaciones: ['RECHAZADA_POR_HACIENDA'] },
            { id: 3, observaciones: ['SIN_CORRELATIVO', 'SUMA_NO_CUADRA'] },
        ];
        const res = [{ invoice_id: 1 }, { invoice_id: 2 }];
        expect(observacionesPendientes(rows, res).map((r) => r.id)).toEqual([2, 3]);
        expect(esSolventable(rows[1])).toBe(false);
        expect(conteoDeObservaciones(observacionesPendientes(rows, res))[0][0]).toBe('RECHAZADA_POR_HACIENDA');
    });
    it('un código desconocido se muestra crudo', () => {
        expect(metaObs('NUEVO')).toEqual({ label: 'NUEVO', variant: 'warning' });
        expect(metaObs('SELLO_INVALIDO').label).toBe('Sello inválido');
    });
    it('sin resolver', () => {
        expect(sinResolver([{ id: 1 }, { id: 2 }], [{ invoice_id: 2 }]).map((r) => r.id)).toEqual([1]);
        expect(sinResolver(null, null)).toEqual([]);
    });
});
