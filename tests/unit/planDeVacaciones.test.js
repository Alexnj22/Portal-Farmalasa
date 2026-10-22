import { describe, expect, it } from 'vitest';
import { diasDeVacacion, diasUsadosPorPersona, planesVisibles, ventanaDeVacaciones } from '@nucleo/utils/planDeVacaciones';

describe('planDeVacaciones', () => {
    it('un extremo con hora no cuenta', () => {
        expect(diasDeVacacion('2026-09-05', '2026-09-21')).toBe(17);
        expect(diasDeVacacion('2026-09-05', '2026-09-21', '12:00', '08:00')).toBe(15);
        expect(diasDeVacacion('2026-09-21', '2026-09-05')).toBe(0);
    });
    it('días usados: sólo aprobado, confirmado o tomado del año', () => {
        const m = diasUsadosPorPersona([
            { employee_id: 1, year: 2026, status: 'APPROVED', days: 5 },
            { employee_id: 1, year: 2026, status: 'TAKEN', days: 3 },
            { employee_id: 1, year: 2026, status: 'DRAFT', days: 9 },
            { employee_id: 1, year: 2025, status: 'TAKEN', days: 9 },
        ], 2026);
        expect(m.get('1')).toBe(8);
    });
    it('filtra por estado y ordena por sala y fecha', () => {
        const ps = [
            { status: 'APPROVED', start_date: '2026-05-01', branch: { name: 'Salud 1' }, employee: { name: 'Ana' } },
            { status: 'DRAFT', start_date: '2026-03-01', branch: { name: 'La Popular' }, employee: { name: 'Luis' } },
            { status: 'APPROVED', start_date: '2026-02-01', branch: { name: 'La Popular' }, employee: { name: 'Eva' } },
        ];
        expect(planesVisibles(ps).planes.map((p) => p.employee.name)).toEqual(['Eva', 'Luis', 'Ana']);
        expect(planesVisibles(ps, { estado: 'APPROVED' }).planes.length).toBe(2);
    });
});

describe('ventanaDeVacaciones (Art. 182)', () => {
    it('una ventana que cruza el fin de año se acepta', () => {
        // Ingreso 10-nov: el 15-ene-2027 cae en la ventana 10-nov-2026 → 10-mar-2027.
        expect(ventanaDeVacaciones('2020-11-10', '2027-01-15', 4)).toEqual({ dentro: true, desde: '2026-11-10', hasta: '2027-03-10' });
    });
    it('fuera de los meses de la ventana, no; el día del aniversario, sí', () => {
        expect(ventanaDeVacaciones('2020-11-10', '2027-04-01', 4).dentro).toBe(false);
        expect(ventanaDeVacaciones('2020-03-01', '2027-03-01', 4)).toEqual({ dentro: true, desde: '2027-03-01', hasta: '2027-07-01' });
    });
});
