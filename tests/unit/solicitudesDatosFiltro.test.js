import { describe, expect, it } from 'vitest';
import { alarmasDePlazo, filtrarSolicitudes } from '@nucleo/data/solicitudesDatos';

const filas = [
    { id: 1, estado: 'RECIBIDA', recibida_at: '2026-09-01T15:00:00Z', solicitante_nombre: 'Ana' },
    { id: 2, estado: 'RESUELTA', recibida_at: '2026-09-02T15:00:00Z', solicitante_nombre: 'Luis' },
    { id: 3, estado: 'ANULADA', impresa_at: '2026-09-03T15:00:00Z' },
    { id: 4, estado: 'IMPRESA', impresa_at: '2026-10-01T15:00:00Z' },
];
const contiene = (q, ...c) => c.some((x) => String(x || '').toLowerCase().includes(q.toLowerCase()));

describe('filtrarSolicitudes', () => {
    it('en trámite es lo que no está resuelto ni anulado', () => {
        expect(filtrarSolicitudes(filas, { pestana: 'tramite' }).map((s) => s.id)).toEqual([1, 4]);
        expect(filtrarSolicitudes(filas, { pestana: 'resueltas' }).map((s) => s.id)).toEqual([2]);
    });
    it('la fecha es la del acuse, y si no hay, la de impresión', () => {
        expect(filtrarSolicitudes(filas, { desde: '2026-10-01' }).map((s) => s.id)).toEqual([4]);
    });
    it('busca con la función que le pasan', () => {
        expect(filtrarSolicitudes(filas, { texto: 'luis' }, contiene).map((s) => s.id)).toEqual([2]);
    });
});

describe('alarmasDePlazo', () => {
    it('cuenta vencidas y las que apremian por separado', () => {
        const ahora = new Date('2026-10-05T18:00:00Z');
        const r = alarmasDePlazo([
            { estado: 'RECIBIDA', recibida_at: '2026-08-31T15:00:00Z' },
            { estado: 'RECIBIDA', recibida_at: '2026-09-11T15:00:00Z' },
            { estado: 'RESUELTA', recibida_at: '2026-08-01T15:00:00Z' },
        ], ahora);
        expect(r.vencidas).toBe(1);
        expect(r.apremian).toBe(1);
    });
});
