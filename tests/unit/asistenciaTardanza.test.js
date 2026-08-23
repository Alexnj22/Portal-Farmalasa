// Asistencia — la hora de El Salvador y los minutos de tardanza.
//
// El área no tenía ni una prueba, y su única matemática estaba escondida dentro
// del render de `AttendanceAuditView.jsx`, sin exportar. Salió a
// `data/attendanceAudit.js` con la auditoría del 2026-08-23 para poder medirla.
//
// Importa porque de esos minutos salen las horas de la quincena, y de ahí la
// planilla. Un turno leído en el huso equivocado no da error: descuenta seis
// horas de tardanza a alguien que llegó puntual, o al revés.

import { describe, it, expect } from 'vitest';
import { buildCSTDate, getCSTDateStr, minutosDeTardanza } from '../../src/data/attendanceAudit';

describe('la hora del turno es hora de El Salvador', () => {
    it('las 08:00 de El Salvador son las 14:00 UTC', () => {
        // El Salvador es UTC−6 fijo, sin horario de verano. Si esto se
        // construyera sin el desfase, el turno de las 8 de la mañana sería a las
        // 2 de la mañana y todo el mundo llegaría seis horas tarde.
        expect(buildCSTDate('2026-08-23', '08:00').toISOString()).toBe('2026-08-23T14:00:00.000Z');
        expect(buildCSTDate('2026-08-23', '00:00').toISOString()).toBe('2026-08-23T06:00:00.000Z');
        expect(buildCSTDate('2026-08-23', '18:30').toISOString()).toBe('2026-08-24T00:30:00.000Z');
    });

    it('sin fecha o sin hora devuelve null, no una fecha inválida', () => {
        // `new Date('undefined')` es un Invalid Date, y restarle algo da NaN,
        // que se propaga hasta el total de horas de la quincena sin avisar.
        expect(buildCSTDate(null, '08:00')).toBeNull();
        expect(buildCSTDate('2026-08-23', null)).toBeNull();
        expect(buildCSTDate('', '')).toBeNull();
    });

    it('el día salvadoreño de un instante no es el día UTC', () => {
        // 2026-08-24 02:00 UTC son las 20:00 del 23 en El Salvador. Contado en
        // UTC, la marcación de las 8 de la noche cae en el día siguiente y la
        // jornada queda partida en dos.
        expect(getCSTDateStr('2026-08-24T02:00:00Z')).toBe('2026-08-23');
        expect(getCSTDateStr('2026-08-24T06:00:00Z')).toBe('2026-08-24');
        expect(getCSTDateStr(new Date('2026-08-24T05:59:59Z'))).toBe('2026-08-23');
    });
});

describe('los minutos de tardanza', () => {
    const turno8 = buildCSTDate('2026-08-23', '08:00');

    it('cuenta los minutos desde la hora del turno', () => {
        expect(minutosDeTardanza('2026-08-23T14:17:00Z', turno8)).toBe(17);
        expect(minutosDeTardanza('2026-08-23T15:00:00Z', turno8)).toBe(60);
    });

    it('llegar antes es puntual, no tardanza negativa', () => {
        // Sin el piso en cero, quien llega temprano restaría minutos del total
        // de la quincena y compensaría la tardanza de otro día.
        expect(minutosDeTardanza('2026-08-23T13:45:00Z', turno8)).toBe(0);
        expect(minutosDeTardanza('2026-08-23T14:00:00Z', turno8)).toBe(0);
    });

    it('trunca los segundos hacia abajo', () => {
        // 59 segundos no son un minuto de tardanza.
        expect(minutosDeTardanza('2026-08-23T14:00:59Z', turno8)).toBe(0);
        expect(minutosDeTardanza('2026-08-23T14:01:59Z', turno8)).toBe(1);
    });

    it('sin marcación o sin turno no hay tardanza que contar', () => {
        // Cero y no null: el total de la quincena los SUMA, y un null se
        // convierte en NaN que se come el total entero.
        expect(minutosDeTardanza(null, turno8)).toBe(0);
        expect(minutosDeTardanza('2026-08-23T14:17:00Z', null)).toBe(0);
        expect(minutosDeTardanza(null, null)).toBe(0);
    });

    it('una fecha que no se entiende da cero, no NaN', () => {
        expect(minutosDeTardanza('no soy una fecha', turno8)).toBe(0);
        expect(minutosDeTardanza('2026-08-23T14:17:00Z', 'tampoco')).toBe(0);
        expect(Number.isNaN(minutosDeTardanza('x', 'y'))).toBe(false);
    });

    it('acepta el turno como Date o como texto', () => {
        expect(minutosDeTardanza('2026-08-23T14:17:00Z', turno8)).toBe(17);
        expect(minutosDeTardanza('2026-08-23T14:17:00Z', turno8.toISOString())).toBe(17);
    });

    it('el turno de noche cruza la medianoche sin inventar una jornada', () => {
        // Turno de 22:00: quien marca a las 22:10 llega 10 minutos tarde, no
        // 1.430 (que es lo que da si el día se toma del lado equivocado).
        const turno22 = buildCSTDate('2026-08-23', '22:00');
        expect(minutosDeTardanza('2026-08-24T04:10:00Z', turno22)).toBe(10);
    });
});
