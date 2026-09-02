import { describe, it, expect } from 'vitest';
import { necesitaAtencion } from '../../src/views/pedidos/tabpedidos/helpers';

/**
 * La primera clave del orden del tablero: lo que le pide algo a alguien AHORA
 * va arriba, sin importar la fecha.
 *
 * Nació de un pedido del usuario (2026-09-02) sobre un defecto que iba al
 * revés: una diferencia abierta MANDABA la tarjeta al fondo, porque el orden
 * por etapa ponía «con observación» en el escalón 6 de 7.
 */
const enRuta     = { enviado_at: '2026-09-02T15:00:00Z', llegada_fisica_at: null, recibido_erp_at: null };
const enLaSala   = { ...enRuta, llegada_fisica_at: '2026-09-02T16:00:00Z' };
const yaRecibido = { ...enLaSala, recibido_erp_at: '2026-09-02T17:00:00Z' };

describe('necesitaAtencion', () => {
    it('sin fila no afirma nada', () => {
        expect(necesitaAtencion(null)).toBe(false);
        expect(necesitaAtencion(undefined, { sinResolver: 5 })).toBe(false);
    });

    it('las cajas están en la sala y nadie terminó de contarlas', () => {
        expect(necesitaAtencion(enLaSala, { sinResolver: 0 })).toBe(true);
    });

    it('todavía en ruta NO sube', () => {
        // Nadie puede hacer nada con él, y subirlo dejaría media lista «arriba».
        expect(necesitaAtencion(enRuta, { sinResolver: 0 })).toBe(false);
    });

    it('recibido y sin diferencias vivas, no pide nada', () => {
        expect(necesitaAtencion(yaRecibido, { sinResolver: 0 })).toBe(false);
    });

    it('una diferencia sin resolver sube aunque el pedido ya se recibió', () => {
        // El caso que pidió el usuario: el problema no se entierra por la fecha.
        expect(necesitaAtencion(yaRecibido, { sinResolver: 1 })).toBe(true);
    });

    it('sin stats no inventa una diferencia', () => {
        expect(necesitaAtencion(yaRecibido)).toBe(false);
        expect(necesitaAtencion(yaRecibido, {})).toBe(false);
    });
});
