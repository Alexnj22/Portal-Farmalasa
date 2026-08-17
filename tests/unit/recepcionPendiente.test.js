import { describe, it, expect } from 'vitest';
import { hayRecepcionPendiente } from '../../src/views/pedidos/tabpedidos/helpers';

// El caso real: La Popular, pedido 116 del 2026-08-17 (código 09-170826-3-PO).
// 174 renglones despachados —169 repartidos en 5 hojas y 5 en cajas especiales—.
// Al cerrar la hoja 1 se reportó «viene 1 más en físico» en un renglón, y eso
// solo bastó para que `receive_pedido_sucursal` pasara el PEDIDO a «parcial»
// con 139 renglones todavía pendientes. La tarjeta pedía «enviado» para pintar
// el bloque de Recepción, así que la sala se quedó sin forma de contar las 4
// hojas y las 8 cajas especiales que faltaban.
const LA_POPULAR_116 = { pedidoStatus: 'parcial', pendientes: 139, reenviosHistorial: [] };

describe('hayRecepcionPendiente', () => {
    it('un pedido en curso se recibe', () => {
        expect(hayRecepcionPendiente({ pedidoStatus: 'enviado', pendientes: 174 })).toBe(true);
    });

    it('una diferencia reportada a mitad de la recepción no cierra la puerta', () => {
        expect(hayRecepcionPendiente(LA_POPULAR_116)).toBe(true);
    });

    it('con todo contado, «parcial» ya no ofrece recibir — sólo resolver diferencias', () => {
        expect(hayRecepcionPendiente({ pedidoStatus: 'parcial', pendientes: 0 })).toBe(false);
    });

    it('un pedido que todavía no sale de bodega no se recibe, aunque todo esté pendiente', () => {
        // `pendientes` cuenta desde que se arma el pedido: sin la guarda de
        // estado, un «confirmado» sin despachar mostraría el bloque de recepción.
        expect(hayRecepcionPendiente({ pedidoStatus: 'confirmado', pendientes: 174 })).toBe(false);
    });

    it('un pedido terminado no se recibe', () => {
        expect(hayRecepcionPendiente({ pedidoStatus: 'completado', pendientes: 0 })).toBe(false);
        expect(hayRecepcionPendiente({ pedidoStatus: 'anulado', pendientes: 12 })).toBe(false);
    });

    it('un reenvío en camino abre la recepción por su cuenta', () => {
        expect(hayRecepcionPendiente({
            pedidoStatus: 'parcial', pendientes: 0,
            reenviosHistorial: [{ ciclo: 1, sent_at: '2026-08-17T20:00:00Z', arrived_at: null }],
        })).toBe(true);
    });

    it('un reenvío que ya llegó no la abre sola', () => {
        expect(hayRecepcionPendiente({
            pedidoStatus: 'completado', pendientes: 0,
            reenviosHistorial: [{ ciclo: 1, sent_at: '2026-08-17T20:00:00Z', arrived_at: '2026-08-17T21:00:00Z' }],
        })).toBe(false);
    });

    it('sin datos no inventa nada', () => {
        expect(hayRecepcionPendiente({})).toBe(false);
    });
});
