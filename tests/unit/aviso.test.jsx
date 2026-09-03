import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import Notice from '../../src/components/common/Notice';

/**
 * Un mensaje largo NO puede salir en una píldora redondeada.
 *
 * En el tema Liquid el radio del aviso (`--btn-radius`) vale 9999px. Con un
 * renglón eso es exactamente lo buscado —se ve como los botones que tiene al
 * lado—; con dos o más, dibuja un óvalo con las esquinas comiéndose el texto.
 *
 * Se reportó DOS veces: el 2026-08-26 sobre el aviso de Bolsas («se ve fatal»)
 * y el 2026-09-03 sobre el de Mis puntos, ya como regla general. La primera vez
 * la salida fue la prop `bloque`, y una prop opt-in es una prop olvidada: se
 * olvidó en el primer aviso escrito después de crearla.
 *
 * Por eso hoy el radio lo decide el COMPONENTE cuando el contenido es texto.
 * `bloque` queda para lo que de verdad no se puede medir desde adentro —el
 * relleno de un párrafo con lista— y para el `children` de JSX.
 */

const forma = (jsx) =>
    render(jsx).container.querySelector('[data-aviso]').getAttribute('data-aviso');

const LARGO = 'No encontramos una ficha con ese documento y ese teléfono. Revisa los datos, o pregunta en cualquiera de nuestras salas.';
const CORTO = 'No encontramos ese registro. Revisa los datos.';

describe('la forma del aviso', () => {
    it('un mensaje corto sigue siendo una pildora', () => {
        expect(forma(<Notice>{CORTO}</Notice>)).toBe('pildora');
    });

    it('un mensaje largo deja de serlo, sin que nadie lo declare', () => {
        expect(forma(<Notice>{LARGO}</Notice>)).toBe('bloque');
    });

    it('el texto partido en varios hijos se mide entero', () => {
        expect(forma(<Notice>{'Demasiados intentos. '}{'Espera unos minutos y vuelve a probar por favor.'}</Notice>))
            .toBe('bloque');
    });

    it('`bloque` sigue mandando aunque el texto sea corto', () => {
        expect(forma(<Notice bloque>{CORTO}</Notice>)).toBe('bloque');
    });

    it('con JSX adentro NO se adivina: manda lo que declaro quien lo escribio', () => {
        const jsx = <Notice><strong>Ojo</strong> con esto</Notice>;
        expect(forma(jsx)).toBe('pildora');
        expect(forma(<Notice bloque><strong>Ojo</strong> con esto</Notice>)).toBe('bloque');
    });

    it('el mensaje que se reporto ya no cabe en una pildora, y el nuevo si', () => {
        expect(LARGO.length).toBeGreaterThan(56);
        expect(CORTO.length).toBeLessThanOrEqual(56);
    });
});
