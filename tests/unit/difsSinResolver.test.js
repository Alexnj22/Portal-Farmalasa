import { describe, it, expect } from 'vitest';
import { difsSinResolver } from '../../src/views/pedidos/tabpedidos/helpers';

/**
 * El chip «Difs. pendientes» de la tarjeta de una sala.
 *
 * Nació de un caso real (2026-09-02, pedido #150): Salud 5 lo mostraba con su
 * única diferencia CERRADA. Se encendía con `pedido_status === 'parcial'`, que
 * es del pedido entero — la diferencia viva era de La Popular, la otra sala.
 */
const it_ = (status, resolucion_status) => ({ status, resolucion_status });

describe('difsSinResolver', () => {
    it('no afirma nada mientras los renglones no llegaron', () => {
        expect(difsSinResolver(undefined)).toBe(0);
        expect(difsSinResolver(null)).toBe(0);
    });

    it('una diferencia confirmada NO está pendiente', () => {
        // El caso SECUFEM: se corrigió, se acordó y el traslado ya entró.
        expect(difsSinResolver([it_('con_diferencia', 'confirmada')])).toBe(0);
    });

    it('cuenta los estados que todavía esperan a alguien', () => {
        // `acordada` tiene un movimiento en vuelo; los otros tres esperan turno.
        for (const est of ['acordada', 'propuesta', 'contrapropuesta', 'escalada']) {
            expect(difsSinResolver([it_('con_diferencia', est)])).toBe(1);
        }
    });

    it('cuenta la diferencia que nadie propuso todavía', () => {
        expect(difsSinResolver([it_('con_diferencia', null)])).toBe(1);
    });

    it('no cuenta lo que no es una diferencia', () => {
        expect(difsSinResolver([
            it_('recibido', null), it_('pendiente', null),
            it_('anulado', null), it_('no_enviado', null),
        ])).toBe(0);
    });

    it('el caso real del pedido #150', () => {
        const salud5    = [it_('recibido', null), it_('con_diferencia', 'confirmada')];
        const laPopular = [it_('recibido', null), it_('con_diferencia', 'contrapropuesta')];
        expect(difsSinResolver(salud5)).toBe(0);     // no muestra el chip
        expect(difsSinResolver(laPopular)).toBe(1);  // sí lo muestra
    });
});
