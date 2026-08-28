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
import { homografia, aplicar, ordenarEsquinas, deformacion } from '../../src/utils/perspectiva';

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
