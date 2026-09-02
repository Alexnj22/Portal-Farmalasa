// Un corte que no contó el efectivo se DESCARTA, y por eso tiene botón.
//
// ── El caso ─────────────────────────────────────────────────────────────────
// Salud 4, 2-sep 13:09 (corte 14393). El comprobante decía «EFECTIVO $: 0.00 ·
// EXACTO FELICIDADES» sobre una caja que esperaba $319.10, y v2.953.1 hizo lo
// correcto: dejó de anunciar un faltante inventado de $319.10 y de ofrecer
// cobrárselo a alguien.
//
// Pero el mismo criterio que quitó la cifra falsa apagó también los BOTONES, y
// nadie ató las dos cosas. El resultado fue una pantalla que decía «lo que
// corresponde es descartarlo» con el pie vacío, y —como los cortes del día se
// suman— el corte de las 15:02 tampoco se podía confirmar: «Antes hay que
// resolver el corte de las 13:09», sobre uno que no se podía resolver.
//
// Dos frenos correctos que juntos no dejaban puerta. No falló ningún gate: el
// texto y el pie se leen en la misma pantalla y ninguno de los dos está mal por
// separado.
//
// Se prueba el pie —quién tiene botón y cuál— porque es la mitad que no se
// puede deducir de la lógica: `noContoEfectivo` seguía devolviendo lo mismo.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TarjetaCorte from '../../src/components/cortes/TarjetaCorte';

const SIN_CONTEO = {
    id: 669, tipo: 'C', estado: 'PENDIENTE', hora: '13:09:48',
    empleado_texto: 'EDWIN NUÑEZ',
    total_declarado: 0, diferencia_erp: 0,
    tk_subtotal: 280.85, tk_vales: 50, tk_total_caja: 230.85,
    cobros_portal_efectivo: 88.25,
    tramo: null, acumulado: null,
};

const NORMAL = {
    ...SIN_CONTEO, id: 677, hora: '15:02:42', empleado_texto: 'AUDELIA CALLEJAS',
    total_declarado: 386.97, diferencia_erp: 88.25, tk_total_caja: 298.72,
    tramo: 0, acumulado: 0,
};

const pintar = (corte) => render(
    <TarjetaCorte corte={corte} sala="Salud 4" puedeResolver
        onAbrir={vi.fn()} onConfirmar={vi.fn()} />,
);

describe('la tarjeta de un corte sin conteo', () => {
    it('ofrece Descartar: es la única salida, y sin ella traba el día entero', () => {
        pintar(SIN_CONTEO);
        expect(screen.getByRole('button', { name: /descartar/i })).toBeTruthy();
    });

    it('NO ofrece Confirmar: no hay conteo que dar por bueno', () => {
        pintar(SIN_CONTEO);
        expect(screen.queryByRole('button', { name: /^confirmar$/i })).toBe(null);
    });

    it('no pinta una cifra: `$0.00` sobre un tramo nulo se lee «cuadró exacto»', () => {
        const { container } = pintar(SIN_CONTEO);
        expect(container.textContent).toContain('sin conteo');
        expect(container.textContent).not.toContain('$0.00');
    });

    it('lo dice con una etiqueta, para que se sepa por qué le falta la cifra', () => {
        const { container } = pintar(SIN_CONTEO);
        expect(container.textContent).toContain('Sin conteo');
    });
});

describe('un corte que sí contó no cambia', () => {
    it('sigue teniendo las dos decisiones', () => {
        pintar(NORMAL);
        expect(screen.getByRole('button', { name: /descartar/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^confirmar$/i })).toBeTruthy();
    });
});
