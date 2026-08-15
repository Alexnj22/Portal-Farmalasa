import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LifecycleTimeline from '../../src/views/pedidos/tabpedidos/LifecycleTimeline';

// Quién apoyó la recepción se dibujaba como una pila de caras de 20px colgando
// de dos pasos: el nombre sólo vivía en el `title` —que en una tablet no
// aparece nunca— y de la cuarta persona en adelante ni se dibujaba (`slice(0,3)`
// en un sitio, `slice(0,4)` en el otro). La pregunta que lo destapó fue «¿qué
// pasa si son 4 de apoyo?». Esta prueba es la respuesta: se ven las cuatro, con
// su nombre, una sola vez.
const APOYO = [
    { id: 'e1', first_names: 'FERNANDO JOSE', last_names: 'OLIVA MARTINEZ' },
    { id: 'e2', first_names: 'DOLORES',       last_names: 'TEJADA' },
    { id: 'e3', first_names: 'ANA MARIA',     last_names: 'PEREZ LOPEZ' },
    { id: 'e4', first_names: 'LUIS',          last_names: 'GOMEZ' },
];

const ROW = {
    created_at:        '2026-08-14T17:19:00.000Z',
    iniciado_at:       '2026-08-14T17:43:00.000Z',
    finalizado_at:     '2026-08-14T18:24:00.000Z',
    enviado_at:        '2026-08-14T20:49:00.000Z',
    llegada_fisica_at: '2026-08-14T21:16:00.000Z',
    recibido_erp_at:   null,
};

describe('LifecycleTimeline — apoyo en recepción', () => {
    it('nombra a las cuatro personas de apoyo, y a cada una una sola vez', () => {
        render(<LifecycleTimeline row={ROW} stage="enviado" receptionApoyo={APOYO} />);

        // `shortEmployeeName` devuelve el texto tal como está guardado —primer
        // nombre + primer apellido, en mayúsculas porque así vive en la ficha.
        for (const nombre of ['FERNANDO OLIVA', 'DOLORES TEJADA', 'ANA PEREZ', 'LUIS GOMEZ']) {
            expect(screen.getAllByText(nombre)).toHaveLength(1);
        }
        expect(screen.getByText('Apoyo en recepción')).toBeInTheDocument();
    });

    it('sin apoyo no dibuja la fila', () => {
        render(<LifecycleTimeline row={ROW} stage="enviado" receptionApoyo={[]} />);
        expect(screen.queryByText('Apoyo en recepción')).not.toBeInTheDocument();
    });
});
