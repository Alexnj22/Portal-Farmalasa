// App de clientes — el motor del Botiquín (lib/botiquinMotor.js, Matter.js).
// No importa nada de React Native: se prueba tal cual en Node.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// El motor usa Matter.js, que vive en las dependencias de la app de clientes.
// La CI del portal no las instala: ahí estas pruebas se saltan en vez de
// fallar por una dependencia ausente. Localmente (y antes de subir la app) corren.
const RAIZ = join(process.cwd(), 'apps/clientes/node_modules/matter-js/package.json');
const hay = existsSync(RAIZ);
const M = hay ? await import('../../apps/clientes/lib/botiquinMotor.js') : {};
const Matter = hay ? (await import('../../apps/clientes/node_modules/matter-js/build/matter.js')).default : null;
const {
  AL_AZAR, CAJA = {}, ESPERA_PERDER, MAX, PAUSA_SOLTAR, PREMIO_CUMBRE, RADIOS = [],
  agregar, avanzar, crearMundo, destruir, energia, paso, piezas, puntosDe, soltar,
} = M;
const describe2 = describe.skipIf(!hay);

const correr = (m, s) => { for (let i = 0; i < Math.round(s * 120); i++) paso(m); };

describe2('dos iguales que se tocan', () => {
  it('se juntan UNA vez en el siguiente nivel', () => {
    const m = crearMundo(7);
    agregar(m, 2, 180, CAJA.ALTO - RADIOS[2]);
    agregar(m, 2, 180 + RADIOS[2] * 2 - 1, CAJA.ALTO - RADIOS[2]);
    correr(m, 0.5);
    const l = piezas(m);
    expect(l).toHaveLength(1);
    expect(l[0].plugin.n).toBe(3);
    expect(m.puntos).toBe(puntosDe(3));
    expect(m.eventos.filter((e) => e.tipo === 'junta')).toHaveLength(1);
  });

  it('la recién unida crece hasta su radio sin hacer explotar la pila', () => {
    const m = crearMundo(3);
    for (let i = 0; i < 6; i++) agregar(m, 5, 50 + i * 60, CAJA.ALTO - 200);
    correr(m, 3);
    agregar(m, 1, 200, 40); agregar(m, 1, 200 + RADIOS[1] * 2, 40);
    correr(m, 4);
    for (const b of piezas(m)) expect(b.circleRadius).toBeCloseTo(RADIOS[b.plugin.n], 1);
    for (const b of piezas(m)) {
      expect(b.position.x).toBeGreaterThan(0);
      expect(b.position.x).toBeLessThan(CAJA.ANCHO);
      expect(b.position.y).toBeLessThan(CAJA.ALTO + 1);
    }
  });

  it('distintas no se juntan', () => {
    const m = crearMundo(1);
    agregar(m, 1, 150, CAJA.ALTO - 30); agregar(m, 2, 150 + RADIOS[1] + RADIOS[2], CAJA.ALTO - 30);
    correr(m, 1);
    expect(piezas(m)).toHaveLength(2);
  });

  it('dos de la última se van con el premio', () => {
    const m = crearMundo(1);
    agregar(m, MAX, 110, CAJA.ALTO - RADIOS[MAX]);
    agregar(m, MAX, 110 + RADIOS[MAX] * 2 - 2, CAJA.ALTO - RADIOS[MAX]);
    correr(m, 0.5);
    expect(piezas(m)).toHaveLength(0);
    expect(m.puntos).toBe(PREMIO_CUMBRE);
  });
});

describe2('soltar', () => {
  it('sale sólo de las cinco chicas, respeta la pausa y queda dentro', () => {
    const m = crearMundo(11);
    for (let i = 0; i < 200; i++) {
      expect(m.actual).toBeLessThan(AL_AZAR);
      if (!soltar(m, -50)) avanzar(m, PAUSA_SOLTAR + 0.01);
      if (piezas(m).length > 4) { destruir(m); break; }
    }
    const m2 = crearMundo(2);
    expect(soltar(m2, 9999)).not.toBeNull();
    expect(soltar(m2, 200)).toBeNull(); // la pausa
    const b = piezas(m2)[0];
    expect(b.position.x).toBeLessThanOrEqual(CAJA.ANCHO - b.circleRadius);
  });
});

describe2('la pila', () => {
  it('se calma: la energía cae casi a cero', () => {
    const m = crearMundo(5);
    for (let i = 0; i < 25; i++) agregar(m, i % 3, 40 + ((i * 53) % 320), 50 - i * 40);
    correr(m, 8);
    expect(energia(m)).toBeLessThan(1);
  });

  it('se pierde sólo si algo que ya tocó queda asomado', () => {
    const m = crearMundo(5);
    // Una pieza que ya tocó, sostenida por encima del borde.
    const b = agregar(m, 3, 200, -40);
    b.plugin.toco = true;
    Matter.Body.setStatic(b, true);
    correr(m, ESPERA_PERDER - 0.3);
    expect(m.perdio).toBe(false);
    expect(m.peligro).toBeGreaterThan(1);
    correr(m, 0.5);
    expect(m.perdio).toBe(true);
    const m2 = crearMundo(5);
    soltar(m2, 200);
    correr(m2, 1);
    expect(m2.perdio).toBe(false);
  });

  it('juega 300 piezas sin escaparse de la caja', () => {
    const m = crearMundo(9);
    let s = 1;
    for (let k = 0; k < 300 && !m.perdio; k++) {
      s = (s * 16807) % 2147483647;
      soltar(m, (s / 2147483647) * CAJA.ANCHO);
      avanzar(m, 0.5);
    }
    for (const b of piezas(m)) {
      expect(b.position.x).toBeGreaterThan(-1);
      expect(b.position.x).toBeLessThan(CAJA.ANCHO + 1);
      expect(b.position.y).toBeLessThan(CAJA.ALTO + 1);
    }
  });
});
