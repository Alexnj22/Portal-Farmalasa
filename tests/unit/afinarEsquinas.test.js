import { describe, it, expect } from 'vitest';
import { afinarEsquinas } from '@nucleo/utils/afinarEsquinas';

/* Una foto sintética: mesa oscura (40) y un papel claro (210), opcionalmente
 * girado unos grados, con un poco de ruido para que no sea un caso de libro. */
function foto(ancho, alto, papel, { ruido = 6, semilla = 7 } = {}) {
    const g = new Float32Array(ancho * alto);
    let r = semilla;
    const azar = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
    const dentro = (x, y) => {
        // Punto dentro del cuadrilátero convexo `papel` (en píxeles).
        let signo = 0;
        for (let i = 0; i < 4; i++) {
            const a = papel[i], b = papel[(i + 1) % 4];
            const z = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
            const s = Math.sign(z);
            if (s === 0) continue;
            if (!signo) signo = s; else if (s !== signo) return false;
        }
        return true;
    };
    for (let y = 0; y < alto; y++) {
        for (let x = 0; x < ancho; x++) {
            g[y * ancho + x] = (dentro(x, y) ? 210 : 40) + (azar() - 0.5) * 2 * ruido;
        }
    }
    return g;
}

const fr = (p, w, h) => p.map(q => ({ x: q.x / w, y: q.y / h }));
const distMax = (a, b, w, h) => Math.max(...a.map((p, i) => Math.hypot((p.x - b[i].x) * w, (p.y - b[i].y) * h)));

describe('afinarEsquinas', () => {
    const W = 600, H = 400;
    // Papel en perspectiva leve (trapecio), como una foto tomada de pie.
    const real = [{ x: 110, y: 70 }, { x: 495, y: 85 }, { x: 510, y: 335 }, { x: 95, y: 320 }];
    const g = foto(W, H, real);

    it('lleva unas esquinas corridas ~12 px a los bordes reales', () => {
        const modelo = [{ x: 122, y: 60 }, { x: 485, y: 96 }, { x: 498, y: 345 }, { x: 84, y: 309 }];
        const r = afinarEsquinas(g, W, H, fr(modelo, W, H));
        expect(r.motivo).toBeNull();
        expect(r.ladosAfinados).toBeGreaterThanOrEqual(3);
        expect(distMax(r.esquinas, fr(real, W, H), W, H)).toBeLessThan(4);
        expect(distMax(fr(modelo, W, H), fr(real, W, H), W, H)).toBeGreaterThan(10);
    });

    it('si el modelo ya acertó, casi no las mueve', () => {
        const r = afinarEsquinas(g, W, H, fr(real, W, H));
        expect(distMax(r.esquinas, fr(real, W, H), W, H)).toBeLessThan(3);
    });

    it('sin un borde claro (foto lisa) devuelve las del modelo tal cual', () => {
        const lisa = foto(W, H, [{ x: -1, y: -1 }, { x: -2, y: -1 }, { x: -2, y: -2 }, { x: -1, y: -2 }]);
        const modelo = fr([{ x: 120, y: 60 }, { x: 480, y: 90 }, { x: 500, y: 340 }, { x: 90, y: 310 }], W, H);
        const r = afinarEsquinas(lisa, W, H, modelo);
        expect(r.esquinas).toBe(modelo);
        expect(r.ladosAfinados).toBe(0);
    });

    it('no se va lejos: un borde fuera de la banda no se toma', () => {
        // El modelo está ~60 px adentro del papel: la banda (4% = 24 px) no
        // alcanza el borde real, así que no hay nada mejor que tomar.
        const modelo = fr([{ x: 170, y: 130 }, { x: 435, y: 140 }, { x: 450, y: 275 }, { x: 155, y: 265 }], W, H);
        const r = afinarEsquinas(g, W, H, modelo);
        expect(distMax(r.esquinas, modelo, W, H)).toBeLessThan(24 * 1.5 + 1);
    });
});
