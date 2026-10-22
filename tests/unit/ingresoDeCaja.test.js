import { describe, expect, it } from 'vitest';
import { choqueDeSentido, frenoDelMonto, lecturaDeBoleta, problemaDeBoleta } from '@nucleo/utils/ingresoDeCaja';

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
        expect(l.aviso).toMatch(/no lo pude comprobar/);
        expect(l.aviso).toMatch(/Falta el número/);
    });
    it('nada legible: a mano', () => {
        expect(lecturaDeBoleta({ leido: {} })).toMatchObject({ aMano: true, aviso: 'La foto no se dejó leer. Escribe los datos a mano.' });
    });
    it('sin choque de boleta, null', () => {
        expect(problemaDeBoleta([], true, '1')).toBeNull();
        expect(choqueDeSentido({ leido: {} }, true)).toBeNull();
    });

    describe('frenoDelMonto', () => {
        const unico = { montoConfianza: 'UNICO', leido: { monto: 19.87 } };
        it('confirmado por el papel: no frena', () => {
            expect(frenoDelMonto({ lectura: { ...unico, montoConfianza: 'CONFIRMADO' }, monto: '19.87', intentos: 0 })).toBeNull();
        });
        it('primera lectura sin comprobar: pide otra foto y frena', () => {
            expect(frenoDelMonto({ lectura: unico, monto: '19.87', intentos: 1 })).toMatchObject({ paso: 'OTRA_FOTO', bloquea: true });
        });
        it('segunda lectura sin comprobar: casilla, frena hasta marcarla', () => {
            expect(frenoDelMonto({ lectura: unico, monto: '19.87', intentos: 2 })).toMatchObject({ paso: 'COTEJAR', bloquea: true });
            expect(frenoDelMonto({ lectura: unico, monto: '19.87', intentos: 2, cotejado: true })).toMatchObject({ paso: 'COTEJAR', bloquea: false });
        });
        it('«trae el monto una sola vez» salta a la casilla', () => {
            expect(frenoDelMonto({ lectura: unico, monto: '19.87', intentos: 1, unaSolaVez: true }).paso).toBe('COTEJAR');
        });
        it('monto escrito distinto al leído: es a mano, no frena', () => {
            expect(frenoDelMonto({ lectura: unico, monto: '18.87', intentos: 1 })).toBeNull();
        });
        it('sin lectura de monto: no frena', () => {
            expect(frenoDelMonto({ lectura: { montoConfianza: 'UNICO', leido: {} }, monto: '5', intentos: 1 })).toBeNull();
        });
    });
    describe('documento de proveedor', () => {
        const leido = { clase: 'PROVEEDOR', monto: 6, numero_boleta: '0801', proveedor: 'AGUA FRIA', tipo_documento: 'ORDEN_DE_DESPACHO', numero_documento: '0801' };
        it('confirmado por los renglones: lo dice así', () => {
            const l = lecturaDeBoleta({ leido, montoConfianza: 'CONFIRMADO' });
            expect(l.puesto.monto).toBe(true);
            expect(l.concepto).toBe('AGUA FRIA · Orden de despacho 0801');
            expect(l.aviso).toMatch(/renglones lo confirman/);
        });
        it('sin comprobar va directo a cotejar, sin pedir otra foto', () => {
            const f = frenoDelMonto({ lectura: { montoConfianza: 'UNICO', leido }, monto: '6', intentos: 0 });
            expect(f).toMatchObject({ paso: 'COTEJAR', bloquea: true });
            expect(f.texto).toMatch(/documento/);
        });
    });
});
