import { describe, it, expect } from 'vitest';
import {
    splitNocturnal, getWorkSegments, calcBreakMinutes, cstTimeToUTC, mondayOfWeek,
    minutosDeTardanza, toMinutes, LUNCH_OUT, LUNCH_IN,
} from '../../supabase/functions/_shared/tiempoTrabajado.ts';
import { minutosDeTardanza as tardanzaDeLaPantalla } from '@nucleo/data/attendanceAudit';

/* Lo que `consolidate-timesheets` escribe en `timesheets` y por lo tanto lo que
 * se PAGA. Hasta el 2026-10-28 no tenía una sola prueba (ASISTENCIA §7). Las
 * horas se escriben en hora de El Salvador con `sv()` para que el caso se lea
 * como lo vive la sala; el cálculo trabaja en UTC. */
const sv = (fechaHora) => new Date(`${fechaHora}:00-06:00`);
const reparto = (desde, hasta) => splitNocturnal(sv(desde), sv(hasta));

describe('reparto diurno / nocturno (19:00–06:00)', () => {
    it('un turno de día no tiene nada nocturno', () => {
        expect(reparto('2026-10-28T08:00', '2026-10-28T17:00')).toEqual({ diurnalMins: 540, nocturnalMins: 0 });
    });

    it('lo que pasa de las 19:00 es nocturno', () => {
        expect(reparto('2026-10-28T14:00', '2026-10-28T22:00')).toEqual({ diurnalMins: 300, nocturnalMins: 180 });
    });

    it('un turno que cruza la medianoche es nocturno entero', () => {
        expect(reparto('2026-10-28T22:00', '2026-10-29T06:00')).toEqual({ diurnalMins: 0, nocturnalMins: 480 });
    });

    it('de 18:00 a 07:00: una hora de día a cada punta y la noche entera en medio', () => {
        expect(reparto('2026-10-28T18:00', '2026-10-29T07:00')).toEqual({ diurnalMins: 120, nocturnalMins: 660 });
    });

    it('las fronteras exactas: 19:00 empieza la noche, 06:00 empieza el día', () => {
        expect(reparto('2026-10-28T19:00', '2026-10-28T19:30')).toEqual({ diurnalMins: 0, nocturnalMins: 30 });
        expect(reparto('2026-10-28T18:30', '2026-10-28T19:00')).toEqual({ diurnalMins: 30, nocturnalMins: 0 });
        expect(reparto('2026-10-29T05:30', '2026-10-29T06:30')).toEqual({ diurnalMins: 30, nocturnalMins: 30 });
    });

    it('cruzar la medianoche de UTC (18:00 SV) no parte el cálculo', () => {
        // 17:00–20:00 SV son 23:00–02:00 UTC.
        expect(reparto('2026-10-28T17:00', '2026-10-28T20:00')).toEqual({ diurnalMins: 120, nocturnalMins: 60 });
    });

    it('24 horas seguidas: 11 de noche y 13 de día', () => {
        expect(reparto('2026-10-28T06:00', '2026-10-29T06:00')).toEqual({ diurnalMins: 780, nocturnalMins: 660 });
    });

    it('cruzar fin de mes y de año', () => {
        expect(reparto('2026-12-31T21:00', '2027-01-01T02:00')).toEqual({ diurnalMins: 0, nocturnalMins: 300 });
    });

    it('un tramo vacío o al revés no suma nada (nunca negativo)', () => {
        expect(reparto('2026-10-28T10:00', '2026-10-28T10:00')).toEqual({ diurnalMins: 0, nocturnalMins: 0 });
        expect(reparto('2026-10-28T10:00', '2026-10-28T09:00')).toEqual({ diurnalMins: 0, nocturnalMins: 0 });
    });
});

