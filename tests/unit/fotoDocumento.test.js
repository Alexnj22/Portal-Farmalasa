import { describe, expect, it } from 'vitest';
import { DOCS, avisosDeFoto, escalaDeSalida, medirDocumento } from '../../src/utils/fotoDocumento';

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

// ═══════════════════════════════════════════════════════════════════════════
// Por qué lado sale el archivo.
//
// Una hoja se normaliza por el lado largo y una boleta térmica por el ancho de
// su tira — porque lo que hace legible la letra de una boleta es cuántos
// píxeles tiene A LO LARGO DEL RENGLÓN, y su largo depende de cuántos renglones
// imprimió el POS. Se ancla acá porque el efecto sólo se ve abriendo el archivo
// guardado: con la regla vieja, la misma boleta salía con 800 px de ancho o con
// 270 según fuera corta o larga, y nada avisaba.
// ═══════════════════════════════════════════════════════════════════════════
describe('escalaDeSalida', () => {
    const anchoFinal = (a, b, doc) => Math.round(Math.min(a, b) * escalaDeSalida(a, b, doc));

    it('una boleta corta y una larga salen con el MISMO ancho', () => {
        expect(anchoFinal(1500, 3000, DOCS.boleta)).toBe(1200);
        expect(anchoFinal(1500, 6000, DOCS.boleta)).toBe(1200);
    });

    it('con la regla de la hoja, esa misma boleta larga habría salido ilegible', () => {
        // 1500 × 6000 normalizada por el lado largo a 1600: 400 px de ancho.
        expect(anchoFinal(1500, 6000, DOCS.receta)).toBe(400);
    });

    it('una tira muy larga se frena en el tope para no dar un archivo enorme', () => {
        const [a, b] = [1500, 12000];
        const e = escalaDeSalida(a, b, DOCS.boleta);
        expect(Math.round(b * e)).toBe(6000);
        expect(Math.round(a * e)).toBeLessThan(1200);
    });

    it('nunca agranda: una foto chica sale como está', () => {
        expect(escalaDeSalida(500, 1400, DOCS.boleta)).toBe(1);
        expect(escalaDeSalida(600, 800, DOCS.receta)).toBe(1);
    });

    it('una hoja sigue midiéndose por el lado largo', () => {
        const e = escalaDeSalida(2400, 3200, DOCS.receta);
        expect(Math.round(3200 * e)).toBe(1600);
    });

    it('sin medidas usables no rompe', () => {
        expect(escalaDeSalida(0, 0, DOCS.boleta)).toBe(1);
        expect(escalaDeSalida(1000, 2000, {})).toBeCloseTo(0.8);
    });
});

// El aviso de «recorte chico» y la normalización miran el MISMO lado: si se
// separan, el aviso habla de un archivo que no es el que se guarda.
describe('el aviso del recorte chico en una boleta', () => {
    it('no molesta a una boleta bien tomada', () => {
        const buena = { papel: 250, tinta: 0.03, color: 0, ancho: 1200, alto: 3000 };
        expect(avisosDeFoto(buena, 'aclarada', DOCS.boleta)).toEqual([]);
    });

    it('avisa cuando la boleta se fotografió de lejos', () => {
        const lejos = { papel: 250, tinta: 0.03, color: 0, ancho: 500, alto: 1300 };
        expect(avisosDeFoto(lejos, 'aclarada', DOCS.boleta).some(a => /chico/.test(a.texto))).toBe(true);
    });
});
