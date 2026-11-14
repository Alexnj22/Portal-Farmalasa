import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import FormularioEncuesta from '../../src/views/encuestas-clientes/FormularioEncuesta';

/**
 * Las tres preguntas de puntaje de la «Encuesta de satisfacción» (nov. 2026)
 * se pintan IGUAL (2026-11-14). La de recomendación iba con semáforo y filas
 * 0–6 / 7–10, satisfacción y confianza en gris con filas 1–5 / 6–10, y en la
 * entrevista parecía que se puntuaban distinto: un cliente con satisfacción 10
 * quedó anotado con recomendación 3.
 */
const op = (n) => ({ id: 'v' + n, texto: String(n) });
const diez = Array.from({ length: 10 }, (_, i) => op(i + 1));
const encuesta = {
    id: 'x',
    cuestionario: { secciones: [{ id: 's1', titulo: 'Todo', preguntas: [
        { id: 'satisfaccion', tipo: 'unica', texto: 'Del 1 al 10, ¿qué tan satisfecho está?', ayuda: '1 = nada satisfecho · 10 = muy satisfecho', opciones: diez, obligatoria: true },
        { id: 'confianza', tipo: 'unica', texto: 'Del 1 al 10, ¿qué tanta confianza tiene?', ayuda: '1 = ninguna confianza · 10 = total confianza', opciones: diez, obligatoria: true },
        { id: 'nps', tipo: 'nps', texto: '¿Qué tan probable es que nos recomiende?', obligatoria: true },
    ] }] },
};

describe('las escalas de la encuesta se ven iguales', () => {
    it('misma cuadrícula, mismo color al marcar, puntas rotuladas en las tres', () => {
        const { container } = render(<FormularioEncuesta encuesta={encuesta} entrevista />);
        const preguntas = [...container.querySelectorAll('fieldset')];
        expect(preguntas).toHaveLength(3);
        const rejillas = preguntas.map((f) => f.querySelector('div.grid'));
        // En el teléfono, la segunda fila empieza en el 6 en las tres.
        expect(rejillas[0].className).toContain('grid-cols-5');
        expect(rejillas[1].className).toContain('grid-cols-5');
        expect(rejillas[2].className).toContain('grid-cols-6');
        expect(rejillas[2].children[6].textContent).toBe('6');
        expect(rejillas[0].children[5].textContent).toBe('6');
        // Puntas visibles en las tres.
        expect(preguntas[0].textContent).toContain('1 = nada satisfecho');
        expect(preguntas[2].textContent).toContain('0 = nada probable');
        expect(preguntas[2].textContent).toContain('10 = muy probable');
        // Sin semáforo: marcar el 3 de recomendación usa el color de la marca,
        // igual que marcar el 3 de satisfacción.
        fireEvent.click(rejillas[0].children[2]);
        fireEvent.click(rejillas[2].children[3]);
        const marcadoSat = rejillas[0].children[2];
        const marcadoNps = rejillas[2].children[3];
        expect(marcadoNps.getAttribute('aria-pressed')).toBe('true');
        expect(marcadoNps.className).toContain('bg-brand');
        expect(marcadoNps.className).not.toMatch(/danger|warning|success/);
        expect(marcadoNps.className).toBe(marcadoSat.className);
        expect(preguntas[2].textContent).toContain('Marcó 3 de 10');
        expect(container.textContent).not.toMatch(/poco probable/i);
    });
});
