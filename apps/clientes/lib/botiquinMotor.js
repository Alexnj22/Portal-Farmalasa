// El motor del Botiquín (Bienestar): medicamentos que caen en un botiquín y,
// cuando dos iguales se tocan, se juntan en el siguiente de la cadena.
//
// La física es Matter.js y no un motor propio. La primera versión (build 94-95)
// tenía un motor de ~280 líneas escrito acá y el usuario la encontró
// «injugable»: sin rotación ni fricción las piezas resbalaban como discos de
// hockey, no rodaban ni se acomodaban. Matter resuelve contactos apilados con
// varias iteraciones, fricción estática y giro, que es exactamente lo que hace
// que una pila se sienta de verdad. Es JavaScript puro (~80 kB), sin nada nativo.
//
// Unidades: el hueco del botiquín mide CAJA.ANCHO × CAJA.ALTO y su esquina de
// arriba a la izquierda es (0, 0); y crece hacia abajo. Todo el dibujo escala
// desde acá, así que la física es idéntica en cualquier teléfono.
//
// Corre en JavaScript, en pasos FIJOS de 1/120 s: el mismo resultado a 60 o a
// 120 Hz de pantalla, y un cuadro lento no hace que una pieza atraviese a otra.
import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

export const CAJA = { ANCHO: 400, ALTO: 500, PARED: 22, ARRIBA: 40 };
/** Radio de cada nivel, de la Pastilla a la Cruz de farmacia. */
export const RADIOS = [15, 20, 26, 31, 38, 46, 54, 63, 72, 82, 94];
export const MAX = RADIOS.length - 1;
/** Sólo las cinco más chicas caen al azar; el resto se gana juntando. */
export const AL_AZAR = 5;
/** Dónde cuelga la pieza antes de soltarla (por encima del borde). */
export const Y_SOLTAR = -78;
/** Lo que se ve por encima del hueco: la pieza que cuelga y su aire. */
export const ZONA_ARRIBA = 130;
export const PAUSA_SOLTAR = 0.45;
/** Cuánto puede quedar algo asomado sobre el borde antes de perder. */
export const ESPERA_PERDER = 2.2;
/** Desde cuánto asomado se avisa. */
export const AVISO_PELIGRO = 0.5;
export const PREMIO_CUMBRE = 150;
const DT = 1 / 120;
const PASOS_MAX = 6; // un cuadro de 50 ms se pone al día; más, se descarta
const CRECER = 0.12; // segundos en que una pieza recién unida llega a su tamaño

/** Puntos por formar el nivel n: 1, 3, 6, 10, 15… */
export function puntosDe(n) {
  return ((n + 1) * (n + 2)) / 2;
}

function azar(m) {
  // Park-Miller con semilla: las pruebas son repetibles.
  m.semilla = (m.semilla * 16807) % 2147483647;
  return (m.semilla - 1) / 2147483646;
}
function elegir(m) {
  // Las más chicas salen un poco más: arranca fácil y se va llenando.
  const pesos = [5, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < AL_AZAR; i++) total += pesos[i];
  let k = azar(m) * total;
  for (let i = 0; i < AL_AZAR; i++) { k -= pesos[i]; if (k < 0) return i; }
  return 0;
}

const OPCIONES = {
  restitution: 0.1,
  friction: 0.08,
  frictionStatic: 0.4,
  frictionAir: 0.006,
  density: 0.0012,
  slop: 0.02,
};

export function crearMundo(semilla = 1) {
  const engine = Engine.create({
    gravity: { x: 0, y: 1, scale: 0.0017 },
    positionIterations: 10,
    velocityIterations: 8,
    enableSleeping: false,
  });
  const { ANCHO, ALTO } = CAJA;
  const G = 200; // paredes gruesas: nada las atraviesa aunque vaya rápido
  const alto = ALTO + 1600; // y altas: nada se sale por los costados, sólo se asoma por arriba
  const fijo = { isStatic: true, friction: 0.3, restitution: 0.05, label: 'pared' };
  Composite.add(engine.world, [
    Bodies.rectangle(-G / 2, ALTO - alto / 2, G, alto, fijo),
    Bodies.rectangle(ANCHO + G / 2, ALTO - alto / 2, G, alto, fijo),
    Bodies.rectangle(ANCHO / 2, ALTO + G / 2, ANCHO + G * 2, G, fijo),
  ]);
  const m = {
    engine, t: 0, acum: 0, puntos: 0, mayor: 0, uniones: 0,
    eventos: [], anillos: [], parejas: [], peligro: 0, perdio: false, ultimaSoltada: -10,
    semilla: Math.max(1, Math.floor(semilla) % 2147483646), actual: 0, siguiente: 0,
  };
  m.actual = elegir(m);
  m.siguiente = elegir(m);
  const alChocar = (ev) => {
    for (const p of ev.pairs) {
      const a = p.bodyA; const b = p.bodyB;
      if (a.plugin.n != null) a.plugin.toco = true;
      if (b.plugin.n != null) b.plugin.toco = true;
      if (a.plugin.n != null && a.plugin.n === b.plugin.n) m.parejas.push(a, b);
    }
  };
  // `collisionActive` también: dos iguales que quedan juntas porque otra unión
  // las empujó una contra otra no generan un choque NUEVO, y tienen que unirse.
  Events.on(engine, 'collisionStart', alChocar);
  Events.on(engine, 'collisionActive', alChocar);
  return m;
}

