// App de clientes — el motor de física de «Pastillero» (2026-11-04).
// lib/caida.js no importa nada de la app ni de React Native: se prueba tal
// cual. Las directivas 'worklet' son sólo texto fuera de la app.
import { describe, expect, it } from 'vitest';
import {
  AL_AZAR, ESPERA_PERDER, MAX, PAUSA_SOLTAR, PREMIO_CUMBRE, RADIOS,
  agregar, avanzar, crearMundo, elegirAlAzar, energia, paso, puntosDe, soltar,
} from '../../apps/clientes/lib/caida.js';

const ALTO = 1.3;
const correr = (m, segundos) => { for (let i = 0; i < Math.round(segundos * 120); i++) paso(m); };

describe('dos iguales que se tocan', () => {
  it('se juntan UNA vez en el siguiente nivel, en el punto medio', () => {
    const m = crearMundo(ALTO, 7);
    const r = RADIOS[2];
    agregar(m, 2, 0.5 - r, ALTO - r);
    agregar(m, 2, 0.5 + r, ALTO - r);
    paso(m);
    expect(m.cuerpos).toHaveLength(1);
    expect(m.cuerpos[0].n).toBe(3);
    expect(m.cuerpos[0].x).toBeCloseTo(0.5, 2);
    expect(m.uniones).toBe(1);
    expect(m.puntos).toBe(puntosDe(3));
    expect(m.eventos).toEqual([expect.objectContaining({ tipo: 'junta', n: 3 })]);
  });

  it('tres iguales en fila: sólo se une una pareja, la tercera queda', () => {
    const m = crearMundo(ALTO, 7);
    const r = RADIOS[1];
    agregar(m, 1, 0.3, ALTO - r);
    agregar(m, 1, 0.3 + 2 * r, ALTO - r);
    agregar(m, 1, 0.3 + 4 * r, ALTO - r);
    paso(m);
    expect(m.uniones).toBe(1);
    expect(m.cuerpos.map((b) => b.n).sort()).toEqual([1, 2]);
  });

  it('distintos que se tocan no se juntan', () => {
    const m = crearMundo(ALTO, 7);
    agregar(m, 1, 0.4, ALTO - RADIOS[1]);
    agregar(m, 2, 0.4 + RADIOS[1] + RADIOS[2], ALTO - RADIOS[2]);
    correr(m, 1);
    expect(m.cuerpos).toHaveLength(2);
    expect(m.uniones).toBe(0);
  });

  it('dos del último nivel se van con su premio', () => {
    const m = crearMundo(ALTO, 7);
    const r = RADIOS[MAX];
    agregar(m, MAX, 0.5 - r, ALTO - r);
    agregar(m, MAX, 0.5 + r, ALTO - r);
    paso(m);
    expect(m.cuerpos).toHaveLength(0);
    expect(m.puntos).toBe(PREMIO_CUMBRE);
  });
});

describe('las paredes y el fondo', () => {
  it('nada atraviesa paredes ni fondo, aunque llegue rápido', () => {
    const m = crearMundo(ALTO, 3);
    // Muchos cuerpos distintos tirados con fuerza contra todos lados.
    for (let i = 0; i < 30; i++) {
      const b = agregar(m, i % 5, 0.1 + (i % 6) * 0.15, -0.2 - Math.floor(i / 6) * 0.25, (i % 2 ? 1 : -1) * 6, 6);
      b.n = i % 5;
    }
    for (let k = 0; k < 120 * 6; k++) {
      paso(m);
      for (const b of m.cuerpos) {
        expect(b.x - b.r).toBeGreaterThanOrEqual(-1e-9);
        expect(b.x + b.r).toBeLessThanOrEqual(1 + 1e-9);
        expect(b.y + b.r).toBeLessThanOrEqual(ALTO + 1e-9);
      }
    }
  });
});

describe('la pila', () => {
  it('se calma: energía casi nula y sin penetraciones grandes tras unos segundos', () => {
    const m = crearMundo(2.2, 11);
    // Una columna de piezas distintas (alternadas para que no se junten).
    const niveles = [0, 1, 0, 2, 1, 3, 0, 4, 1, 2, 0, 3, 1, 4, 2, 0, 3, 1, 4, 0];
    niveles.forEach((n, i) => agregar(m, n, 0.15 + ((i * 0.37) % 0.7), 1.2 - i * 0.12));
    correr(m, 8);
    expect(energia(m)).toBeLessThan(1e-5);
    let peor = 0;
    const cs = m.cuerpos;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const pen = cs[i].r + cs[j].r - Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
      if (pen > peor) peor = pen;
    }
    expect(peor).toBeLessThan(0.01);
  });

  it('avanzar en cuadros irregulares da pasos fijos y no se dispara', () => {
    const m = crearMundo(ALTO, 5);
    agregar(m, 0, 0.5, 0.2);
    expect(avanzar(m, 1 / 60)).toBe(2);
    expect(avanzar(m, 5)).toBe(6); // un cuadro larguísimo no da 600 pasos
  });
});

describe('soltar y el azar', () => {
  it('sólo salen los niveles más chicos y la siguiente pasa a ser la actual', () => {
    const m = crearMundo(ALTO, 99);
    const vistos = new Set();
    for (let i = 0; i < 2000; i++) vistos.add(elegirAlAzar(m));
    expect(Math.max(...vistos)).toBe(AL_AZAR - 1);
    const sig = m.siguiente;
    expect(soltar(m, 0.5)).not.toBeNull();
    expect(m.actual).toBe(sig);
    expect(soltar(m, 0.5)).toBeNull(); // la pausa corta entre una y otra
    correr(m, PAUSA_SOLTAR + 0.01);
    expect(soltar(m, 0.5)).not.toBeNull();
  });
});

describe('perder', () => {
  it('el que viene cayendo por encima del borde no cuenta', () => {
    const m = crearMundo(ALTO, 1);
    agregar(m, 0, 0.5, -0.3);
    for (let i = 0; i < 30; i++) paso(m);
    expect(m.cuerpos[0].y).toBeLessThan(0);
    expect(m.perdio).toBe(false);
    expect(m.peligro).toBe(0);
  });

  it('una pila que sobresale del borde pierde a los ~2 s, no al instante', () => {
    const m = crearMundo(0.3, 1); // un botiquín bajito: la pila se sale enseguida
    const niveles = [4, 3, 4, 3, 2, 4, 3, 2, 4];
    niveles.forEach((n, i) => agregar(m, n, 0.12 + (i % 4) * 0.25, 0.2 - Math.floor(i / 4) * 0.25));
    correr(m, 1);
    expect(m.perdio).toBe(false);
    correr(m, ESPERA_PERDER + 0.5);
    expect(m.perdio).toBe(true);
  });

  it('si baja a tiempo, el reloj vuelve a cero', () => {
    const m = crearMundo(ALTO, 1);
    const b = agregar(m, 0, 0.5, ALTO - RADIOS[0]);
    b.toco = true; b.arriba = 1.5;
    paso(m);
    expect(m.cuerpos[0].arriba).toBe(0);
    expect(m.perdio).toBe(false);
  });
});
