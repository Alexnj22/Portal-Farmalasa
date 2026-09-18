import { describe, it, expect } from 'vitest';
import { necesitaAtencion, faltantesDeLaSala, describirFaltantes } from '../../src/views/pedidos/tabpedidos/helpers';

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

/**
 * Lo que no llegó. Pedido #178 de Salud 4 (17-sep-2026): con una caja especial
 * sin llegar, la sala ya había contado lo demás y la tarjeta quedaba
 * «Completado», abajo de todo y sin decir qué faltaba.
 */
describe('faltantesDeLaSala', () => {
    const salud4 = {
        ...yaRecibido,
        falta_cajas: [],
        electrolit_ok: null,
        electrolit_faltantes: null,
        cajas_especiales: [
            { label: 'E1', product_name: 'ELECTROLIT COCO 625ML',    pedido_item_id: 105088 },
            { label: 'E2', product_name: 'ELECTROLIT MANZANA 625ML', pedido_item_id: 104956 },
            { label: 'E3', product_name: 'ELECTROLIT UVA 625ML',     pedido_item_id: 105104 },
        ],
        cajas_especiales_llegadas: { E1: 'ok', E2: 'faltante', E3: 'ok' },
        reenvios_historial: [],
    };

    it('la caja especial que falta sale con su producto', () => {
        const f = faltantesDeLaSala(salud4);
        expect(f.hay).toBe(true);
        expect(f.enCamino).toBe(false);
        expect(f.especiales).toEqual([{ label: 'E2', producto: 'ELECTROLIT MANZANA 625ML' }]);
        expect(describirFaltantes(f)).toEqual(['E2 · ELECTROLIT MANZANA 625ML']);
    });

    it('las tres clases de faltante se dicen juntas', () => {
        const f = faltantesDeLaSala({ ...salud4, falta_cajas: [3, 5], electrolit_faltantes: 2, electrolit_ok: false });
        expect(describirFaltantes(f)).toEqual(['Cajas #3, #5', '2 Electrolit', 'E2 · ELECTROLIT MANZANA 625ML']);
    });

    it('Electrolit ya confirmado no cuenta aunque quede el número', () => {
        expect(faltantesDeLaSala({ electrolit_faltantes: 3, electrolit_ok: true }).electrolits).toBe(0);
    });

    it('los defaults de la base son objetos vacíos, no arreglos', () => {
        // `cajas_especiales` y `cajas_especiales_llegadas` nacen en `'{}'::jsonb`.
        const f = faltantesDeLaSala({ cajas_especiales: {}, cajas_especiales_llegadas: {}, falta_cajas: null });
        expect(f.hay).toBe(false);
        expect(faltantesDeLaSala(null).hay).toBe(false);
    });

    it('una etiqueta sin su renglón en la lista se nombra igual, sin producto', () => {
        const f = faltantesDeLaSala({ ...salud4, cajas_especiales: [] });
        expect(describirFaltantes(f)).toEqual(['E2']);
    });

    it('reenviado y sin confirmar va en camino', () => {
        const f = faltantesDeLaSala({ ...salud4, reenvios_historial: [{ ciclo: 1, sent_at: '2026-09-17T18:00:00Z', arrived_at: null }] });
        expect(f.hay).toBe(true);
        expect(f.enCamino).toBe(true);
    });

    it('recibido con una caja sin llegar SUBE; ya reenviada, no', () => {
        expect(necesitaAtencion(salud4, { sinResolver: 0 })).toBe(true);
        const reenviado = { ...salud4, reenvios_historial: [{ ciclo: 1, sent_at: '2026-09-17T18:00:00Z', arrived_at: null }] };
        expect(necesitaAtencion(reenviado, { sinResolver: 0 })).toBe(false);
    });
});
