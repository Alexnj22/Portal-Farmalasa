import { describe, it, expect } from 'vitest';
import { hora12, hora12ConSegundos, fechaHora12, rango12, hora12Papel, horasEnTexto } from '../../src/utils/hora';

// Regla del usuario (23 y 24-sep): toda hora del portal en 12 horas, de acá.
const NB = ' ';
const pm = (h) => `${h}${NB}p.${NB}m.`;
const am = (h) => `${h}${NB}a.${NB}m.`;

describe('hora12', () => {
    it('una hora de reloj, sin zona', () => {
        expect(hora12('13:06')).toBe(pm('1:06'));
        expect(hora12('13:06:59')).toBe(pm('1:06'));
        expect(hora12('08:00')).toBe(am('8:00'));
    });
    it('las doce son 12, nunca 0', () => {
        expect(hora12('00:15')).toBe(am('12:15'));
        expect(hora12('12:00')).toBe(pm('12:00'));
    });
    it('un instante se lee en El Salvador, no en UTC', () => {
        expect(hora12('2026-09-24T19:06:00Z')).toBe(pm('1:06'));
        expect(hora12(new Date('2026-09-24T06:05:00Z'))).toBe(am('12:05'));
    });
    it('lo que no entiende vuelve vacío', () => {
        expect(hora12(null)).toBe('');
        expect(hora12('25:00')).toBe('');
    });
});

describe('las variantes', () => {
    it('con segundos', () => expect(hora12ConSegundos('2026-09-24T19:06:42Z')).toBe(pm('1:06:42')));
    it('fecha y hora', () => expect(fechaHora12('2026-09-24T19:06:00Z')).toBe(`24 sept, ${pm('1:06')}`));
    it('un rango con un solo sufijo si no cruza el mediodía', () => {
        expect(rango12('14:00', '16:15')).toBe(`2:00 – ${pm('4:15')}`);
        expect(rango12('08:00', '17:00')).toBe(`${am('8:00')} – ${pm('5:00')}`);
    });
    it('el papel sólo lleva ASCII', () => {
        expect(hora12Papel('19:01:41')).toBe('7:01 p.m.');
        expect(/^[\x20-\x7e]*$/.test(hora12Papel('07:00'))).toBe(true);
    });
});

describe('horasEnTexto — el historial escrito en 24 horas', () => {
    it('pasa a 12 la hora que viene detrás de «las»', () => {
        expect(horasEnTexto('Corte de caja de las 22:05')).toBe(`Corte de caja de las ${pm('10:05')}`);
    });
    it('no duplica el punto que cierra la frase', () => {
        expect(horasEnTexto('entre las 06:36 y las 07:06. Salud 5'))
            .toBe(`entre las ${am('6:36')} y las ${am('7:06')} Salud 5`);
    });
    it('no toca lo que ya está en 12 ni lo que no es una hora', () => {
        expect(horasEnTexto(`a las ${pm('1:06')}`)).toBe(`a las ${pm('1:06')}`);
        expect(horasEnTexto('folio 12:30, $13.06')).toBe('folio 12:30, $13.06');
    });
});
