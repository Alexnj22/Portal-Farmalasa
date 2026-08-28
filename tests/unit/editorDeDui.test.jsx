import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EditorDeDocumento from '../../src/components/common/EditorDeDocumento';
import { DOCS, avisosDeFoto, sePuedeGuardar } from '../../src/utils/fotoDocumento';

/**
 * ── El DUI se recorta, pero NO se aclara ─────────────────────────────────────
 *
 * «Aclarada» sube el contraste hasta dejar papel blanco y tinta negra. Sobre una
 * receta eso es lo que la hace legible; sobre un DUI **quema la fotografía de la
 * persona y los fondos de seguridad a color**, que es justo lo que el lector
 * necesita ver.
 *
 * El defecto que esto ancla no daría ningún error: la foto se subiría, el lector
 * contestaría con menos campos, y se leería como que el lector falló.
 *
 * Cada prueba de «no está» viene con su gemela **fabricando la regresión**: la
 * receta SÍ tiene el control. Sin ese par, un `queryByText` que no encuentra
 * nada no distingue «lo escondí bien» de «el diálogo no se abrió».
 */

// `react-easy-crop` mide el nodo con ResizeObserver, que jsdom no trae.
beforeEach(() => {
    globalThis.ResizeObserver ??= class {
        observe() {} unobserve() {} disconnect() {}
    };
    globalThis.URL.createObjectURL ??= () => 'blob:prueba';
    globalThis.URL.revokeObjectURL ??= () => {};
});

const unArchivo = () => new File([new Uint8Array([1, 2, 3])], 'dui.jpg', { type: 'image/jpeg' });

describe('el editor con tipo="dui"', () => {
    it('NO ofrece «Aclarada» — y la receta sí, que es cómo se sabe que la prueba mira', () => {
        const { unmount } = render(
            <EditorDeDocumento tipo="dui" file={unArchivo()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByText('Aclarada')).toBeNull();
        expect(screen.queryByText('Como está')).toBeNull();
        unmount();

        render(<EditorDeDocumento tipo="receta" file={unArchivo()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('Aclarada')).toBeTruthy();
    });

    it('se presenta como lo que es: una tarjeta, no una hoja', () => {
        render(<EditorDeDocumento tipo="dui" file={unArchivo()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('Recortar el documento')).toBeTruthy();
        expect(screen.getByText(/sólo la tarjeta/i)).toBeTruthy();
    });
});

describe('la ficha del DUI en DOCS', () => {
    it('su recuadro es ID-1 — la norma de toda tarjeta de identidad', () => {
        // 85.60 × 53.98 mm. Es la única de las tres que NO tiene que adivinar su
        // proporción: por eso el recuadro cae casi encima de la tarjeta sola.
        expect(DOCS.dui.aspecto).toBeCloseTo(85.6 / 53.98, 4);
    });

    it('declara que no se aclara', () => {
        expect(DOCS.dui.aclarar).toBe(false);
        // Y las otras dos NO lo declaran: el default sigue siendo aclarar.
        expect(DOCS.receta.aclarar).toBeUndefined();
        expect(DOCS.boleta.aclarar).toBeUndefined();
    });
});

describe('los avisos no mandan a apretar lo que no existe', () => {
    // Una tarjeta oscura. Para la receta el consejo correcto es «usá Aclarada»;
    // para el DUI ese control no está en la pantalla, así que el consejo sería
    // peor que el silencio.
    const oscuro = { papel: 0.2, tinta: 0.5, color: 0, ancho: 1600, alto: 1000 };

    it('al DUI no le ofrece «Aclarada»', () => {
        const textos = avisosDeFoto(oscuro, 'original', DOCS.dui).map(a => a.texto).join(' ');
        expect(textos).not.toMatch(/Aclarada/);
    });

    it('a la receta sí — si no, la prueba de arriba no probaría nada', () => {
        const textos = avisosDeFoto(oscuro, 'original', DOCS.receta).map(a => a.texto).join(' ');
        expect(textos).toMatch(/Aclarada/);
    });

    it('y le habla de una TARJETA, no de una hoja', () => {
        const pocaTinta = { papel: 0.9, tinta: 0.001, color: 0, ancho: 1600, alto: 1000 };
        const texto = avisosDeFoto(pocaTinta, 'original', DOCS.dui)[0].texto;
        expect(texto).toMatch(/la tarjeta/i);
        expect(texto).not.toMatch(/la hoja/i);
    });
});

/* ── El PISO: por debajo de esto no se guarda ────────────────────────────────
 *
 * `avisosDeFoto` recomienda; `sePuedeGuardar` impide. Son dos números distintos
 * a propósito, y la distancia entre ellos es la zona donde el portal sugiere
 * pero deja pasar.
 *
 * Nació de un DUI real: la tarjeta acostada ocupando un tercio de una foto
 * vertical, el resto escritorio. Ningún aviso de tamaño saltaba porque la FOTO
 * era grande — lo chico era el documento adentro. Por eso se mide el RECORTE.
 */
describe('sePuedeGuardar', () => {
    it('deja pasar un recorte que se lee', () => {
        expect(sePuedeGuardar({ ancho: 1600, alto: 1010 }, DOCS.dui).sePuede).toBe(true);
    });

    it('BLOQUEA un recorte diminuto, y dice cuánto falta', () => {
        const r = sePuedeGuardar({ ancho: 900, alto: 380 }, DOCS.dui);
        expect(r.sePuede).toBe(false);
        expect(r.motivo).toMatch(/380 px/);
        expect(r.motivo).toMatch(/600/);
    });

    it('mide el lado CORTO, no el largo', () => {
        // Una tira larguísima y angosta no se salva por ser larga: lo que hace
        // ilegible la letra es el lado chico.
        expect(sePuedeGuardar({ ancho: 4000, alto: 300 }, DOCS.documento).sePuede).toBe(false);
    });

    it('mientras la revisión no midió, NO bloquea', () => {
        // Un botón apagado porque el portal todavía no terminó de pensar se lee
        // como roto.
        expect(sePuedeGuardar(null, DOCS.dui).sePuede).toBe(true);
        expect(sePuedeGuardar({ ancho: 0, alto: 0 }, DOCS.dui).sePuede).toBe(true);
    });
});
