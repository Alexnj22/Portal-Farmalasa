import { describe, it, expect } from 'vitest';
import {
    TRASLADO, accionesDeReservaNucleo, cuentasDeReserva, detalleDelRenglonDeReserva, estadoDeReserva, productosOcultos, telefonoLegible,
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
        expect(detalleDelRenglonDeReserva({ estado: 'pendiente', traslado_estado: 'enviado', traslado_sala: 'Salud 2', traslado_llegaron: 1, cantidad: 3 }))
            .toBe('En camino de Salud 2 · llegaron 1 de 3');
        expect(detalleDelRenglonDeReserva({ estado: 'lista' })).toBe('Lista');
        expect(detalleDelRenglonDeReserva({ estado: 'lista', lista_precio: 'mayoreo' })).toBe('Lista · precio Mayoreo');
        expect(productosOcultos(1)).toBe('+ 1 producto más');
        expect(productosOcultos(4)).toBe('+ 4 productos más');
        expect(productosOcultos(0)).toBe('');
    });
});

// (2026-10-22) La decisión de `accionesDeReserva` del portal, sin handlers:
// qué toca, en qué orden y con qué rótulo. La app la usa tal cual.
describe('accionesDeReservaNucleo', () => {
    const ks = (r, o) => accionesDeReservaNucleo(r, o).map((a) => a.k);

    it('una reserva lista sin app: retirar, caja, whatsapp, prorrogar, cancelar', () => {
        const r = { id: 1, estado: 'lista', origen: 'sucursal', tiene_app: false, renglones: [{ id: 1, estado: 'lista' }] };
        expect(ks(r, { puedePreventa: true })).toEqual(['retirar', 'caja', 'whatsapp', 'prorrogar', 'cancelar']);
        expect(ks(r, {})).toEqual(['retirar', 'whatsapp', 'prorrogar', 'cancelar']);
        const a = accionesDeReservaNucleo(r, {});
        expect(a.map((x) => x.label)).toEqual(['Retirar', 'Avisar por WhatsApp', 'Prorrogar 7 días', 'Cancelar reserva']);
        expect(a.at(-1).menor).toBe(true);
    });

    it('resolver va primero y le gana a traer; el renglón es el que lo necesita', () => {
        const traer = { id: 2, estado: 'pendiente', origen: 'app' };
        const resolver = { id: 3, estado: 'pendiente', origen: 'app', traslado_estado: 'rechazado' };
        const r = { ...traer, pedido: 'P-ABC123', renglones: [traer, resolver] };
        const a = accionesDeReservaNucleo(r, {});
        expect(a.map((x) => x.k)).toEqual(['resolver', 'apartar', 'cancelar']);
        expect(a[0].renglon).toBe(resolver);
        expect(a[1].label).toBe('Ya llegó: apartar');
        const soloTraer = accionesDeReservaNucleo({ ...traer, renglones: [traer] }, {});
        expect(soloTraer.map((x) => x.k)).toEqual(['apartar', 'traer', 'cancelar']);
        expect(soloTraer[0].label).toBe('Apartar y avisar');
    });

    it('receta: sólo la receta, también en sólo lectura; sin permiso, nada', () => {
        const r = { id: 4, estado: 'en_revision', receta_ruta: 'x', receta_estado: 'pendiente' };
        expect(accionesDeReservaNucleo(r, { soloLectura: true, puedeRecetas: true })).toEqual([{ k: 'receta', label: 'Revisar receta' }]);
        expect(ks({ ...r, receta_estado: 'otra_foto' }, { puedeRecetas: true })).toEqual(['receta']);
        expect(ks(r, {})).toEqual([]);
        expect(ks({ id: 5, estado: 'lista' }, { soloLectura: true })).toEqual([]);
    });
});
