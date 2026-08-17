import { describe, expect, it } from 'vitest';
import { avisosDeFoto, medirDocumento } from '../../src/utils/fotoDocumento';

// ═══════════════════════════════════════════════════════════════════════════
// Las medidas de la foto de una receta.
//
// Se arman hojas sintéticas píxel a píxel —no hace falta un navegador— y se
// comprueba que cada medida diga lo que promete. Los cortes salieron de una
// calibración con receta renderizada, ruido de sensor y JPEG; acá se ancla que
// el CÁLCULO no se mueva, que es lo que rompería esos cortes en silencio.
// ═══════════════════════════════════════════════════════════════════════════

/** Arma una hoja RGBA de `ancho`×`alto` y deja pintar encima. */
function hoja(ancho, alto, fondo = [255, 255, 255]) {
    const data = new Uint8ClampedArray(ancho * alto * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = fondo[0]; data[i + 1] = fondo[1]; data[i + 2] = fondo[2]; data[i + 3] = 255;
    }
    const pintar = (x0, y0, w, h, [r, g, b]) => {
        for (let y = y0; y < y0 + h; y++) {
            for (let x = x0; x < x0 + w; x++) {
                const i = (y * ancho + x) * 4;
                data[i] = r; data[i + 1] = g; data[i + 2] = b;
            }
        }
    };
    return { data, pintar };
}

describe('medirDocumento', () => {
    it('una hoja en blanco no tiene tinta ni color', () => {
        const { data } = hoja(200, 200);
        const d = medirDocumento(data, 200, 200);
        expect(d.papel).toBe(255);
        expect(d.tinta).toBe(0);
        expect(d.color).toBe(0);
    });

    it('cuenta como tinta lo bastante más oscuro que el papel', () => {
        const { data, pintar } = hoja(100, 100);
        pintar(0, 0, 100, 5, [20, 20, 20]);          // 5% de la hoja en negro
        const d = medirDocumento(data, 100, 100);
        expect(d.tinta).toBeCloseTo(0.05, 3);
    });

    // Es la razón por la que el umbral es relativo: con un corte fijo, una foto
    // a contraluz no tendría tinta y el aviso gritaría sobre una receta buena.
    it('sigue viendo la tinta en una foto oscura', () => {
        const { data, pintar } = hoja(100, 100, [97, 97, 97]);
        pintar(0, 0, 100, 5, [15, 15, 15]);
        const d = medirDocumento(data, 100, 100);
        expect(d.papel).toBe(97);
        expect(d.tinta).toBeCloseTo(0.05, 3);
    });

    it('la tinta negra no cuenta como color y un sello azul sí', () => {
        const { data, pintar } = hoja(100, 100);
        pintar(0, 0, 100, 10, [30, 30, 30]);         // texto negro: gris puro
        expect(medirDocumento(data, 100, 100).color).toBe(0);

        pintar(0, 20, 100, 2, [40, 70, 200]);        // sello azul
        expect(medirDocumento(data, 100, 100).color).toBeCloseTo(0.02, 3);
    });

    it('no cuenta color en las sombras ni en los brillos quemados', () => {
        const { data, pintar } = hoja(100, 100);
        pintar(0, 0, 100, 5, [10, 0, 40]);           // casi negro, muy saturado
        pintar(0, 10, 100, 5, [255, 240, 250]);      // casi blanco, con tinte
        expect(medirDocumento(data, 100, 100).color).toBe(0);
    });

    it('devuelve algo usable con una imagen vacía en vez de romperse', () => {
        expect(medirDocumento(null, 0, 0)).toMatchObject({ papel: 255, tinta: 0, color: 0 });
    });
});

describe('avisosDeFoto', () => {
    const buena = { papel: 250, tinta: 0.03, color: 0, ancho: 1131, alto: 1600 };

    it('una foto buena no dice nada', () => {
        expect(avisosDeFoto(buena)).toEqual([]);
    });

    it('avisa cuando casi no hay tinta', () => {
        const a = avisosDeFoto({ ...buena, tinta: 0.0002 });
        expect(a).toHaveLength(1);
        expect(a[0].tono).toBe('warning');
        expect(a[0].texto).toMatch(/tinta/i);
    });

    // Una receta escueta —cuatro renglones en un talonario— tiene poca tinta y
    // es perfectamente válida. El corte está bajo justamente para no molestarla.
    it('no molesta a una receta de pocos renglones', () => {
        expect(avisosDeFoto({ ...buena, tinta: 0.004 })).toEqual([]);
    });

    it('sugiere «Aclarada» sólo cuando NO está puesta', () => {
        const oscura = { ...buena, papel: 97 };
        expect(avisosDeFoto(oscura, 'original').some(x => /Aclarada/.test(x.texto))).toBe(true);
        expect(avisosDeFoto(oscura, 'aclarada').some(x => /le sube el contraste/.test(x.texto))).toBe(false);
    });

    it('avisa del color sólo con «Aclarada» puesta, que es cuando se pierde', () => {
        const conSello = { ...buena, color: 0.004 };
        expect(avisosDeFoto(conSello, 'aclarada').some(x => /sello/.test(x.texto))).toBe(true);
        expect(avisosDeFoto(conSello, 'original')).toEqual([]);
    });

    // Del color se dice lo que se sabe. Que no haya color NO prueba que falte el
    // sello —muchos son negros—, así que no existe el aviso contrario.
    it('nunca dice que falta el sello', () => {
        const textos = [
            ...avisosDeFoto({ ...buena, color: 0 }, 'aclarada'),
            ...avisosDeFoto({ ...buena, color: 0 }, 'original'),
            ...avisosDeFoto({ ...buena, tinta: 0 }, 'aclarada'),
        ].map(a => a.texto).join(' ');
        expect(textos).not.toMatch(/falta.*sello|sin sello|no.*sello/i);
    });

    it('avisa del recorte chico', () => {
        const a = avisosDeFoto({ ...buena, ancho: 600, alto: 800 });
        expect(a.some(x => /chico/.test(x.texto))).toBe(true);
    });

    it('sin medidas no inventa avisos', () => {
        expect(avisosDeFoto(null)).toEqual([]);
    });
});
