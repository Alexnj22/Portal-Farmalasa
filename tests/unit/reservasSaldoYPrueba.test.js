import { describe, it, expect } from 'vitest';
import { esPagoDePrueba, reservasAbiertas, resumenDelPedido, saldosAFavor } from '@nucleo/utils/reservasDeSala';

// (2026-10-19) Lo pagado en línea y cancelado queda a favor: una CANCELADA con
// saldo viaja en la lista de la sala y NO puede leerse como reserva abierta
// (antes «abierta» era «todo lo que no está vencido»).
describe('reservas de la sala: saldo a favor y cobro de prueba', () => {
    const filas = [
        { id: 1, estado: 'pendiente' },
        { id: 2, estado: 'en_revision' },
        { id: 3, estado: 'lista' },
        { id: 4, estado: 'cancelada', saldo_favor: 12 },
        { id: 5, estado: 'vencida', saldo_favor: 5 },
        { id: 6, estado: 'vencida', saldo_favor: 5, saldo_favor_usado_at: '2026-10-19T10:00:00Z' },
        { id: 7, estado: 'cancelada', saldo_favor: 9, saldo_favor_devuelto_at: '2026-10-19T10:00:00Z' },
    ];

    it('abiertas: sólo en revisión, pendientes y listas', () => {
        expect(reservasAbiertas(filas).map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it('saldos: cerradas con saldo, ni usado ni devuelto', () => {
        expect(saldosAFavor(filas).map((r) => r.id)).toEqual([4, 5]);
    });

    it('un cobro en línea de prueba no cuenta como pagado', () => {
        const prueba = { pedido: 'P-ABC123', pago_estado: 'pagado', pago_metodo: 'en_linea', pago_prueba: true, precio: 1, cantidad: 1 };
        expect(esPagoDePrueba(prueba)).toBe(true);
        expect(esPagoDePrueba({ ...prueba, pago_prueba: false })).toBe(false);
        const r = resumenDelPedido([prueba], 'P-ABC123');
        expect(r.pagado).toBe(false);
        expect(r.prueba).toBe(true);
    });
});
