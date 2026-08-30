// ─────────────────────────────────────────────────────────────────────────────
// Rectificar la perspectiva de un documento fotografiado de costado
// ─────────────────────────────────────────────────────────────────────────────
//
// Un papel apoyado en un mostrador sale como un TRAPECIO: el borde de arriba
// más corto que el de abajo. Eso no lo arregla ningún giro —por eso el editor
// podía enderezar y recortar y la letra de un extremo seguía más chica que la
// del otro— y el lienzo tampoco, porque sólo sabe transformaciones AFINES, que
// mantienen el paralelismo.
//
// Lo que se prueba acá es la MATEMÁTICA, que es donde un error no se ve: una
// homografía casi correcta deforma la imagen de un modo que parece perspectiva
// y no lo es. El dibujo por malla se mide aparte, en el navegador.

import { describe, it, expect } from 'vitest';
import { homografia, aplicar, ordenarEsquinas, deformacion, girarEsquinas } from '../../src/utils/perspectiva';

const cerca = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('la homografía', () => {
    it('manda cada esquina EXACTAMENTE a donde se le pidió', () => {
        // Un trapecio como el de una foto de costado: arriba angosto.
        const trapecio = [{ x: 120, y: 60 }, { x: 380, y: 40 }, { x: 460, y: 300 }, { x: 40, y: 320 }];
        const rect = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 250 }, { x: 0, y: 250 }];
        const h = homografia(trapecio, rect);
        expect(h).not.toBeNull();
        trapecio.forEach((p, i) => {
            const r = aplicar(h, p.x, p.y);
            cerca(r.x, rect[i].x, 1e-6);
            cerca(r.y, rect[i].y, 1e-6);
        });
    });

    it('la ida y la vuelta devuelven el punto de partida', () => {
        const quad = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 330, y: 210 }, { x: 0, y: 240 }];
        const rect = [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }];
        const ida = homografia(quad, rect);
        const vuelta = homografia(rect, quad);
        const p = aplicar(vuelta, ...Object.values(aplicar(ida, 173, 96)));
        cerca(p.x, 173, 1e-4);
        cerca(p.y, 96, 1e-4);
    });

    it('devuelve null cuando los cuatro puntos NO definen ninguna', () => {
        // Cuatro puntos alineados. Inventar una transformación acá deformaría la
        // imagen sin que nada avise.
        const alineados = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
        const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
        expect(homografia(alineados, rect)).toBeNull();
    });

    it('no acepta menos de cuatro puntos', () => {
        expect(homografia([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toBeNull();
        expect(homografia(null, null)).toBeNull();
    });
});

describe('ordenar las esquinas', () => {
    it('las pone arriba-izq, arriba-der, abajo-der, abajo-izq venga como venga', () => {
        // El modelo puede devolverlas en cualquier orden, y con el orden
        // equivocado la imagen sale espejada o del revés.
        const esperado = [{ x: 10, y: 10 }, { x: 90, y: 12 }, { x: 95, y: 80 }, { x: 5, y: 85 }];
        const revuelto = [esperado[2], esperado[0], esperado[3], esperado[1]];
        expect(ordenarEsquinas(revuelto)).toEqual(esperado);
    });

    it('devuelve null si no hay dos arriba y dos abajo', () => {
        expect(ordenarEsquinas([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 100 }])).toBeNull();
    });
});

