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
  AL_AZAR, CAJA = {}, ESPERA_PERDER, FORMAS = [], GERMENES = [], MAX, PAUSA_SOLTAR, PREMIO_CUMBRE,
  agregar, avanzar, crearMundo, destruir, energia, medidas, paso, piezas, puntosDe, soltar,
} = M;
const describe2 = describe.skipIf(!hay);

const correr = (m, s) => { for (let i = 0; i < Math.round(s * 120); i++) paso(m); };
const ancho = (n) => medidas(FORMAS[n]).w;
const alto = (n) => medidas(FORMAS[n]).h;

describe2('dos iguales que se tocan', () => {
  it('se juntan UNA vez en el siguiente nivel', () => {
    const m = crearMundo(7);
    agregar(m, 2, 120, CAJA.ALTO - alto(2) / 2);
    agregar(m, 2, 120 + ancho(2) - 1, CAJA.ALTO - alto(2) / 2);
    correr(m, 0.5);
    const l = piezas(m);
    expect(l).toHaveLength(1);
    expect(l[0].plugin.n).toBe(3);
    expect(m.puntos).toBe(puntosDe(3));
    expect(m.eventos.filter((e) => e.tipo === 'junta')).toHaveLength(1);
  });

  it('la recién unida crece hasta su tamaño sin hacer explotar la pila', () => {
    const m = crearMundo(3);
    for (let i = 0; i < 5; i++) agregar(m, 4, 40 + i * 72, CAJA.ALTO - 200);
    correr(m, 3);
    agregar(m, 1, 150, 40); agregar(m, 1, 150 + ancho(1), 40);
    correr(m, 4);
    for (const b of piezas(m)) {
      expect(b.plugin.esc).toBe(1);
      expect(b.position.x).toBeGreaterThan(0);
      expect(b.position.x).toBeLessThan(CAJA.ANCHO);
      expect(b.position.y).toBeLessThan(CAJA.ALTO + 1);
    }
  });

  it('distintas no se juntan', () => {
    const m = crearMundo(1);
    agregar(m, 1, 120, CAJA.ALTO - 30); agregar(m, 2, 120 + (ancho(1) + ancho(2)) / 2, CAJA.ALTO - 30);
    correr(m, 1);
    expect(piezas(m)).toHaveLength(2);
  });

  it('dos de la última se van con el premio', () => {
    const m = crearMundo(1);
    const r = FORMAS[MAX].r;
    agregar(m, MAX, r + 2, CAJA.ALTO - r);
    agregar(m, MAX, r * 3, CAJA.ALTO - r);
    correr(m, 0.5);
    expect(piezas(m)).toHaveLength(0);
    expect(m.puntos).toBe(PREMIO_CUMBRE);
  });

  it('dos uniones seguidas multiplican la segunda', () => {
    const m = crearMundo(4);
    agregar(m, 0, 60, CAJA.ALTO - 17); agregar(m, 0, 93, CAJA.ALTO - 17);
    agregar(m, 0, 280, CAJA.ALTO - 17); agregar(m, 0, 313, CAJA.ALTO - 17);
    correr(m, 0.5);
    const j = m.eventos.filter((e) => e.tipo === 'junta');
    expect(j).toHaveLength(2);
    expect(j[1].racha).toBe(2);
    expect(m.puntos).toBe(puntosDe(1) + Math.round(puntosDe(1) * 1.5));
  });
});

