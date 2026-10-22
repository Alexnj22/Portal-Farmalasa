import { describe, it, expect } from 'vitest';
import {
    TRASLADO, cuentasDeReserva, detalleDelRenglonDeReserva, estadoDeReserva, telefonoLegible,
} from '@nucleo/utils/reservasDeSala';
import * as vista from '../../src/views/dashboard/reservaVista';

// (2026-10-22) La lógica de la tarjeta de reserva se mudó al núcleo para que
// la app la use. El `TRASLADO` del portal se DERIVA de `TRASLADO_DE_RESERVA`:
// esto fija que dice exactamente lo que decía la copia a mano.
describe('tarjeta de reserva: lógica del núcleo', () => {
    it('TRASLADO derivado = la tabla que tenía el portal', () => {
        expect(TRASLADO).toEqual({
            pedido: { label: 'Pedida a otra sala', variant: 'info' },
            enviado: { label: 'En camino', variant: 'info' },
            parcial: { label: 'Viene una parte', variant: 'warning' },
            rechazado: { label: 'No la mandan', variant: 'danger' },
            bodega: { label: 'Encargada a Bodega', variant: 'info' },
            precio: { label: 'Bodega: otro precio', variant: 'warning' },
            sin_existencia: { label: 'No se consigue', variant: 'danger' },
        });
    });

    it('reservaVista re-exporta lo mismo', () => {
        expect(vista.TRASLADO).toBe(TRASLADO);
        expect(vista.estadoDeReserva).toBe(estadoDeReserva);
    });

    it('estado, cuentas y teléfono', () => {
        const r = { estado: 'pendiente', renglones: [
            { id: 1, estado: 'pendiente', traslado_estado: 'rechazado', precio: 2, cantidad: 2, anticipo: 1 },
            { id: 2, estado: 'pendiente', precio: 3, cantidad: 1, anticipo: 0 },
        ], costo_envio: 1 };
        expect(estadoDeReserva(r)).toEqual({ label: 'No la mandan', variant: 'danger', tono: 'danger' });
        expect(cuentasDeReserva(r)).toEqual({ total: 8, pagado: 1, falta: 7, pagadoTodo: false });
        expect(telefonoLegible('72557451')).toBe('7255-7451');
        expect(detalleDelRenglonDeReserva({ estado: 'pendiente', traslado_estado: 'enviado', traslado_sala: 'Salud 2', traslado_llegaron: 1, cantidad: 3 }, true))
            .toBe('En camino de Salud 2 · llegaron 1 de 3');
    });
});
