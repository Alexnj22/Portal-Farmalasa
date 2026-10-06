import { describe, expect, it } from 'vitest';
import { reparosDeLaSemana } from '@nucleo/utils/reparosDeLaSemana';

const fechas = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const turno = { customStart: '08:00', customEnd: '16:00' };

describe('reparosDeLaSemana', () => {
    it('siete días seguidos sin descanso es un reparo', () => {
        const sch = { 0: turno, 1: turno, 2: turno, 3: turno, 4: turno, 5: turno, 6: turno };
        const { reparos, porPublicar } = reparosDeLaSemana({ personas: [{ id: 1, name: 'Ana Pérez' }], rosters: { 1: sch }, turnos: [], fechas });
        expect(reparos[0]).toBe('1 sin ningún día de descanso.');
        expect(porPublicar).toBe(1);
    });
    it('lo ya publicado no cuenta como pendiente', () => {
        const { porPublicar } = reparosDeLaSemana({ personas: [{ id: 1, name: 'Ana' }], rosters: {}, turnos: [], fechas, publicados: new Set(['1']) });
        expect(porPublicar).toBe(0);
    });
});
