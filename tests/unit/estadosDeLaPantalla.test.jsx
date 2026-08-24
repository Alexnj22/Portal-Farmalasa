// La pantalla tiene que DECIR qué está mostrando.
//
// `EmptyState` estampa `data-vacio` y `LoadingState` estampa `data-cargando`.
// No son decoración: son el único dato con el que una medición externa puede
// distinguir «no hay nada» de «todavía no cargó» de «esto se rompió».
//
// Se anclan acá porque su modo de falla es el SILENCIO. Si alguien los quita, no
// se rompe ninguna pantalla y nadie lo nota — lo que se rompe es el barrido
// móvil, que vuelve a adivinar. Y ya adivinó mal dos veces:
//
//   · contando texto: `branches` con ocho sucursales da 508 caracteres y
//     `sesiones` sin nada da 506, porque `content-visibility: auto` deja fuera
//     de `innerText` lo que el navegador no pintó;
//   · contando elementos con superficie de tarjeta: `sesiones` pinta fichas de
//     persona que no usan ese token, así que una vista CON datos quedaba por
//     debajo del corte.
//
// Las dos veces el resultado fue un cero que se leía como «está bien» y
// significaba «no llegué a mirar».

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, LoadingState } from '../../src/components/common/StateViews';
import { DataTable } from '../../src/components/common/DataTable';

describe('EmptyState dice que está vacío', () => {
    it('la versión de pantalla completa estampa data-vacio', () => {
        const { container } = render(<EmptyState title="Sin clientes" />);
        expect(container.querySelector('[data-vacio]')).not.toBeNull();
    });

    it('la versión de una línea también', () => {
        // Es la que vive DENTRO de un widget del tablero. Si sólo la grande lo
        // estampara, una baldosa vacía se contaría como una baldosa con datos.
        const { container } = render(<EmptyState linea title="Sin cotizaciones activas" />);
        expect(container.querySelector('[data-vacio]')).not.toBeNull();
    });

    it('sigue mostrando el texto: el atributo no reemplaza al mensaje', () => {
        // El atributo es para la medición; el mensaje es para la persona. Los
        // dos hacen falta y ninguno sustituye al otro.
        render(<EmptyState title="Nada en camino" subtitle="Lo que pediste y ya salió se lista acá." />);
        expect(screen.getByText('Nada en camino')).toBeTruthy();
    });
});

describe('LoadingState dice que está cargando', () => {
    it.each(['content', 'route', 'inline'])('la variante «%s» estampa data-cargando', (variant) => {
        const { container } = render(<LoadingState variant={variant} label="Cargando…" />);
        expect(container.querySelector('[data-cargando]')).not.toBeNull();
    });
});

describe('cargando y vacío son estados DISTINTOS', () => {
    it('una pantalla que carga NO se anuncia como vacía', () => {
        // Confundirlos hace que una vista lenta se cuente como medida y vacía —
        // que es la peor de las dos lecturas, porque cierra la pregunta.
        const { container } = render(<LoadingState />);
        expect(container.querySelector('[data-vacio]')).toBeNull();
        expect(container.querySelector('[data-cargando]')).not.toBeNull();
    });

    it('una pantalla vacía NO se anuncia como cargando', () => {
        const { container } = render(<EmptyState title="Sin registros" />);
        expect(container.querySelector('[data-cargando]')).toBeNull();
        expect(container.querySelector('[data-vacio]')).not.toBeNull();
    });
});

describe('DataTable también dice cuándo está vacía', () => {
    // La mayoría de las vistas NO arman su vacío a mano: se lo pasan a
    // `DataTable` por la prop `empty`. Medido el 2026-08-24, con la marca sólo en
    // `EmptyState` el barrido veía mudas a diecisiete rutas que están bien y sí
    // dicen que no hay nada — Clientes, Cotizaciones, Libros de IVA y catorce
    // más. Una marca que cubre el camino menos transitado no cubre nada.
    it('la tabla sin filas estampa data-vacio', () => {
        const { container } = render(
            <DataTable columns={[{ key: 'a', label: 'A' }]}
                       empty={{ message: 'Sin clientes' }}>{[]}</DataTable>);
        expect(container.querySelector('[data-vacio]')).not.toBeNull();
    });

    it('con filas NO lo estampa', () => {
        const { container } = render(
            <DataTable columns={[{ key: 'a', label: 'A' }]}
                       empty={{ message: 'Sin clientes' }}>
                <tr><td>hay una fila</td></tr>
            </DataTable>);
        expect(container.querySelector('[data-vacio]')).toBeNull();
    });
});