describe2('lo malo y lo bueno', () => {
  it('dos gérmenes iguales se juntan en uno más grande', () => {
    const m = crearMundo(2);
    const r = GERMENES[0].r;
    agregar(m, { tipo: 'germen', n: 0 }, 150, CAJA.ALTO - r);
    agregar(m, { tipo: 'germen', n: 0 }, 150 + r * 2 - 1, CAJA.ALTO - r);
    correr(m, 0.5);
    const l = piezas(m);
    expect(l).toHaveLength(1);
    expect(l[0].plugin.tipo).toBe('germen');
    expect(l[0].plugin.n).toBe(1);
    expect(m.germenesVivos).toBe(1);
  });

  it('una unión de medicamentos al lado elimina al germen', () => {
    const m = crearMundo(2);
    agregar(m, { tipo: 'germen', n: 0 }, 200, CAJA.ALTO - GERMENES[0].r);
    // la de la derecha toca al germen
    const x = 200 - GERMENES[0].r - ancho(3) / 2;
    agregar(m, 3, x, CAJA.ALTO - alto(3) / 2);
    agregar(m, 3, x - ancho(3) + 1, CAJA.ALTO - alto(3) / 2);
    correr(m, 0.6);
    expect(m.germenesVivos).toBe(0);
    expect(m.limpiados).toBe(1);
    expect(piezas(m).some((b) => b.plugin.tipo === 'germen')).toBe(false);
  });

  it('el gel estalla al tocar y limpia los de alrededor', () => {
    const m = crearMundo(2);
    agregar(m, { tipo: 'germen', n: 1 }, 150, CAJA.ALTO - GERMENES[1].r);
    agregar(m, { tipo: 'germen', n: 0 }, 240, CAJA.ALTO - GERMENES[0].r);
    agregar(m, { tipo: 'gel', n: 0 }, 150, CAJA.ALTO - 120);
    correr(m, 1);
    expect(m.germenesVivos).toBe(0);
    expect(piezas(m)).toHaveLength(0);
    expect(m.eventos.some((e) => e.tipo === 'gel' && e.limpiados === 2)).toBe(true);
  });

  it('un germen que nadie limpia crece solo', () => {
    const m = crearMundo(2);
    agregar(m, { tipo: 'germen', n: 0 }, 150, CAJA.ALTO - GERMENES[0].r);
    correr(m, 14);
    expect(piezas(m)[0].plugin.n).toBeGreaterThan(0);
  });
});

describe2('soltar', () => {
  it('las primeras son medicamentos chicos, respeta la pausa y queda dentro', () => {
    const m = crearMundo(11);
    for (let i = 0; i < 6; i++) {
      expect(m.actual.tipo).toBe('med');
      expect(m.actual.n).toBeLessThan(AL_AZAR);
      if (!soltar(m, -50)) avanzar(m, PAUSA_SOLTAR + 0.01);
    }
    destruir(m);
    const m2 = crearMundo(2);
    expect(soltar(m2, 9999)).not.toBeNull();
    expect(soltar(m2, 200)).toBeNull(); // la pausa
    const b = piezas(m2)[0];
    expect(b.bounds.max.x).toBeLessThanOrEqual(CAJA.ANCHO + 0.5);
  });

  it('con el tiempo aparecen gérmenes, nunca dos seguidos', () => {
    const m = crearMundo(13);
    let germenes = 0; let antes = false;
    for (let i = 0; i < 200; i++) {
      const g = m.actual.tipo === 'germen';
      if (g) { germenes++; expect(antes).toBe(false); }
      antes = g;
      m.ultimaSoltada = -10; soltar(m, 200);
      for (const b of piezas(m)) Matter.Composite.remove(m.engine.world, b);
    }
    expect(germenes).toBeGreaterThan(20);
  });
});

