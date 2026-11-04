import { describe, expect, it } from 'vitest';
import { datosDeFormaDePago, estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL } from '@nucleo/utils/formaDePago';

const tarjeta = (cambios = {}) => ({ ...FORMA_DE_PAGO_INICIAL, forma: 'TARJETA', ...cambios });

describe('estadoDeFormaDePago', () => {
    it('el efectivo siempre vale y va a la caja', () => {
        const e = estadoDeFormaDePago(FORMA_DE_PAGO_INICIAL, '5');
        expect(e).toMatchObject({ valido: true, noEfectivo: false, pideAutorizacion: false });
    });
    it('sin estado es efectivo (las pantallas que no preguntan)', () => {
        expect(estadoDeFormaDePago(null, 5).noEfectivo).toBe(false);
    });
    it('tarjeta sin foto ni «no tengo» no se puede anotar', () => {
        const e = estadoDeFormaDePago(tarjeta(), 5);
        expect(e.valido).toBe(false);
        expect(e.falta).toMatch(/voucher/);
    });
    it('sin comprobante pide autorización y exige el porqué', () => {
        expect(estadoDeFormaDePago(tarjeta({ sinComprobante: true, motivo: 'no' }), 5).valido).toBe(false);
        const e = estadoDeFormaDePago(tarjeta({ sinComprobante: true, motivo: 'el POS no imprimió' }), 5);
        expect(e).toMatchObject({ valido: true, pideAutorizacion: true });
    });
    it('con foto, el total y el número son obligatorios (2026-11-04)', () => {
        expect(estadoDeFormaDePago(tarjeta({ foto: {} }), 1).falta).toMatch(/total y el número del voucher/);
        expect(estadoDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '6.25' }), 1).valido).toBe(false);
        expect(estadoDeFormaDePago(tarjeta({ foto: {}, numero: '3729' }), 1).valido).toBe(false);
        expect(estadoDeFormaDePago({ ...FORMA_DE_PAGO_INICIAL, forma: 'TRANSFERENCIA', foto: {}, comprobanteTotal: '19.50' }, 19.5).falta)
            .toMatch(/referencia/);
    });
    it('sin total o número, con autorización y su porqué', () => {
        expect(estadoDeFormaDePago(tarjeta({ foto: {}, sinDatos: true, motivo: 'x' }), 1).valido).toBe(false);
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, sinDatos: true, motivo: 'no se lee el voucher' }), 1);
        expect(e).toMatchObject({ valido: true, pideAutorizacion: true });
    });
    it('«sin datos» no pide autorización si los datos sí están', () => {
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, sinDatos: true, comprobanteTotal: '5', numero: '12' }), 1);
        expect(e).toMatchObject({ valido: true, pideAutorizacion: false });
    });
    it('el voucher de $16 con un cobro de $1 deja $15 para una venta', () => {
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '16.00', numero: '777' }), '1');
        expect(e).toMatchObject({ valido: true, pideAutorizacion: false, resto: 15 });
    });
    it('el cobro no puede pasar del voucher', () => {
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '10', numero: '777' }), 12);
        expect(e.valido).toBe(false);
    });
    it('la transferencia habla de su comprobante', () => {
        const e = estadoDeFormaDePago({ ...FORMA_DE_PAGO_INICIAL, forma: 'TRANSFERENCIA' }, 5);
        expect(e.falta).toMatch(/transferencia/);
    });
});

describe('datosDeFormaDePago', () => {
    it('el efectivo sólo dice que es efectivo', () => {
        expect(datosDeFormaDePago(FORMA_DE_PAGO_INICIAL)).toEqual({ formaPago: 'EFECTIVO' });
    });
    it('con foto no manda motivo, y el número viaja como boleta', () => {
        const d = datosDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '$16', numero: ' 000777 ', motivo: 'x', lectura: { a: 1 } }), 'url');
        expect(d).toEqual({ formaPago: 'TARJETA', comprobanteTotal: 16, boleta: '000777', lectura: { a: 1 }, motivoSinComprobante: '' });
    });
    it('con foto pero sin número, manda el motivo para la autorización', () => {
        const d = datosDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '6.25', sinDatos: true, motivo: ' borroso ' }), 'url');
        expect(d).toMatchObject({ boleta: null, motivoSinComprobante: 'borroso' });
    });
    it('sin foto manda el motivo y no la lectura', () => {
        const d = datosDeFormaDePago(tarjeta({ sinComprobante: true, motivo: ' sin captura ' }), null);
        expect(d).toMatchObject({ motivoSinComprobante: 'sin captura', lectura: null, comprobanteTotal: null });
    });
});
