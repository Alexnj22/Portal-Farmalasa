// El envío tiene una dirección, y es lo único que lo separa de una solicitud.
//
// Pedido del usuario el 2026-08-24, preguntándose cómo evitar que las salas
// usaran el envío en vez de la solicitud:
//
//   «el fin de poder hacer traslados es: 1. enviar productos a bodega por corto
//    vencimiento o baja rotacion. 2. enviar productos a una sucursal por baja
//    rotacion. 3. enviar productos nuevos desde bodega. y ya.»
//   «solo bodega puede enviar a sucursales.»
//
// El modo de falla que esto vigila es MUDO en las dos direcciones:
//
//   1. **Aflojar la regla no rompe nada.** Un motivo de más —o la dirección
//      abierta— no produce ningún error: produce envíos que nadie pidió, y eso
//      se descubre semanas después y en la sala que los recibe. Que era
//      exactamente el estado del 22-ago: cinco motivos, dos de ellos
//      («Lo pidieron», «Otro») capaces de justificar cualquier cosa.
//   2. **Apretarla de más tampoco.** Si esta lista y la de la base se
//      desincronizan, la pantalla ofrece un motivo que el servidor rebota al
//      apretar «Transferir», con la caja ya armada. Por eso la pregunta se hace
//      ANTES de ofrecer y no después de mandar.
//
// La que MANDA es `validar_envio_producto` en la base. Esto ancla el espejo.

import { describe, it, expect } from 'vitest';
import {
    ERP_BODEGA, MOTIVOS_ENVIO, motivosEnvioPorDestino, direccionValida,
} from '../../src/data/envios';

const SALAS = [1, 2, 3, 4, 5, 7];   // todas menos Bodega

describe('los motivos del envío', () => {
    it('son TRES: uno por cada uso, y ninguno abierto', () => {
        expect(MOTIVOS_ENVIO).toEqual(['Próximo a vencer', 'Baja rotación', 'Producto nuevo']);
    });

    it('ya no ofrece las dos etiquetas con las que se mandaba cualquier cosa', () => {
        // «Lo pidieron» tiene camino propio —la solicitud— y «Otro» era la
        // puerta de todo lo demás. «Sobrestock» nombra lo mismo que «Baja
        // rotación», y dos nombres para una cosa terminan divergiendo.
        for (const muerto of ['Lo pidieron', 'Otro', 'Sobrestock']) {
            expect(MOTIVOS_ENVIO).not.toContain(muerto);
        }
    });

    it('ninguno vale en las dos direcciones', () => {
        const haciaBodega = motivosEnvioPorDestino(true);
        const haciaSala   = motivosEnvioPorDestino(false);
        // «Producto nuevo» sólo sale de Bodega; «Próximo a vencer» sólo llega.
        expect(haciaBodega).toEqual(['Próximo a vencer', 'Baja rotación']);
        expect(haciaSala).toEqual(['Producto nuevo', 'Baja rotación']);
        expect(haciaBodega).not.toContain('Producto nuevo');
        expect(haciaSala).not.toContain('Próximo a vencer');
    });

    it('y entre las dos direcciones cubren los tres, sin inventar ninguno', () => {
        const union = new Set([...motivosEnvioPorDestino(true), ...motivosEnvioPorDestino(false)]);
        expect([...union].sort()).toEqual([...MOTIVOS_ENVIO].sort());
    });
});

describe('la dirección: sólo Bodega le manda a una sala', () => {
    it('una sala le manda a Bodega', () => {
        for (const sala of SALAS) expect(direccionValida(sala, ERP_BODEGA)).toBe(true);
    });

    it('Bodega le manda a cualquier sala', () => {
        for (const sala of SALAS) expect(direccionValida(ERP_BODEGA, sala)).toBe(true);
    });

    it('una sala NO le manda a otra sala — eso se pide', () => {
        // Las 30 combinaciones, no una de muestra: el defecto que esto caza es
        // que alguien abra un par suelto y el resto siga cerrado.
        for (const origen of SALAS) {
            for (const destino of SALAS) {
                if (origen === destino) continue;
                expect(direccionValida(origen, destino)).toBe(false);
            }
        }
    });

    it('no le importa si el número llega como texto', () => {
        // El destino sale de un <select>, así que viaja como cadena. Una
        // comparación estricta lo daría por inválido y el envío legítimo
        // rebotaría sin explicación.
        expect(direccionValida('1', String(ERP_BODEGA))).toBe(true);
        expect(direccionValida(String(ERP_BODEGA), '3')).toBe(true);
        expect(direccionValida('1', '3')).toBe(false);
    });
});