describe('tramos trabajados y descansos', () => {
    const almuerzo = [
        { type: 'PUNCH_IN', timestamp: sv('2026-10-28T08:00').toISOString() },
        { type: 'LUNCH_START', timestamp: sv('2026-10-28T12:00').toISOString() },
        { type: 'LUNCH_END', timestamp: sv('2026-10-28T13:00').toISOString() },
        { type: 'PUNCH_OUT', timestamp: sv('2026-10-28T17:00').toISOString() },
    ];

    it('el almuerzo parte la jornada en dos tramos y no se cuenta', () => {
        const tramos = getWorkSegments(almuerzo, sv('2026-10-28T08:00'), sv('2026-10-28T17:00'));
        expect(tramos.map(t => [t.start.toISOString(), t.end.toISOString()])).toEqual([
            [sv('2026-10-28T08:00').toISOString(), sv('2026-10-28T12:00').toISOString()],
            [sv('2026-10-28T13:00').toISOString(), sv('2026-10-28T17:00').toISOString()],
        ]);
        expect(calcBreakMinutes(almuerzo, LUNCH_OUT, LUNCH_IN)).toBe(60);
    });

    it('un almuerzo de noche no se paga como nocturno', () => {
        const p = [
            { type: 'LUNCH_START', timestamp: sv('2026-10-29T01:00').toISOString() },
            { type: 'LUNCH_END', timestamp: sv('2026-10-29T02:00').toISOString() },
        ];
        const tramos = getWorkSegments(p, sv('2026-10-28T22:00'), sv('2026-10-29T06:00'));
        const nocturno = tramos.reduce((s, t) => s + splitNocturnal(t.start, t.end).nocturnalMins, 0);
        expect(nocturno).toBe(420);
    });

    it('la lactancia NO parte la jornada: es tiempo trabajado y pagado (RIT Art. 61)', () => {
        const p = [
            { type: 'LACTATION_START', timestamp: sv('2026-10-28T10:00').toISOString() },
            { type: 'LACTATION_END', timestamp: sv('2026-10-28T11:00').toISOString() },
        ];
        const tramos = getWorkSegments(p, sv('2026-10-28T08:00'), sv('2026-10-28T17:00'));
        expect(tramos).toHaveLength(1);
        // Un almuerzo sí se cuenta como descanso; una salida sin regreso, no.
        const a = [
            { type: 'LUNCH_START', timestamp: sv('2026-10-28T12:00').toISOString() },
            { type: 'LUNCH_END', timestamp: sv('2026-10-28T13:00').toISOString() },
            { type: 'LUNCH_START', timestamp: sv('2026-10-28T15:00').toISOString() },
        ];
        expect(calcBreakMinutes(a, LUNCH_OUT, LUNCH_IN)).toBe(60);
    });

    it('lo que cae fuera de la jornada se ignora', () => {
        const p = [{ type: 'LUNCH_START', timestamp: sv('2026-10-28T07:00').toISOString() }];
        const tramos = getWorkSegments(p, sv('2026-10-28T08:00'), sv('2026-10-28T17:00'));
        expect(tramos).toHaveLength(1);
    });
});

describe('turno nocturno completo, como lo arma el cron', () => {
    // Turno 22:00–06:00, trabajó 21:30–06:30. Lo nocturno del turno (480) es
    // ordinario; lo nocturno de más (21:30–22:00) es extra nocturna.
    it('separa la nocturna ordinaria de la extra nocturna', () => {
        const turno = splitNocturnal(cstTimeToUTC('2026-10-28', '22:00'),
            new Date(cstTimeToUTC('2026-10-28', '06:00').getTime() + 24 * 3600000)).nocturnalMins;
        const real = reparto('2026-10-28T21:30', '2026-10-29T06:30').nocturnalMins;
        expect(turno).toBe(480);
        expect(real).toBe(510);
        expect(Math.min(real, turno)).toBe(480);
        expect(Math.max(0, real - turno)).toBe(30);
    });
});

describe('fechas y horas', () => {
    it('la hora de El Salvador como instante', () => {
        expect(cstTimeToUTC('2026-10-28', '08:00').toISOString()).toBe('2026-10-28T14:00:00.000Z');
        expect(cstTimeToUTC('2026-10-28', '22:00').toISOString()).toBe('2026-10-29T04:00:00.000Z');
        expect(toMinutes('19:30')).toBe(1170);
    });

    it('el lunes de la semana', () => {
        expect(mondayOfWeek('2026-10-28')).toBe('2026-10-26'); // miércoles
        expect(mondayOfWeek('2026-10-26')).toBe('2026-10-26'); // lunes
        expect(mondayOfWeek('2026-11-01')).toBe('2026-10-26'); // domingo
        expect(mondayOfWeek('2027-01-01')).toBe('2026-12-28'); // cruza el año
    });
});

describe('tardanza — una sola regla', () => {
    const turno8 = cstTimeToUTC('2026-10-28', '08:00');

    it('minutos enteros cumplidos; llegar antes es puntual', () => {
        expect(minutosDeTardanza(sv('2026-10-28T08:17'), turno8)).toBe(17);
        expect(minutosDeTardanza('2026-10-28T14:00:59Z', turno8)).toBe(0);
        expect(minutosDeTardanza('2026-10-28T14:01:00Z', turno8)).toBe(1);
        expect(minutosDeTardanza(sv('2026-10-28T07:45'), turno8)).toBe(0);
        expect(minutosDeTardanza(null, turno8)).toBe(0);
        expect(minutosDeTardanza(sv('2026-10-28T08:30'), null)).toBe(0);
        expect(minutosDeTardanza('basura', turno8)).toBe(0);
    });

    it('la pantalla usa la MISMA función que el cron', () => {
        expect(tardanzaDeLaPantalla).toBe(minutosDeTardanza);
    });
});
