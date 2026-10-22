// «Leídos de este mes» se corta con el mes de El Salvador, no el de UTC.
import { describe, it, expect } from 'vitest';
import { mesDe, comunicadosDeLaPestana, hayLeidosViejos } from '@nucleo/utils/misComunicados';

describe('el mes de «Leídos»', () => {
    it('el 31 a las 19:00 de la sala sigue siendo ese mes', () => {
        // 2026-10-31 19:00 SV = 2026-11-01 01:00 UTC.
        expect(mesDe(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10');
    });

    it('un aviso publicado el 31 a las 19:00 cuenta en ese mes', () => {
        const ahora = new Date('2026-11-01T01:30:00Z');   // 31-oct 19:30 SV
        const lista = [
            { id: 1, date: '2026-11-01T01:00:00Z', readBy: [7] },   // 31-oct 19:00 SV
            { id: 2, date: '2026-10-05T15:00:00Z', readBy: [7] },
        ];
        expect(comunicadosDeLaPestana(lista, 'READ', 7, { ahora }).map((a) => a.id)).toEqual([1, 2]);
        expect(hayLeidosViejos(lista, 7, ahora)).toBe(false);
    });
});
