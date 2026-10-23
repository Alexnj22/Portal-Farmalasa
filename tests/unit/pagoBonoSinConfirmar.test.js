// H20: un pago de bono que la caja no confirmó no se repite a ciegas. Lo dicen
// dos lados —la reserva (`SIN_CONFIRMAR` de `reservar_pago_bono`) y la salida
// (`sin_confirmar` de `operar-caja`)— y la pantalla tiene que reconocer los dos
// para llevar a resolverlo en vez de decir «No se pudo pagar».

import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('@nucleo/supabaseClient', () => ({ supabase: {} }));

const { esPagoSinConfirmar } = await import('@nucleo/data/bonosProducto');
const { mensajeAmigable } = await import('@nucleo/utils/errorMessages');

const deLaReserva = {
    message: 'SIN_CONFIRMAR: la caja no confirmó la salida de $30.00 de este bono. Revisa en la caja si salió antes de repetirla',
    code: 'P0001',
};

describe('esPagoSinConfirmar', () => {
    it('reconoce el rechazo de la reserva', () => {
        expect(esPagoSinConfirmar(deLaReserva)).toBe(true);
    });
    it('reconoce la marca que pone la salida cuando la caja no contestó', () => {
        expect(esPagoSinConfirmar(Object.assign(new Error('La caja no contestó…'), { sinConfirmar: true }))).toBe(true);
    });
    it('no confunde la etiqueta de un monto leído de la foto', () => {
        expect(esPagoSinConfirmar({ message: 'FOTO_SIN_CONFIRMAR' })).toBe(false);
        expect(esPagoSinConfirmar(new Error('EN_CURSO: ese pago se está registrando en la caja'))).toBe(false);
        expect(esPagoSinConfirmar(null)).toBe(false);
    });
});

describe('mensajeAmigable · pago de bonos', () => {
    // `mensajeAmigable` manda el error crudo a la consola: acá es ruido.
    let silencio;
    beforeAll(() => { silencio = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterAll(() => silencio.mockRestore());
    it('SIN_CONFIRMAR no sale crudo y no invita a repetir', () => {
        const m = mensajeAmigable(deLaReserva);
        expect(m).not.toMatch(/SIN_CONFIRMAR/);
        expect(m).toMatch(/No lo repitas/);
    });
    it('el EN_CURSO del bono se traduce, el de los pedidos no se toca', () => {
        expect(mensajeAmigable({ message: 'EN_CURSO: ese pago se está registrando en la caja' })).toMatch(/Espera unos minutos/);
        expect(mensajeAmigable({ message: 'EN_CURSO: el pedido se está despachando' })).not.toMatch(/bono|pago/i);
    });
    it('los rechazos del trigger de la salida hablan en palabras', () => {
        expect(mensajeAmigable({ message: 'guardando el movimiento: BONO_NO_RESERVADO: ese bono ya no está por pagar' }))
            .toBe('Ese bono ya no está por pagar. Recarga la lista.');
    });
});