function crearPieza(m, n, x, y, radio = RADIOS[n]) {
  const b = Bodies.circle(x, y, radio, { ...OPCIONES, label: 'pieza' });
  b.plugin = { n, nace: m.t, toco: false, arriba: 0, fuera: false, junta: false };
  Composite.add(m.engine.world, b);
  return b;
}

/** Las piezas vivas, en el orden en que se agregaron. */
export function piezas(m) {
  return Composite.allBodies(m.engine.world).filter((b) => b.plugin && b.plugin.n != null);
}

/** Agrega una pieza sin reglas de juego (lo usan las pruebas). */
export function agregar(m, n, x, y) {
  return crearPieza(m, n, x, y);
}

export function puedeSoltar(m) {
  return !m.perdio && m.t - m.ultimaSoltada >= PAUSA_SOLTAR;
}

/** Suelta la pieza actual en x (0..ANCHO) y saca la siguiente. Devuelve el cuerpo o null. */
export function soltar(m, x) {
  if (!puedeSoltar(m)) return null;
  const r = RADIOS[m.actual];
  const b = crearPieza(m, m.actual, Math.min(CAJA.ANCHO - r - 0.5, Math.max(r + 0.5, x)), Y_SOLTAR);
  m.ultimaSoltada = m.t;
  m.actual = m.siguiente;
  m.siguiente = elegir(m);
  return b;
}

function unir(m) {
  if (!m.parejas.length) return;
  const lista = m.parejas; m.parejas = [];
  for (let i = 0; i < lista.length; i += 2) {
    const a = lista[i]; const b = lista[i + 1];
    if (a.plugin.fuera || b.plugin.fuera) continue;
    a.plugin.fuera = true; b.plugin.fuera = true;
    Composite.remove(m.engine.world, a);
    Composite.remove(m.engine.world, b);
    const n = a.plugin.n;
    // Nace en el punto de contacto, pesado hacia la más baja: así la pila no
    // «salta» hacia arriba cuando se une algo.
    const x = (a.position.x + b.position.x) / 2;
    const y = Math.max(a.position.y, b.position.y) * 0.6 + Math.min(a.position.y, b.position.y) * 0.4;
    m.uniones++;
    if (n === MAX) {
      m.puntos += PREMIO_CUMBRE;
      m.eventos.push({ tipo: 'cumbre', n, x, y, puntos: PREMIO_CUMBRE });
      m.anillos.push({ x, y, r: RADIOS[n] * 1.3, t: m.t, n });
      continue;
    }
    const nuevo = n + 1;
    const p = puntosDe(nuevo);
    m.puntos += p;
    if (nuevo > m.mayor) m.mayor = nuevo;
    // Nace chica y crece en CRECER s: si naciera entera se metería dentro de
    // las vecinas y el motor las expulsaría de un golpe (la pila «explota»).
    const c = crearPieza(m, nuevo, x, y, RADIOS[nuevo] * 0.55);
    c.plugin.junta = true;
    c.plugin.toco = true;
    Body.setVelocity(c, { x: (a.velocity.x + b.velocity.x) / 2, y: Math.min(a.velocity.y, b.velocity.y) / 2 });
    m.eventos.push({ tipo: 'junta', n: nuevo, x, y, puntos: p });
    m.anillos.push({ x, y, r: RADIOS[nuevo], t: m.t, n: nuevo });
  }
}

function crecer(m, lista) {
  for (const b of lista) {
    const meta = RADIOS[b.plugin.n];
    if (b.circleRadius >= meta - 0.01) continue;
    const q = Math.min(1, (m.t - b.plugin.nace) / CRECER);
    const r = Math.min(meta, meta * (0.55 + 0.45 * q));
    Body.scale(b, r / b.circleRadius, r / b.circleRadius);
  }
}

function revisarPerdida(m, lista) {
  let peor = 0;
  for (const b of lista) {
    const p = b.plugin;
    // La que viene cayendo no cuenta: sólo lo que ya tocó algo y quedó asomado.
    if (p.toco && b.position.y - b.circleRadius < 0) p.arriba += DT; else p.arriba = 0;
    if (p.arriba > peor) peor = p.arriba;
  }
  m.peligro = peor;
  if (peor >= ESPERA_PERDER) m.perdio = true;
}

export function paso(m) {
  Engine.update(m.engine, DT * 1000);
  m.t += DT;
  unir(m);
  const lista = piezas(m);
  crecer(m, lista);
  revisarPerdida(m, lista);
  if (m.anillos.length && m.t - m.anillos[0].t > 0.7) m.anillos = m.anillos.filter((a) => m.t - a.t <= 0.7);
}

/** Avanza el tiempo de un cuadro (`dt` en segundos). Devuelve cuántos pasos dio. */
export function avanzar(m, dt) {
  if (m.perdio) return 0;
  m.acum += Math.min(Math.max(0, dt), PASOS_MAX * DT);
  let k = 0;
  while (m.acum >= DT && k < PASOS_MAX) { paso(m); m.acum -= DT; k++; if (m.perdio) break; }
  if (m.acum >= DT) m.acum = 0;
  return k;
}

/** Energía cinética total (las pruebas miran que la pila se calme). */
export function energia(m) {
  let e = 0;
  for (const b of piezas(m)) e += 0.5 * b.mass * b.speed * b.speed;
  return e;
}

/** Borra el mundo (los eventos de Matter guardan referencias). */
export function destruir(m) {
  if (!m) return;
  Events.off(m.engine);
  Composite.clear(m.engine.world, false);
  Engine.clear(m.engine);
}