describe2('la pila', () => {
  it('se calma: la energía cae casi a cero', () => {
    const m = crearMundo(5);
    for (let i = 0; i < 20; i++) agregar(m, i % 3, 50 + ((i * 53) % 270), 50 - i * 40);
    correr(m, 8);
    expect(energia(m)).toBeLessThan(1);
  });

  it('se pierde sólo si algo que ya tocó queda asomado', () => {
    const m = crearMundo(5);
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

  it('una partida termina y nada se escapa de la caja', () => {
    const m = crearMundo(9);
    let s = 1; let k = 0;
    for (; k < 1200 && !m.perdio; k++) {
      s = (s * 16807) % 2147483647;
      soltar(m, (s / 2147483647) * CAJA.ANCHO);
      correr(m, 0.5);
      for (const b of piezas(m)) {
        expect(b.position.x).toBeGreaterThan(-1);
        expect(b.position.x).toBeLessThan(CAJA.ANCHO + 1);
        expect(b.position.y).toBeLessThan(CAJA.ALTO + 1);
      }
    }
    expect(m.perdio).toBe(true);
  });
});

// ── Niveles y efectos (v5, 2026-11-04) ───────────────────────────────────────
const FX = hay ? await import('../../apps/clientes/lib/botiquinEfectos.js') : {};
const { CONF_LIBRE, NIVELES = [], avance, confDeNivel, elegir, estrellasDe } = M;
const { DIBUJO, TOPE_PARTICULAS, ambiente, avanzarEfectos, chispas, crearEfectos, efectoDe, fotoEfectos, fotoPiezas } = FX;

describe2('Botiquín — niveles', () => {
  it('cada nivel deja margen: límite > 2 estrellas > 3 estrellas', () => {
    for (const nv of NIVELES) { expect(nv.limite).toBeGreaterThan(nv.tope[0]); expect(nv.tope[0]).toBeGreaterThan(nv.tope[1]); }
  });
  it('estrellas según piezas usadas', () => {
    const t = NIVELES[0].tope;
    expect(estrellasDe(1, t[1])).toBe(3);
    expect(estrellasDe(1, t[1] + 1)).toBe(2);
    expect(estrellasDe(1, t[0] + 1)).toBe(1);
  });
  it('un nivel sin gérmenes nunca da un germen ni un gel', () => {
    const m = crearMundo(3, confDeNivel(1));
    for (let i = 0; i < 300; i++) { m.soltadas = i; const p = elegir(m); expect(p.tipo).toBe('med'); }
  });
  it('el juego libre trae gérmenes antes que la conf de siempre', () => {
    const cuenta = (conf, semilla) => { const m = crearMundo(semilla, conf); let n = 0; for (let i = 0; i < 12; i++) { m.soltadas = i; if (elegir(m).tipo === 'germen') n++; } return n; };
    let libre = 0; let base = 0;
    for (let s = 1; s <= 200; s++) { libre += cuenta(CONF_LIBRE, s * 7919); base += cuenta(undefined, s * 7919); }
    expect(libre).toBeGreaterThan(base);
  });
  it('avance de cada tipo de meta', () => {
    const m = crearMundo(1);
    m.mayor = 3; m.limpiados = 2; m.rachaMax = 2; m.puntos = 500;
    expect(avance(m, { tipo: 'pieza', n: 6 })).toBeCloseTo(0.5);
    expect(avance(m, { tipo: 'limpiar', n: 4 })).toBeCloseTo(0.5);
    expect(avance(m, { tipo: 'cadena', n: 4 })).toBeCloseTo(0.5);
    expect(avance(m, { tipo: 'puntos', n: 1000 })).toBeCloseTo(0.5);
    m.mayor = 6;
    expect(avance(m, { tipo: 'pieza', n: 6 })).toBe(1);
  });
});

describe2('Botiquín — efectos', () => {
  it('nunca pasa del tope de partículas', () => {
    const fx = crearEfectos();
    for (let i = 0; i < 50; i++) chispas(fx, 100, 100, i % 15, 40, 1);
    expect(fx.parts.length).toBe(TOPE_PARTICULAS);
    expect(fotoEfectos(fx).p.length).toBe(TOPE_PARTICULAS * 8);
  });
  it('todo efecto se apaga solo', () => {
    const fx = crearEfectos();
    for (const tipo of ['junta', 'cumbre']) efectoDe(fx, { tipo, n: 7, x: 100, y: 100, radio: 60, racha: 3, a: [6, 90, 100, 0, 1], b: [6, 110, 100, 0, 1] });
    efectoDe(fx, { tipo: 'gel', x: 100, y: 100 });
    efectoDe(fx, { tipo: 'contagio', x: 100, y: 100, desde: { x: 120, y: 140 } });
    efectoDe(fx, { tipo: 'golpe', fuerza: 0.9, x: 10, y: 10, img: 2 });
    expect(fx.parts.length + fx.ondas.length + fx.rayos.length + fx.fantasmas.length).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) avanzarEfectos(fx, 1 / 60);
    expect(fx.parts.length + fx.ondas.length + fx.rayos.length + fx.destellos.length + fx.fantasmas.length).toBe(0);
    expect(fx.temblor).toBe(0);
  });
  it('con movimiento reducido no hay ambiente ni ondas', () => {
    const fx = crearEfectos({ quieto: true });
    const m = crearMundo(2); agregar(m, { tipo: 'germen', n: 0 }, 100, 300);
    for (let i = 0; i < 120; i++) ambiente(fx, m, 1 / 60);
    efectoDe(fx, { tipo: 'gel', x: 100, y: 100 });
    expect(fx.ondas.length).toBe(0);
    expect(fx.parts.length).toBeLessThan(20);
  });
  it('la foto de las piezas: 8 números por pieza y un dibujo por imagen', () => {
    const m = crearMundo(2); agregar(m, 3, 100, 300); agregar(m, { tipo: 'germen', n: 1 }, 200, 300);
    expect(fotoPiezas(m, crearEfectos(), true)).toHaveLength(16);
    expect(DIBUJO).toHaveLength(15);
  });
});
