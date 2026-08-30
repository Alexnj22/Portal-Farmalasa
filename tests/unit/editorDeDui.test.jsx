import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import EditorDeDocumento from '../../src/components/common/EditorDeDocumento';
import { DOCS, avisosDeFoto, sePuedeGuardar } from '../../src/utils/fotoDocumento';
import { acabadoPorDefecto, acabadosDe } from '../../src/utils/tratamientoDeFoto';

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

/* ⚠️ Desde la reestructuración del 2026-08-29 los acabados viven en el PASO 2,
 * después de confirmar el encuadre: la tira de miniaturas no existe mientras se
 * marcan las esquinas. Así que lo que se prueba acá es el CATÁLOGO —quién ofrece
 * qué— y no lo que hay pintado al abrir. La regla es la misma; lo que cambió es
 * dónde se ve.
 *
 * Probarlo sobre la pantalla del paso 1 daría verde por el motivo equivocado:
 * ahí no hay ningún acabado, ni el prohibido ni los otros. */
describe('el editor con tipo="dui"', () => {
    it('NO ofrece «Aclarada» — y la receta sí, que es cómo se sabe que la prueba mira', () => {
        const delDui = acabadosDe(DOCS.dui).map(a => a.label);
        expect(delDui).not.toContain('Aclarada');

        const deLaReceta = acabadosDe(DOCS.receta).map(a => a.label);
        expect(deLaReceta).toContain('Aclarada');
    });

    /* Que no se aclare NO significa que se quede sin tratamiento, y ésa era la
     * versión anterior de esta prueba: exigía que el DUI no ofreciera NINGÚN
     * modo. Con eso, la foto de un teléfono —lavada, amarillenta y blanda— se
     * guardaba tal cual. «Nítida» es la que se hizo para él: equilibra el
     * blanco, levanta el negro y enfoca, sin descartar color. */
    it('pero SÍ ofrece «Nítida», y arranca en ella', () => {
        const delDui = acabadosDe(DOCS.dui).map(a => a.label);
        expect(delDui).toContain('Nítida');
        expect(delDui).toContain('Como está');
        expect(acabadoPorDefecto(DOCS.dui)).toBe('nitida');
    });

    /* ── El COLOR es el defecto, y para TODOS ────────────────────────────────
     *
     * Hasta el 2026-08-29 el acabado inicial de cualquier documento que no fuera
     * un DUI era «Aclarada», que lleva todo a gris: el portal decidía por su
     * cuenta tirar el color de cada foto adjunta. «No hay color en las fotos»
     * (usuario). Medido en Chromium sobre una foto con un sello azul: con
     * «Nítida» la cromaticidad media es 23.97 y con «Aclarada» es 0. */
    it('y NINGÚN documento arranca en gris — el color es el defecto', () => {
        for (const clave of Object.keys(DOCS)) {
            expect(acabadoPorDefecto(DOCS[clave])).not.toBe('aclarada');
        }
    });

    it('se presenta como lo que es: una tarjeta, no una hoja', () => {
        render(<EditorDeDocumento tipo="dui" file={unArchivo()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('Recortar el documento')).toBeTruthy();
        expect(screen.getByText(/sólo la tarjeta/i)).toBeTruthy();
    });
});

describe('la ficha del DUI en DOCS', () => {
    /* Ya no declara proporción, y eso es la corrección y no una pérdida.
     *
     * Un DUI es ID-1 (85.60 × 53.98 mm) y esa constante servía para que el
     * recuadro de proporción fija cayera casi encima de la tarjeta. Desde que el
     * recorte son las cuatro esquinas, la proporción se MIDE sobre la tarjeta de
     * esta foto: darle la nominal la obligaría a una forma que la foto puede no
     * tener —una tarjeta gastada, un escaneo con un milímetro de más— y estirar
     * el resultado para que calce es deformar el documento. */
    it('ya no fija una proporción: se mide sobre la tarjeta de esta foto', () => {
        expect(DOCS.dui.aspecto).toBeUndefined();
        // Y ninguno la declara: si quedara una sola, sería la excepción que
        // vuelve a meter una forma fija por la puerta de atrás.
        for (const clave of Object.keys(DOCS)) {
            expect(DOCS[clave].aspecto).toBeUndefined();
            expect(DOCS[clave].formas).toBeUndefined();
        }
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

/* ── Girar la imagen NO voltea el recuadro ───────────────────────────────────
 *
 * Esto no se puede medir en jsdom —`react-easy-crop` necesita layout real— así
 * que se ancla la ESCRITURA, con el motivo al lado. La medición de verdad se
 * hizo en Chromium: el recuadro se queda en 1.59 mientras la imagen rota 0°,
 * 90° y 180°.
 *
 * Lo que había volteaba el recuadro junto con la imagen, y eso hace que la
 * orientación del papel RESPECTO DEL RECUADRO no cambie nunca: los dos rotan
 * juntos y el botón deja de servir para lo único que sirve. Con una tarjeta
 * fotografiada de lado —como sale al apoyarla en un escritorio— no había forma
 * de encuadrarla, ni antes ni después de girar.
 */
/* ── Girar el resultado NO gira la foto ──────────────────────────────────────
 *
 * El recuadro de proporción fija ya no existe: el recorte son las cuatro
 * esquinas del papel. Con eso, «girar» dejó de ser rotar la imagen —que cuesta
 * una interpolación y ablanda la letra— y pasó a ser rotar el ORDEN de las
 * esquinas, o sea decir cuál es la de arriba a la izquierda.
 *
 * Lo que hay que vigilar es la consecuencia: `rectificar` reordena las esquinas
 * por su cuenta, así que si el editor no le dice que YA vienen ordenadas, el
 * giro se deshace en silencio y el botón deja de hacer nada.
 */
describe('el giro sale del orden de las esquinas', () => {
    const fuente = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/EditorDeDocumento.jsx'), 'utf8');
    // Sin comentarios: el archivo EXPLICA en prosa lo que se quitó, y buscarlo
    // sobre el texto crudo lo encuentra ahí. Mismo error que ya costó una prueba
    // en `capturaDeFoto`.
    const codigo = fuente.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');

    /* Desde el 2026-08-29 el giro es un CONTADOR y no una permutación de los
     * puntos: el orden también lo cambia la mano al arrastrar una manija sobre
     * otra, y mezclando las dos cosas el documento salía acostado sin que nadie
     * lo pidiera. Las esquinas se ordenan solas y el giro pedido se aplica
     * encima — la imagen sigue sin rotarse, que es lo que esta prueba cuida. */
    it('el botón de girar cuenta cuartos, no rota la imagen', () => {
        expect(codigo).toMatch(/setCuartos\(c => \(c \+ 1\) % 4\)/);
        expect(codigo).toMatch(/ordenarEsquinas\(puntos\)/);
        expect(codigo).not.toMatch(/setPuntos\(girarEsquinas\)/);
    });

    it('y el enderezado respeta ese orden', () => {
        // Vive en la tubería compartida desde que el camino automático y el
        // editor tienen que producir el mismo archivo.
        const componer = fs.readFileSync(
            path.join(process.cwd(), 'src/utils/componerDocumento.js'), 'utf8');
        expect(componer).toMatch(/yaOrdenadas:\s*true/);
    });

    it('ya no queda ningún recuadro de proporción fija', () => {
        expect(codigo).not.toMatch(/aspectoBase/);
    });
});