describe('cuánto se aparta de un rectángulo', () => {
    it('un rectángulo perfecto da 0 — y por eso no se redibuja', () => {
        // Rectificar una foto que ya está de frente sólo le agrega una
        // interpolación y le quita nitidez.
        expect(deformacion([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }])).toBe(0);
    });

    it('un trapecio marcado da un valor alto', () => {
        const d = deformacion([{ x: 30, y: 0 }, { x: 70, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]);
        expect(d).toBeGreaterThan(0.5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// La matriz del DIBUJO iba al revés — y por eso el recorte salía mal
// ─────────────────────────────────────────────────────────────────────────────
//
// El encabezado de este archivo decía «el dibujo por malla se mide aparte, en el
// navegador». Esa medición nunca se hizo, y ahí estaba el defecto: la homografía
// —que sí se probaba— era correcta, pero la afín de cada triángulo se instalaba
// INVERTIDA. Cada celda se pintaba con una porción equivocada de la foto.
//
// `drawImage(imagen, 0, 0)` dibuja en el espacio de usuario actual: el píxel
// (0,0) de la foto cae en el (0,0) de ese espacio. Entonces la matriz tiene que
// llevar coordenadas de la FOTO a coordenadas del RESULTADO. La que estaba
// instalada era la contraria — la que sirve para saber de dónde LEER cada píxel,
// no para dibujarlo.
//
// Sobrevivió porque las pruebas usaban documentos de un color plano: con un
// rectángulo uniforme, dibujar la porción equivocada se ve igual. Lo destapó el
// usuario recortando la foto de una factura.
//
// Medido en el navegador después del arreglo, con marcas de color en las cuatro
// esquinas del documento: las cuatro aparecen en el resultado, en Chromium y en
// WebKit, con foto de 1600×1200 y de 3024×4032, en rectángulo y en trapecio.
// Antes: NINGUNA.

import { afinDeTriangulos } from '../../src/utils/perspectiva';

describe('la afín de cada triángulo de la malla', () => {
    const orig = [{ x: 120, y: 60 }, { x: 380, y: 40 }, { x: 460, y: 300 }];
    const dest = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 250 }];

    it('lleva el triángulo de la FOTO al del RESULTADO, no al revés', () => {
        const m = afinDeTriangulos(orig, dest);
        expect(m).not.toBeNull();
        orig.forEach((p, i) => {
            cerca(m.a * p.x + m.b * p.y + m.tx, dest[i].x, 1e-6);
            cerca(m.c * p.x + m.e * p.y + m.ty, dest[i].y, 1e-6);
        });
    });

    /* La prueba que hace falta para creerle a la de arriba: la matriz invertida
     * —la que estaba— NO lleva orig a dest. Sin esto, una matriz identidad
     * pasaría la primera prueba si orig y dest coincidieran. */
    it('y la contraria no lo hace: son matrices distintas', () => {
        const m = afinDeTriangulos(orig, dest);
        const alReves = afinDeTriangulos(dest, orig);
        const p = orig[1];
        const x = alReves.a * p.x + alReves.b * p.y + alReves.tx;
        expect(Math.abs(x - dest[1].x)).toBeGreaterThan(1);
    });

    it('un triángulo degenerado no revienta: devuelve null', () => {
        const enLinea = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }];
        expect(afinDeTriangulos(enLinea, dest)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arrastrar una manija sobre otra NO puede acostar el documento
// ─────────────────────────────────────────────────────────────────────────────
//
// «Ahora sí, pero ¿por qué la acuesta? No me permite rotar» (usuario, con una
// factura de pie que salió acostada).
//
// El editor confiaba en el ORDEN de los cuatro puntos para saber cuál es la
// esquina de arriba a la izquierda, porque ese orden es también el que rota el
// botón «Girar». Pero el orden lo puede cambiar la MANO: son cuatro blancos de
// 44 pt y arrastrar uno por encima de otro los intercambia — y el documento sale
// girado sin que nadie lo haya pedido.
//
// Ahora las esquinas se ordenan solas antes de enderezar y el giro pedido se
// cuenta aparte. Medido en el navegador: con el orden normal y con el orden
// rotado, el resultado es idéntico —850 × 1300, de pie, con la marca roja arriba
// a la izquierda— y el botón «Girar» del acabado lo pasa a 1300 × 850.

describe('el orden de las esquinas no depende de cómo se arrastraron', () => {
    const enOrden = [{ x: 40, y: 20 }, { x: 300, y: 30 }, { x: 310, y: 240 }, { x: 30, y: 230 }];

    it('rotar la lista de entrada da el MISMO orden', () => {
        const base = ordenarEsquinas(enOrden);
        for (let giros = 1; giros < 4; giros++) {
            const rotada = enOrden.slice(giros).concat(enOrden.slice(0, giros));
            expect(ordenarEsquinas(rotada)).toEqual(base);
        }
    });

    it('e invertir el sentido, también', () => {
        expect(ordenarEsquinas([...enOrden].reverse())).toEqual(ordenarEsquinas(enOrden));
    });

    /* La gemela que hace fiable a las de arriba: `girarEsquinas` SÍ cambia el
     * orden. Si no, «ordenar siempre igual» se cumpliría con una función que
     * devuelve cualquier cosa constante. */
    it('y girar a propósito sí lo cambia', () => {
        const o = ordenarEsquinas(enOrden);
        expect(girarEsquinas(o)).not.toEqual(o);
        // Cuatro cuartos vuelven al principio.
        expect(girarEsquinas(girarEsquinas(girarEsquinas(girarEsquinas(o))))).toEqual(o);
    });
});
