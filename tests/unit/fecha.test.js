// El canónico del día en El Salvador (`src/utils/fecha.js`).
//
// La prueba que importa es la primera: el desplazamiento fijo tiene que dar
// EXACTAMENTE lo mismo que la zona `America/El_Salvador` de `Intl`, hora por
// hora, durante años. Si algún día no coincide, es que el país cambió de
// horario y hay que cambiar el canónico — que es justo lo que esta prueba avisa.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hoySV, diaSV, ahoraSV, horaSV, relojSV, sumarDias, diasEntre, lunesDe } from '../../src/utils/fecha';

const porZona = (instante) => {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/El_Salvador', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instante).map(p => [p.type, p.value]));
    return { dia: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}:${partes.second}` };
};

describe('el día de El Salvador', () => {
    it('coincide con la zona America/El_Salvador cada hora de 2024 a 2027', () => {
        const desde = Date.UTC(2024, 0, 1), hasta = Date.UTC(2028, 0, 1);
        let distintas = 0, vueltas = 0;
        for (let t = desde; t < hasta; t += 3600_000 + 17_000) {   // +17 s: recorre también minutos y segundos
            const z = porZona(t);
            if (diaSV(t) !== z.dia || horaSV(t) !== z.hora) distintas++;
            vueltas++;
        }
        expect(vueltas).toBeGreaterThan(34_000);
        expect(distintas).toBe(0);
    });

    it('a las 7:30 pm sigue siendo hoy — `toISOString()` ya decía mañana', () => {
        const noche = Date.parse('2026-09-26T01:30:00Z');       // 19:30 del 25 en la sala
        expect(diaSV(noche)).toBe('2026-09-25');
        expect(new Date(noche).toISOString().slice(0, 10)).toBe('2026-09-26');
    });

    it('hoySV, ahoraSV y relojSV leen el mismo instante', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T05:59:59Z'));      // 23:59:59 del 31-dic en la sala
        expect(hoySV()).toBe('2025-12-31');
        expect(ahoraSV()).toEqual({ y: 2025, m: 11, d: 31, h: 23, min: 59, s: 59 });
        expect(relojSV().getUTCHours()).toBe(23);
    });

    it('acepta un instante como texto, número o Date', () => {
        const iso = '2026-09-25T03:00:00Z';
        expect(diaSV(iso)).toBe('2026-09-24');
        expect(diaSV(Date.parse(iso))).toBe('2026-09-24');
        expect(diaSV(new Date(iso))).toBe('2026-09-24');
    });
});

describe('aritmética de calendario', () => {
    it('sumarDias cruza meses, años y el 29 de febrero', () => {
        expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
        expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29');
        expect(sumarDias('2025-02-28', 1)).toBe('2025-03-01');
        expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
        expect(sumarDias('2026-09-25', -90)).toBe('2026-06-27');
        expect(sumarDias('2026-09-25T18:00:00', 0)).toBe('2026-09-25');
    });

    it('lunesDe: la semana arranca el lunes, y el domingo es de la semana que termina', () => {
        expect(lunesDe('2026-09-21')).toBe('2026-09-21');   // lunes
        expect(lunesDe('2026-09-25')).toBe('2026-09-21');   // viernes
        expect(lunesDe('2026-09-27')).toBe('2026-09-21');   // domingo
        expect(lunesDe('2026-01-01')).toBe('2025-12-29');   // cruza el año
    });

    it('diasEntre es la inversa de sumarDias', () => {
        for (const n of [-400, -31, -1, 0, 1, 29, 365, 366]) {
            expect(diasEntre('2024-02-10', sumarDias('2024-02-10', n))).toBe(n);
        }
    });
});

afterEach(() => { vi.useRealTimers(); });
