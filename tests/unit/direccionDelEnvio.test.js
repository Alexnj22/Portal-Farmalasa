// El envío tiene UNA regla, y es el motivo. La dirección sale de ella.
//
// Cuatro correcciones del usuario el mismo día (2026-08-24) terminaron acá, y
// vale la pena tenerlas a la vista porque cada una reescribe a las anteriores:
//
//   1. «el fin de poder hacer traslados es: 1. enviar productos a bodega por
//      corto vencimiento o baja rotacion. 2. enviar productos a una sucursal
//      por baja rotacion. 3. enviar productos nuevos desde bodega. y ya.»
//   2. «bodega si debe poder mandar corto vence, de hecho, hasta tiene la
//      posibilidad de una sucursal solicitar un producto del area de vencidos.»
//   3. «pero si es por baja rotacion, si debe poder enviarse a otra sucursal.»
//   4. «agreguemos el motivo de, cuando bodega pide un producto por retiro del
//      proveedor por un error o por algo de la SRS. asi las salas lo mandan.»
//
// Y una quinta el 2026-08-26, que reescribe la fila de Bodega hacia una sala:
//
//   5. «que bodega tenga la opcion de envio de Producto por encargo. ademas las
//      opciones deben ser segun si son de las salas a bodega, o de las salas a
//      las salas o de bodega a las salas: de salas a salas es por baja rotacion
//      nada mas. de salas a bodega, es por baja rotacion o por proximos a
//      vencer. de bodega a las salas es, para impulso, producto nuevo o
//      encargo.»
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
    it('son SIETE, y ninguno abierto', () => {
        // La avería entró el 2026-08-24 con `MOTIVOS_ENVIO_CON_FOTO` y esta
        // prueba se quedó en cuatro: `main` amaneció con la suite roja, o sea
        // con el pre-commit de todas las sesiones bloqueado. El orden importa
        // —es el de la lista que se ofrece en pantalla mientras todavía no hay
        // sala de destino— y por eso se compara con `toEqual` y no con un
        // `toContain` por motivo.
        expect(MOTIVOS_ENVIO).toEqual([
            'Próximo a vencer', 'Baja rotación', 'Producto nuevo', 'Impulso', 'Encargo',
            'Retiro del mercado', 'Avería',
        ]);
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

    it('el retiro del mercado SÓLO viaja hacia Bodega', () => {
        // Un retiro se consolida en un solo lugar: hay que juntarlo, contarlo y
        // devolverlo. Repartirlo entre salas sería repartir el problema, y de
        // Bodega hacia una sala sería devolver a la venta algo que se retiró.
        // Es el motivo más cerrado de los siete, y a propósito.
        expect(A_BODEGA()).toContain('Retiro del mercado');
        expect(DE_BODEGA()).not.toContain('Retiro del mercado');
        expect(ENTRE_SALAS()).not.toContain('Retiro del mercado');
    });

    it('el reparto SÓLO sale de Bodega, y son tres formas distintas', () => {
        // Corrección 5. «Impulso» y «Encargo» se parecen a «Producto nuevo»
        // sólo por fuera: los tres salen de Bodega hacia una sala, pero uno
        // dice «llegó la compra», otro «no se vende donde está» y el tercero
        // «alguien lo pidió». Sin el tercero, el encargo viajaba disfrazado de
        // reparto y no había dónde contarlo.
        for (const m of ['Impulso', 'Encargo']) {
            expect(DE_BODEGA()).toContain(m);
            expect(A_BODEGA()).not.toContain(m);
            expect(ENTRE_SALAS()).not.toContain(m);
        }
    });

    it('«Baja rotación» ya NO vale de Bodega hacia una sala', () => {
        // Corrección 5, y es la parte que se puede perder de vista: entre salas
        // «baja rotación» quiere decir *me sobra y allá se vende*, hacia Bodega
        // *me sobra, hazte cargo*, y desde Bodega no quiere decir ninguna de
        // las dos porque Bodega no vende. Lo que hacía era nombrar el impulso
        // con la etiqueta equivocada.
        expect(DE_BODEGA()).not.toContain('Baja rotación');
        expect(A_BODEGA()).toContain('Baja rotación');
        expect(ENTRE_SALAS()).toContain('Baja rotación');
    });

    it('una composición de Bodega + una sala hacia una sala se queda SIN motivo', () => {
        // Hasta el 2026-08-26 «Baja rotación» estaba en las tres listas y esta
        // prueba anclaba lo contrario: que la intersección nunca quedara vacía.
        // Ahora queda vacía en un caso exacto —destino una sala, orígenes
        // Bodega + alguna sala— y eso es CORRECTO: lo que sale de Bodega es
        // reparto y lo que sale de una sala es sobrante, o sea dos cosas que ya
        // no se pueden decir con un solo rótulo.
        //
        // Se ancla porque el modal tiene que DECIRLO. Sin este caso escrito, la
        // pantalla se queda con un desplegable de motivos vacío y un botón
        // apagado que no explica nada — el modo de falla mudo de siempre.
        const interseccion = [DE_BODEGA(), ENTRE_SALAS()]
            .reduce((a, b) => a.filter(m => b.includes(m)));
        expect(interseccion).toEqual([]);

        // Hacia Bodega, en cambio, todos los orígenes son salas, así que no hay
        // intersección que calcular y el caso no existe.
        expect(A_BODEGA().length).toBeGreaterThan(0);
    });

    it('ninguna dirección inventa un motivo que no exista', () => {
        for (const lista of [A_BODEGA(), DE_BODEGA(), ENTRE_SALAS()]) {
            for (const m of lista) expect(MOTIVOS_ENVIO).toContain(m);
        }
    });

    it('las tres listas juntas cubren los siete motivos', () => {
        const union = new Set([...A_BODEGA(), ...DE_BODEGA(), ...ENTRE_SALAS()]);
        expect([...union].sort()).toEqual([...MOTIVOS_ENVIO].sort());
    });

    it('trata un valor ausente como «no es Bodega»', () => {
        // Los extremos salen de comparar contra ERP_BODEGA, y un renglón sin
        // sala de origen daría `undefined`. Tratarlo como Bodega abriría el
        // reparto entero por un dato que falta.
        expect(motivosEnvioPorDireccion(undefined, undefined)).toEqual(['Baja rotación']);
        expect(motivosEnvioPorDireccion(null, null)).toEqual(['Baja rotación']);
    });

    it('Bodega es la sucursal 6', () => {
        // El espejo del navegador; la que manda es `erp_sucursal_map.es_bodega`.
        expect(ERP_BODEGA).toBe(6);
    });
});
