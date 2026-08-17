import { describe, it, expect } from 'vitest';
import { pasaCorteDeTraslados, modoInicialDeTraslados, SALA_QUE_SURTE,
         TIPO_TRASLADO, MODOS_TRASLADO }
    from '../../src/views/solicitudes/corteTraslados.js';

/* El corte de traslados del centro de solicitudes.
 *
 * Se prueba porque es lógica que se invierte sin hacer ruido: cruzados `SIN` y
 * `SOLO`, las dos pantallas siguen mostrando solicitudes —sólo que las de al
 * lado— y no hay error que mirar. Es el mismo tipo de fallo mudo que dejó la
 * bandeja de Talento Humano en cero durante meses. */

const OTRO = 'INVENTORY_DISCARD_REQUEST';

describe('corte de traslados', () => {
    it('de arranque esconde los traslados y deja pasar el resto', () => {
        expect(pasaCorteDeTraslados(TIPO_TRASLADO, 'SIN')).toBe(false);
        expect(pasaCorteDeTraslados(OTRO,          'SIN')).toBe(true);
    });

    it('«todo» no recorta nada', () => {
        expect(pasaCorteDeTraslados(TIPO_TRASLADO, 'TODAS')).toBe(true);
        expect(pasaCorteDeTraslados(OTRO,          'TODAS')).toBe(true);
    });

    it('«sólo traslados» es exactamente el complemento del arranque', () => {
        expect(pasaCorteDeTraslados(TIPO_TRASLADO, 'SOLO')).toBe(true);
        expect(pasaCorteDeTraslados(OTRO,          'SOLO')).toBe(false);
    });

    // La propiedad que de verdad importa, y la que se rompe al cruzar los dos
    // modos: entre `SIN` y `SOLO` tiene que estar TODO y nada dos veces.
    it('SIN y SOLO parten el universo sin huecos ni repetidos', () => {
        for (const tipo of [TIPO_TRASLADO, OTRO, 'VACATION', 'ANNULMENT_REQUEST']) {
            const enSin  = pasaCorteDeTraslados(tipo, 'SIN');
            const enSolo = pasaCorteDeTraslados(tipo, 'SOLO');
            expect(enSin || enSolo).toBe(true);      // sin huecos
            expect(enSin && enSolo).toBe(false);     // sin repetidos
        }
    });

    it('en el ámbito de personas no recorta: un traslado no es asunto de nadie ahí', () => {
        for (const modo of MODOS_TRASLADO) {
            expect(pasaCorteDeTraslados(TIPO_TRASLADO, modo, false)).toBe(true);
            expect(pasaCorteDeTraslados(OTRO,          modo, false)).toBe(true);
        }
    });

    // Falla segura: un modo que nadie definió esconde de más, no de menos. Una
    // bandeja incompleta se nota; una que muestra lo que no debía, no.
    it('un modo desconocido se comporta como el arranque', () => {
        expect(pasaCorteDeTraslados(TIPO_TRASLADO, undefined)).toBe(false);
        expect(pasaCorteDeTraslados(OTRO,          'CUALQUIERA')).toBe(true);
    });
});

describe('con qué estado arranca la pantalla', () => {
    it('la sala que surte los ve de entrada: son SU trabajo, no trabajo ajeno', () => {
        expect(modoInicialDeTraslados(SALA_QUE_SURTE)).toBe('TODAS');
        // El id viaja como texto desde varios lados (metadata, params); no debe
        // cambiar la respuesta.
        expect(modoInicialDeTraslados(String(SALA_QUE_SURTE))).toBe('TODAS');
    });

    it('«TODAS» y no «SOLO»: a la sala que surte no se le esconden sus propias cargas', () => {
        const modo = modoInicialDeTraslados(SALA_QUE_SURTE);
        expect(pasaCorteDeTraslados(OTRO, modo)).toBe(true);
        expect(pasaCorteDeTraslados(TIPO_TRASLADO, modo)).toBe(true);
    });

    it('el resto de las salas arranca sin traslados', () => {
        for (const sala of [2, 4, 25, 27, 28, 29, 32]) {
            expect(modoInicialDeTraslados(sala)).toBe('SIN');
        }
        // Sin sala conocida tampoco: el arranque parejo es el que pidió el
        // usuario, y la excepción es sólo para quien surte.
        expect(modoInicialDeTraslados(null)).toBe('SIN');
        expect(modoInicialDeTraslados(undefined)).toBe('SIN');
    });
});
