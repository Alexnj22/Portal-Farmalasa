// El envío tiene UNA regla, y es el motivo. La dirección sale de ella.
//
// Tres correcciones del usuario el mismo día (2026-08-24) terminaron acá, y
// vale la pena tener las tres a la vista porque la última reescribe a las otras:
//
//   1. «el fin de poder hacer traslados es: 1. enviar productos a bodega por
//      corto vencimiento o baja rotacion. 2. enviar productos a una sucursal
//      por baja rotacion. 3. enviar productos nuevos desde bodega. y ya.»
//   2. «bodega si debe poder mandar corto vence, de hecho, hasta tiene la
//      posibilidad de una sucursal solicitar un producto del area de vencidos.»
//   3. «pero si es por baja rotacion, si debe poder enviarse a otra sucursal.»
//
// Las dos primeras versiones pusieron el freno en la DIRECCIÓN —«sólo Bodega le
// manda a una sala»— y encima le colgaron una tabla de motivos: dos reglas para
// una sola pregunta. Por eso la tercera respuesta no entraba. No hay
// direcciones buenas y malas en sí mismas; lo que decide es el motivo.
//
// El modo de falla que esto vigila es MUDO en las dos puntas:
//
//   1. **Aflojar no rompe nada.** Un motivo de más en una dirección no produce
//      ningún error: produce envíos que nadie pidió, y eso se descubre semanas
//      después y en la sala que los recibe. Era el estado del 22-ago: cinco
//      motivos, dos de ellos («Lo pidieron», «Otro») capaces de justificar
//      cualquier cosa.
//   2. **Apretar de más tampoco.** Si esta lista y la de la base se
//      desincronizan, la pantalla ofrece un motivo que el servidor rebota al
//      apretar «Transferir», con la caja ya armada. Y la versión que apretó de
//      más se descubrió sólo porque el usuario la probó en pantalla.
//
// La que MANDA es `validar_envio_producto`. Esto ancla el espejo.

import { describe, it, expect } from 'vitest';
import { ERP_BODEGA, MOTIVOS_ENVIO, motivosEnvioPorDireccion } from '../../src/data/envios';

const A_BODEGA    = () => motivosEnvioPorDireccion(false, true);   // una sala → Bodega
const DE_BODEGA   = () => motivosEnvioPorDireccion(true,  false);  // Bodega → una sala
const ENTRE_SALAS = () => motivosEnvioPorDireccion(false, false);  // sala → sala

describe('los motivos del envío', () => {
    it('son TRES: uno por cada uso, y ninguno abierto', () => {
        expect(MOTIVOS_ENVIO).toEqual(['Próximo a vencer', 'Baja rotación', 'Producto nuevo']);
    });

    it('ya no ofrece las etiquetas con las que se mandaba cualquier cosa', () => {
        // «Lo pidieron» tiene camino propio —la solicitud— y «Otro» era la
        // puerta de todo lo demás. «Sobrestock» nombra lo mismo que «Baja
        // rotación», y dos nombres para una cosa terminan divergiendo.
        for (const muerto of ['Lo pidieron', 'Otro', 'Sobrestock']) {
            expect(MOTIVOS_ENVIO).not.toContain(muerto);
        }
    });
});

describe('la tabla de direcciones, que es la única regla', () => {
    it('entre salas SÓLO se manda lo que sobra', () => {
        // Ésta es la corrección 3, y es la que abre sala→sala. Lo que NO se
        // puede decir entre salas es «te lo mando porque lo necesitás»: eso es
        // una solicitud, donde el otro lado decide ANTES de que salga.
        expect(ENTRE_SALAS()).toEqual(['Baja rotación']);
    });

    it('«Producto nuevo» sólo sale de Bodega', () => {
        // La regla no está escrita aparte: cae de que el motivo no exista ni
        // hacia Bodega ni entre salas. Si alguien lo agrega en cualquiera de
        // las dos, esta prueba es lo único que lo dice.
        expect(DE_BODEGA()).toContain('Producto nuevo');
        expect(A_BODEGA()).not.toContain('Producto nuevo');
        expect(ENTRE_SALAS()).not.toContain('Producto nuevo');
    });

    it('el corto vence viaja con Bodega en una punta, nunca entre salas', () => {
        // Corrección 2: Bodega tiene 57 productos venciendo en 90 días y tenía
        // que rotularlos «Baja rotación» para moverlos — o sea mentir en el
        // único dato con el que después se mira el circuito.
        // Y corrección 3 al revés: entre salas no, porque ahí la pregunta no es
        // «¿a quién le sirve?» sino «¿quién se hace cargo?», y de eso se ocupa
        // Bodega.
        expect(A_BODEGA()).toContain('Próximo a vencer');
        expect(DE_BODEGA()).toContain('Próximo a vencer');
        expect(ENTRE_SALAS()).not.toContain('Próximo a vencer');
    });

    it('«Baja rotación» vale en las TRES, y de eso depende la composición', () => {
        // Una composición que saca de Bodega y de una sala a la vez sale como
        // dos envíos con el MISMO motivo, así que el modal ofrece la
        // intersección. Si «Baja rotación» dejara de estar en alguna, esa
        // intersección podría quedar vacía y el formulario no tendría motivo
        // que ofrecer — sin error y sin explicación.
        for (const lista of [A_BODEGA(), DE_BODEGA(), ENTRE_SALAS()]) {
            expect(lista).toContain('Baja rotación');
        }
        const interseccion = [A_BODEGA(), DE_BODEGA(), ENTRE_SALAS()]
            .reduce((a, b) => a.filter(m => b.includes(m)));
        expect(interseccion.length).toBeGreaterThan(0);
    });

    it('ninguna dirección inventa un motivo que no exista', () => {
        for (const lista of [A_BODEGA(), DE_BODEGA(), ENTRE_SALAS()]) {
            for (const m of lista) expect(MOTIVOS_ENVIO).toContain(m);
        }
    });

    it('las tres listas juntas cubren los tres motivos', () => {
        const union = new Set([...A_BODEGA(), ...DE_BODEGA(), ...ENTRE_SALAS()]);
        expect([...union].sort()).toEqual([...MOTIVOS_ENVIO].sort());
    });

    it('trata un valor ausente como «no es Bodega»', () => {
        // Los extremos salen de comparar contra ERP_BODEGA, y un renglón sin
        // sala de origen daría `undefined`. Tratarlo como Bodega abriría los
        // tres motivos por un dato que falta.
        expect(motivosEnvioPorDireccion(undefined, undefined)).toEqual(['Baja rotación']);
        expect(motivosEnvioPorDireccion(null, null)).toEqual(['Baja rotación']);
    });

    it('Bodega es la sucursal 6', () => {
        // El espejo del navegador; la que manda es `erp_sucursal_map.es_bodega`.
        expect(ERP_BODEGA).toBe(6);
    });
});
