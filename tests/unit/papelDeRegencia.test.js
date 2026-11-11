import { describe, it, expect } from 'vitest';
import { htmlDelRotulo, htmlDeLaHojaDeAsistencia } from '@nucleo/utils/papelDeRegencia';

const regencia = {
    sala: 'Salud 1', mes: '2026-11-01', minimo: 20, jvpqf: '1234', horario: 'Martes, 8:00 a. m. – 12:00 m.',
    regente: { id: 'a', nombre: 'Juan <b>Díaz</b>' },
    visitas: [
        { id: 2, fecha: '2026-11-05', entrada: '08:00:00', salida: '12:30:00', horas: 4.5, actividades: ['controlados', 'vencidos'] },
        { id: 1, fecha: '2026-11-03', entrada: '08:00:00', salida: '10:00:00', horas: 2, actividades: ['otro'], anulada_at: '2026-11-03T20:00:00Z' },
    ],
};

describe('papel de regencia', () => {
    it('el rótulo lleva nombre escapado, JVPQF y horario', () => {
        const h = htmlDelRotulo(regencia);
        expect(h).toContain('Juan &lt;b&gt;Díaz&lt;/b&gt;');
        expect(h).toContain('JVPQF N.º 1234');
        expect(h).toContain('Martes, 8:00 a. m.');
    });
    it('la hoja deja fuera las anuladas y suma sólo las válidas', () => {
        const h = htmlDeLaHojaDeAsistencia(regencia);
        expect(h).toContain('noviembre de 2026');
        expect(h).toContain('Revisión de controlados; Vencidos y próximos a vencer');
        expect(h).not.toContain('>Otra<');
        expect(h).toContain('Total del mes: <b>4.50 h</b>');
    });
});
