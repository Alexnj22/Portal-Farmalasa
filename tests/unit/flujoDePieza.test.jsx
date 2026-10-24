import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import FlujoDePieza from '../../src/views/marketing/FlujoDePieza';

/**
 * El camino de una pieza de Marketing son seis pasos en una fila. En un carril
 * angosto —el teléfono de pie, o el panel lateral acostado— cada columna mide
 * ~47px y «Aprobada», «Programada» y «Publicada» no caben: una palabra no se
 * parte, así que se pisaban hasta leerse «AprobadaProgramadaPublicada»
 * (barrido en iPhone 13, 2026-10-24).
 *
 * La salida: con el carril angosto sólo se ve el rótulo del paso ACTUAL; los
 * demás quedan para el lector de pantalla. El corte es por el ancho del carril
 * (`@container`), no de la pantalla, porque acostado el viewport mide 844px y
 * el panel sigue siendo angosto.
 */
const rotulos = (estado) => [...render(<FlujoDePieza estado={estado} />).container
    .querySelectorAll('li span.text-micro')];

describe('FlujoDePieza en un carril angosto', () => {
    it('el carril es un contenedor: el corte mide su ancho, no el de la pantalla', () => {
        const { container } = render(<FlujoDePieza estado="finalizado" />);
        expect(container.querySelector('ol').className).toContain('@container');
    });

    it('sólo el paso actual conserva el rótulo visible', () => {
        const spans = rotulos('finalizado');
        expect(spans).toHaveLength(6);
        const visibles = spans.filter((s) => !s.className.includes('@max-md:sr-only'));
        expect(visibles.map((s) => s.textContent)).toEqual(['Por revisar']);
    });

    it('los demás rótulos siguen en el DOM para el lector de pantalla', () => {
        const textos = rotulos('aprobado').map((s) => s.textContent);
        expect(textos).toContain('Programada');
        expect(textos).toContain('Publicada');
    });
});
