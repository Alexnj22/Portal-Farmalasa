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
    it('el voucher de $16 con un cobro de $1 deja $15 para una venta', () => {
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '16.00' }), '1');
        expect(e).toMatchObject({ valido: true, pideAutorizacion: false, resto: 15 });
    });
    it('el cobro no puede pasar del voucher', () => {
        const e = estadoDeFormaDePago(tarjeta({ foto: {}, comprobanteTotal: '10' }), 12);
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
    it('sin foto manda el motivo y no la lectura', () => {
        const d = datosDeFormaDePago(tarjeta({ sinComprobante: true, motivo: ' sin captura ' }), null);
        expect(d).toMatchObject({ motivoSinComprobante: 'sin captura', lectura: null, comprobanteTotal: null });
    });
});
