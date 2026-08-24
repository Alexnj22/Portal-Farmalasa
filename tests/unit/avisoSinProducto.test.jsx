// «De este total, tanto no es venta de productos».
//
// Bajo los códigos administrativos 100 y 1000 entran cobros que no son venta de
// mostrador: la comisión del corresponsal bancario, el apoyo promocional de un
// laboratorio, las dietas de reunión. Desde v2.699.0 **no cuentan para la
// meta**, pero las pantallas de hora y de día siguen mostrando la venta entera
// —y con razón: la factura existió y el corte tiene que cuadrar contra ella—.
//
// Sin este aviso ese número miente sobre el trabajo: un cobro de $428 a las
// 10:17 inventa una hora pico que nadie atendió.
//
// Se prueba lo que decide si aparece y qué dice, porque las dos cosas fallan en
// silencio: de más es ruido en la pantalla de todos los días, y de menos deja
// una cifra que se lee mal en CUATRO pantallas.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AvisoSinProducto from '../../src/components/common/AvisoSinProducto';

const datos = (o = {}) => ({ total: 428.5, facturas: 2, detalle: [], ...o });

describe('cuándo NO aparece', () => {
    it('sin permiso: el servidor manda null y acá no se pinta nada', () => {
        // `get_ventas_sin_producto` corta antes de leer un monto, así que el
        // nulo YA es la negativa. Acá alcanza con no pintar.
        const { container } = render(<AvisoSinProducto datos={null} />);
        expect(container.innerHTML).toBe('');
    });

    it('sin un solo cobro: un aviso que dice «cero» es ruido', () => {
        for (const d of [datos({ facturas: 0 }), datos({ total: 0 }), datos({ total: -5 })]) {
            const { container } = render(<AvisoSinProducto datos={d} />);
            expect(container.innerHTML).toBe('');
        }
    });
});

describe('qué dice cuando aparece', () => {
    it('el monto con formato y la cantidad de cobros', () => {
        render(<AvisoSinProducto datos={datos()} contexto="Este día" />);
        expect(screen.getByText(/\$428\.50/)).toBeTruthy();
        expect(screen.getByText(/2 cobros/)).toBeTruthy();
        expect(screen.getByText(/no cuentan para la meta/i)).toBeTruthy();
    });

    it('«cobro» en singular cuando es uno solo', () => {
        render(<AvisoSinProducto datos={datos({ facturas: 1 })} />);
        expect(screen.getByText(/1 cobro\b/)).toBeTruthy();
        expect(screen.queryByText(/1 cobros/)).toBeNull();
    });

    it('el contexto es de quien lo usa: aparece en cuatro pantallas distintas', () => {
        render(<AvisoSinProducto datos={datos()} contexto="Agosto" />);
        expect(screen.getByText(/Agosto/)).toBeTruthy();
    });

    it('acepta los DOS nombres de campo que le llegan', () => {
        // Las cuatro pantallas no le mandan la misma forma: unas traen `total`
        // y otras `no_producto`. Si sólo entendiera una, el aviso desaparecería
        // en la mitad de los sitios sin que nada falle.
        render(<AvisoSinProducto datos={{ no_producto: 100, no_producto_facturas: 3 }} />);
        expect(screen.getByText(/\$100\.00/)).toBeTruthy();
        expect(screen.getByText(/3 cobros/)).toBeTruthy();
    });
});

describe('el detalle: quién fue, y sólo si se pide', () => {
    const conDetalle = datos({ detalle: [
        { invoice_id: 1, cliente: 'BANCO PROMERICA, S.A.', motivo: 'Comisión', fecha: '2026-08-12', hora: '10:17', total: 300 },
        { invoice_id: 2, cliente: 'LABORATORIOS VIJOSA, S.A. DE C.V.', fecha: '2026-08-13', total: 128.5 },
    ] });

    it('los nombres NO están en la frase: son seis líneas de texto en 390px', () => {
        // Reportado probando en el teléfono. Las razones sociales completas son
        // largas por naturaleza y este aviso vive ARRIBA de la cifra en cuatro
        // pantallas, o sea que su alto se paga en todas.
        render(<AvisoSinProducto datos={conDetalle} />);
        expect(screen.queryByText(/BANCO PROMERICA/)).toBeNull();
    });

    it('se abren con «Ver cuáles» y se cierran', () => {
        render(<AvisoSinProducto datos={conDetalle} />);
        const boton = screen.getByRole('button', { name: /ver cuáles/i });
        expect(boton.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(boton);
        expect(screen.getByText(/BANCO PROMERICA/)).toBeTruthy();
        expect(screen.getByText(/LABORATORIOS VIJOSA/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /ocultar/i }).getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: /ocultar/i }));
        expect(screen.queryByText(/BANCO PROMERICA/)).toBeNull();
    });

    it('sin detalle no hay botón que abrir', () => {
        render(<AvisoSinProducto datos={datos({ detalle: [] })} />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('el motivo es opcional y su ausencia no deja un separador suelto', () => {
        render(<AvisoSinProducto datos={conDetalle} />);
        fireEvent.click(screen.getByRole('button'));
        const fila = screen.getByText(/LABORATORIOS VIJOSA/).closest('li');
        expect(fila.textContent).not.toMatch(/·\s*$/);
        expect(fila.textContent).toContain('$128.50');
    });

    it('el botón tiene alto mínimo de dedo y acusa el toque', () => {
        // Medía 85×15 —menos de la mitad del blanco de dedo por los dos lados—
        // y sin `active:` el toque no acusaba recibo: donde no hay cursor, ése
        // es el único signo de que entró. Lo encontró el barrido ACOSTADO.
        render(<AvisoSinProducto datos={conDetalle} />);
        const cls = screen.getByRole('button').className;
        expect(cls).toContain('min-h-[var(--tap-min)]');
        expect(cls).toContain('active:scale-[0.97]');
    });
});
