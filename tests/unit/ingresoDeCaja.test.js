import { describe, expect, it } from 'vitest';
import { choqueDeSentido, lecturaDeBoleta, problemaDeBoleta } from '@nucleo/utils/ingresoDeCaja';

describe('ingresoDeCaja', () => {
    it('lectura fallida: escribir a mano', () => {
        expect(lecturaDeBoleta({ error: new Error('x') })).toMatchObject({ error: true, aMano: true });
    });
    it('monto confirmado se llena y se puede cerrar', () => {
        const l = lecturaDeBoleta({ montoConfianza: 'CONFIRMADO', leido: { monto: 25.5, numero_boleta: '018540' } }, { pideBoleta: true });
        expect([l.monto, l.boleta, l.puesto.monto, l.aMano]).toEqual(['25.5', '018540', true, false]);
        expect(l.aviso).toMatch(/la boleta lo confirma/);
    });
    it('monto de una sola vez: se llena pero no se cierra, y lo dice', () => {
        const l = lecturaDeBoleta({ montoConfianza: 'UNICO', leido: { monto: 10 } }, { pideBoleta: true });
        expect(l.puesto.monto).toBe(false);
        expect(l.aviso).toMatch(/sólo lo dice una vez/);
        expect(l.aviso).toMatch(/Falta el número/);
    });
    it('nada legible: a mano', () => {
        expect(lecturaDeBoleta({ leido: {} })).toMatchObject({ aMano: true, aviso: 'La foto no se dejó leer. Escribe los datos a mano.' });
    });
    it('sin choque de boleta, null', () => {
        expect(problemaDeBoleta([], true, '1')).toBeNull();
        expect(choqueDeSentido({ leido: {} }, true)).toBeNull();
    });
});
