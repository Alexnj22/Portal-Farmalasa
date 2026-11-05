// El motor del Botiquín (Bienestar): medicamentos que caen en un botiquín y,
// cuando dos iguales se tocan, se juntan en el siguiente de la cadena.
//
// La física es Matter.js (JavaScript puro, sin nada nativo). La primera versión
// tenía un motor propio de círculos y el usuario la encontró «injugable»; la
// segunda ya usaba Matter pero todo era redondo y el usuario pidió (2026-11-04)
// «que parezcan pastillas… agregar cosas malas… el juego se hace eterno… que
// se sienta más fluido». Por eso ahora:
//   · cada pieza tiene SU forma: tableta y efervescente redondas, gragea,
//     cápsula y perla con forma de cápsula, blíster, frasco, caja y botiquín
//     como cajas de esquinas redondeadas. Ruedan, se acuestan y se traban
//     distinto, y eso es lo que hace que no sea lineal;
//   · hay gérmenes (lo malo): caen de vez en cuando, ocupan lugar y dos iguales
//     se juntan en uno más grande. Una unión de medicamentos cerca los elimina,
//     y el gel antibacterial (lo bueno) estalla y limpia los de alrededor;
//   · la dificultad sube con las piezas soltadas: más gérmenes cuanto más dura
//     la partida, así una partida no se hace eterna;
//   · cada unión empuja a las vecinas hacia afuera y los golpes fuertes aplastan
//     un instante la pieza (eso lo dibuja la pantalla con `golpe`).
//
// Unidades: el hueco mide CAJA.ANCHO × CAJA.ALTO, su esquina de arriba a la
// izquierda es (0, 0) e y crece hacia abajo. Pasos FIJOS de 1/120 s: el mismo
// resultado a 60 o a 120 Hz y un cuadro lento no hace atravesar nada.
import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

export const CAJA = { ANCHO: 370, ALTO: 420, PARED: 22, ARRIBA: 40 };

/**
 * La forma de cada nivel. Las áreas crecen ~1.42× por nivel, como en los
 * juegos de este tipo: así dos iguales juntas ocupan algo menos que la nueva y
 * unir siempre libera lugar.
 */
export const FORMAS = [
  { tipo: 'circulo', r: 17 }, //            0 · tableta
  { tipo: 'capsula', w: 49, h: 30 }, //     1 · gragea
  { tipo: 'capsula', w: 73, h: 27 }, //     2 · cápsula
  { tipo: 'capsula', w: 68, h: 44 }, //     3 · perla
  { tipo: 'circulo', r: 34 }, //            4 · efervescente
  { tipo: 'capsula', w: 115, h: 50 }, //    5 · microgránulos
  { tipo: 'caja', w: 108, h: 72, cr: 14 }, // 6 · blíster
  { tipo: 'caja', w: 82, h: 126, cr: 18 }, // 7 · frasco
  { tipo: 'caja', w: 148, h: 100, cr: 12 }, // 8 · caja
  { tipo: 'caja', w: 168, h: 124, cr: 18 }, // 9 · botiquín
  { tipo: 'circulo', r: 96 }, //            10 · sello Farmasalud
];
export const MAX = FORMAS.length - 1;
export const GERMENES = [{ tipo: 'circulo', r: 19 }, { tipo: 'circulo', r: 28 }, { tipo: 'circulo', r: 38 }];
export const GEL = { tipo: 'circulo', r: 20 };

/** Índice de imagen de cada cosa: medicamentos 0-10, gérmenes 11-13, gel 14. */
export const IMG_GERMEN = FORMAS.length;
export const IMG_GEL = FORMAS.length + GERMENES.length;
export const TOTAL_IMG = IMG_GEL + 1;
export function formaDe(p) {
  if (p.tipo === 'germen') return GERMENES[p.n];
  if (p.tipo === 'gel') return GEL;
  return FORMAS[p.n];
}
export function imagenDe(p) {
  if (p.tipo === 'germen') return IMG_GERMEN + p.n;
  if (p.tipo === 'gel') return IMG_GEL;
  return p.n;
}
/** Ancho y alto de una forma sin girar. */
export function medidas(f) {
  return f.tipo === 'circulo' ? { w: f.r * 2, h: f.r * 2 } : { w: f.w, h: f.h };
}

/** Sólo las cinco más chicas caen al azar; el resto se gana juntando. */
export const AL_AZAR = 5;
export const Y_SOLTAR = -66;
/** Lo que se ve por encima del hueco: la pieza que cuelga y su aire. */
export const ZONA_ARRIBA = 118;
export const PAUSA_SOLTAR = 0.4;
/** Cuánto puede quedar algo asomado sobre el borde antes de perder. */
export const ESPERA_PERDER = 1.8;
export const AVISO_PELIGRO = 0.4;
export const PREMIO_CUMBRE = 300;
const DT = 1 / 120;
const PASOS_MAX = 6;
const CRECER = 0.14;
const RACHA = 1.3; // segundos entre uniones para que cuenten como cadena
const RADIO_GEL = 120;
/** Un germen que nadie limpia crece solo; el más grande contagia uno nuevo. */
const GERMEN_CRECE = 8;
const GERMEN_CONTAGIA = 9;
const MAX_GERMENES = 7;

/** Puntos por formar el nivel n: 1, 3, 6, 10, 15… */
export function puntosDe(n) {
  return ((n + 1) * (n + 2)) / 2;
}

function azar(m) {
  m.semilla = (m.semilla * 16807) % 2147483647;
  return (m.semilla - 1) / 2147483646;
}

/**
 * La próxima pieza. Las primeras seis son siempre medicamentos; después los
 * gérmenes aparecen cada vez más seguido (hasta uno de cada tres), nunca dos
 * seguidos. El gel aparece cuando hay al menos tres gérmenes en la caja y hace
 * rato que no sale uno. Calibrado con el banco de pruebas: el jugador
 * automático —que apunta mejor que una persona— dura ~200 piezas.
 */
export function elegir(m) {
  const s = m.soltadas;
  const germenes = m.germenesVivos || 0;
  if (s >= 10 && germenes >= 3 && s - m.ultimoGel >= 14 && azar(m) < 0.35) { m.ultimoGel = s; return { tipo: 'gel', n: 0 }; }
  const pGermen = s < 6 ? 0 : Math.min(0.4, 0.12 + (s - 6) * 0.008);
  if (!m.ultimaFueGermen && azar(m) < pGermen) { m.ultimaFueGermen = true; return { tipo: 'germen', n: 0 }; }
  m.ultimaFueGermen = false;
  const pesos = [5, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < AL_AZAR; i++) total += pesos[i];
  let k = azar(m) * total;
  for (let i = 0; i < AL_AZAR; i++) { k -= pesos[i]; if (k < 0) return { tipo: 'med', n: i }; }
  return { tipo: 'med', n: 0 };
}

const MATERIAL = {
  med: { restitution: 0.18, friction: 0.06, frictionStatic: 0.3, frictionAir: 0.005, density: 0.0012, slop: 0.02 },
  germen: { restitution: 0.3, friction: 0.12, frictionStatic: 0.5, frictionAir: 0.01, density: 0.0009, slop: 0.02 },
  gel: { restitution: 0.4, friction: 0.02, frictionStatic: 0.1, frictionAir: 0.004, density: 0.001, slop: 0.02 },
};

function cuerpo(f, x, y, opciones) {
  if (f.tipo === 'circulo') return Bodies.circle(x, y, f.r, opciones);
  const radio = f.tipo === 'capsula' ? f.h / 2 - 0.05 : f.cr;
  return Bodies.rectangle(x, y, f.w, f.h, { ...opciones, chamfer: { radius: radio, quality: 8 } });
}

export function crearMundo(semilla = 1) {
  const engine = Engine.create({
    gravity: { x: 0, y: 1, scale: 0.0019 },
    positionIterations: 10,
    velocityIterations: 8,
    enableSleeping: false,
  });
  const { ANCHO, ALTO } = CAJA;
  const G = 200;
  const alto = ALTO + 1600; // paredes altas: nada se sale por los costados, sólo se asoma por arriba
  const fijo = { isStatic: true, friction: 0.15, restitution: 0.1, label: 'pared' };
  Composite.add(engine.world, [
    Bodies.rectangle(-G / 2, ALTO - alto / 2, G, alto, fijo),
    Bodies.rectangle(ANCHO + G / 2, ALTO - alto / 2, G, alto, fijo),
    Bodies.rectangle(ANCHO / 2, ALTO + G / 2, ANCHO + G * 2, G, fijo),
  ]);
  const m = {
    engine, t: 0, acum: 0, puntos: 0, mayor: 0, uniones: 0, soltadas: 0, limpiados: 0,
    eventos: [], anillos: [], contactos: [], peligro: 0, perdio: false, ultimaSoltada: -10,
    racha: 0, ultimaUnion: -10, ultimoGel: -100, ultimaFueGermen: false, germenesVivos: 0,
    semilla: Math.max(1, Math.floor(semilla) % 2147483646), actual: null, siguiente: null,
  };
  m.actual = elegir(m);
  m.siguiente = elegir(m);
  const alChocar = (nuevo) => (ev) => {
    for (const p of ev.pairs) {
      const a = p.bodyA; const b = p.bodyB;
      const pa = a.plugin; const pb = b.plugin;
      if (pa.tipo) pa.toco = true;
      if (pb.tipo) pb.toco = true;
      if (nuevo) {
        // Un golpe fuerte aplasta un instante a las dos (lo dibuja la pantalla).
        const dv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (dv > 2.2) {
          const g = Math.min(1, (dv - 2) / 7);
          if (pa.tipo) pa.golpe = Math.max(pa.golpe, g);
          if (pb.tipo) pb.golpe = Math.max(pb.golpe, g);
          if (dv > 4 && m.t - (m.ultimoGolpe || 0) > 0.08) { m.ultimoGolpe = m.t; m.eventos.push({ tipo: 'golpe', fuerza: g }); }
        }
      }
      if (pa.tipo === 'gel' || pb.tipo === 'gel') { m.contactos.push(pa.tipo === 'gel' ? a : b, null); continue; }
      if (pa.tipo && pa.tipo === pb.tipo && pa.n === pb.n) m.contactos.push(a, b);
    }
  };
  // `collisionActive` también: dos iguales que quedan juntas porque otra unión
  // las empujó una contra otra no generan un choque nuevo, y tienen que unirse.
  Events.on(engine, 'collisionStart', alChocar(true));
  Events.on(engine, 'collisionActive', alChocar(false));
  return m;
}

function crear(m, pieza, x, y, escala = 1) {
  const f = formaDe(pieza);
  const b = cuerpo(f, x, y, { ...MATERIAL[pieza.tipo], label: pieza.tipo });
  b.plugin = { tipo: pieza.tipo, n: pieza.n, nace: m.t, toco: false, arriba: 0, fuera: false, junta: false, esc: 1, golpe: 0, madura: 0 };
  if (pieza.tipo === 'germen') b.plugin.madura = m.t + (pieza.n === GERMENES.length - 1 ? GERMEN_CONTAGIA : GERMEN_CRECE) + azar(m) * 4;
  if (escala !== 1) { Body.scale(b, escala, escala); b.plugin.esc = escala; }
  Composite.add(m.engine.world, b);
  if (pieza.tipo === 'germen') m.germenesVivos++;
  return b;
}
function quitar(m, b) {
  if (b.plugin.fuera) return;
  b.plugin.fuera = true;
  if (b.plugin.tipo === 'germen') m.germenesVivos--;
  Composite.remove(m.engine.world, b);
}

/** Todo lo que está en la caja (sin las paredes). */
export function piezas(m) {
  return Composite.allBodies(m.engine.world).filter((b) => b.plugin && b.plugin.tipo);
}

/** Agrega una pieza sin reglas de juego (lo usan las pruebas). `pieza` = número o { tipo, n }. */
export function agregar(m, pieza, x, y) {
  return crear(m, typeof pieza === 'number' ? { tipo: 'med', n: pieza } : pieza, x, y);
}

export function puedeSoltar(m) {
  return !m.perdio && m.t - m.ultimaSoltada >= PAUSA_SOLTAR;
}

/** Suelta la pieza actual en x (0..ANCHO) y saca la siguiente. Devuelve el cuerpo o null. */
export function soltar(m, x) {
  if (!puedeSoltar(m)) return null;
  const { w } = medidas(formaDe(m.actual));
  const b = crear(m, m.actual, Math.min(CAJA.ANCHO - w / 2 - 0.5, Math.max(w / 2 + 0.5, x)), Y_SOLTAR);
  // Un giro leve: las alargadas no caen todas igual de planas.
  Body.setAngularVelocity(b, (azar(m) - 0.5) * 0.03);
  m.ultimaSoltada = m.t;
  m.soltadas++;
  m.actual = m.siguiente;
  m.siguiente = elegir(m);
  return b;
}

// Empuja hacia afuera lo que está cerca de una unión o un estallido.
function empujar(m, x, y, alcance, fuerza) {
  for (const b of piezas(m)) {
    const dx = b.position.x - x; const dy = b.position.y - y; const d = Math.hypot(dx, dy);
    if (d < 1 || d > alcance) continue;
    const k = fuerza * (1 - d / alcance) / d;
    Body.setVelocity(b, { x: b.velocity.x + dx * k, y: b.velocity.y + dy * k - fuerza * 0.15 });
  }
}

function limpiarCerca(m, x, y, alcance, motivo) {
  let n = 0;
  for (const b of piezas(m)) {
    if (b.plugin.tipo !== 'germen' || b.plugin.fuera) continue;
    if (Math.hypot(b.position.x - x, b.position.y - y) > alcance + GERMENES[b.plugin.n].r) continue;
    quitar(m, b);
    const p = 8 * (b.plugin.n + 1);
    m.puntos += p; m.limpiados++; n++;
    m.eventos.push({ tipo: 'limpia', x: b.position.x, y: b.position.y, n: b.plugin.n, puntos: p, motivo });
    m.anillos.push({ x: b.position.x, y: b.position.y, r: GERMENES[b.plugin.n].r, t: m.t, n: -1 });
  }
  return n;
}

function unir(m) {
  if (!m.contactos.length) return;
  const lista = m.contactos; m.contactos = [];
  for (let i = 0; i < lista.length; i += 2) {
    const a = lista[i]; const b = lista[i + 1];
    if (a.plugin.fuera || (b && b.plugin.fuera)) continue;
    if (!b) { // el gel tocó algo: estalla
      const { x, y } = a.position;
      quitar(m, a);
      const n = limpiarCerca(m, x, y, RADIO_GEL, 'gel');
      m.eventos.push({ tipo: 'gel', x, y, limpiados: n });
      m.anillos.push({ x, y, r: RADIO_GEL * 0.5, t: m.t, n: -2 });
      empujar(m, x, y, RADIO_GEL, 3);
      continue;
    }
    const tipo = a.plugin.tipo; const n = a.plugin.n;
    if (tipo === 'germen' && n + 1 >= GERMENES.length) continue; // los más grandes ya no crecen
    quitar(m, a); quitar(m, b);
    const x = (a.position.x + b.position.x) / 2;
    const y = Math.max(a.position.y, b.position.y) * 0.6 + Math.min(a.position.y, b.position.y) * 0.4;
    const ang = (a.angle + b.angle) / 2;
    if (tipo === 'germen') {
      // Lo malo: dos gérmenes iguales se juntan en uno más grande.
      const c = crear(m, { tipo: 'germen', n: n + 1 }, x, y, 0.6);
      c.plugin.junta = true; c.plugin.toco = true;
      m.eventos.push({ tipo: 'germen', x, y, n: n + 1 });
      continue;
    }
    m.uniones++;
    m.racha = m.t - m.ultimaUnion < RACHA ? m.racha + 1 : 1;
    m.ultimaUnion = m.t;
    const mult = Math.min(3, 1 + (m.racha - 1) * 0.5);
    if (n === MAX) {
      const p = Math.round(PREMIO_CUMBRE * mult);
      m.puntos += p;
      m.eventos.push({ tipo: 'cumbre', n, x, y, puntos: p, racha: m.racha });
      m.anillos.push({ x, y, r: 110, t: m.t, n });
      limpiarCerca(m, x, y, 200, 'cumbre');
      empujar(m, x, y, 260, 6);
      continue;
    }
    const nuevo = n + 1;
    const p = Math.round(puntosDe(nuevo) * mult);
    m.puntos += p;
    if (nuevo > m.mayor) m.mayor = nuevo;
    // Nace chica y crece: entera se metería dentro de las vecinas y el motor
    // las expulsaría de un golpe.
    const c = crear(m, { tipo: 'med', n: nuevo }, x, y, 0.55);
    Body.setAngle(c, ang);
    c.plugin.junta = true; c.plugin.toco = true;
    Body.setVelocity(c, { x: (a.velocity.x + b.velocity.x) / 2, y: Math.min(a.velocity.y, b.velocity.y) / 2 });
    const { w, h } = medidas(FORMAS[nuevo]);
    const radio = Math.max(w, h) / 2;
    m.eventos.push({ tipo: 'junta', n: nuevo, x, y, puntos: p, racha: m.racha });
    m.anillos.push({ x, y, r: radio, t: m.t, n: nuevo });
    // Una unión barre los gérmenes que la rozan y sacude a las vecinas.
    // Cuenta desde las DOS piezas que se unieron, no sólo desde el centro: con
    // una cápsula alargada, el germen que la toca en una punta queda lejos del medio.
    const rUna = Math.max(...Object.values(medidas(FORMAS[n]))) / 2;
    limpiarCerca(m, a.position.x, a.position.y, rUna + 10, 'union');
    limpiarCerca(m, b.position.x, b.position.y, rUna + 10, 'union');
    limpiarCerca(m, x, y, radio + 8, 'union');
    empujar(m, x, y, radio + 70, 1.6 + nuevo * 0.22);
  }
}

function crecer(m, lista) {
  for (const b of lista) {
    const p = b.plugin;
    if (p.golpe > 0) p.golpe = p.golpe < 0.02 ? 0 : p.golpe * 0.9;
    if (p.esc >= 1) continue;
    const q = Math.min(1, (m.t - p.nace) / CRECER);
    const e = Math.min(1, 0.55 + 0.45 * q);
    Body.scale(b, e / p.esc, e / p.esc);
    p.esc = e;
  }
}

function revisarPerdida(m, lista) {
  let peor = 0;
  for (const b of lista) {
    const p = b.plugin;
    // La que viene cayendo no cuenta: sólo lo que ya tocó algo y quedó asomado.
    if (p.toco && b.bounds.min.y < 0) p.arriba += DT; else p.arriba = 0;
    if (p.arriba > peor) peor = p.arriba;
  }
  m.peligro = peor;
  if (peor >= ESPERA_PERDER) m.perdio = true;
}

// Lo malo que pasa solo: un germen que nadie limpió crece en su lugar, y el
// más grande contagia uno chico encima. Es lo que le pone fin a una partida
// que de otro modo se hace eterna (pedido del usuario), y premia limpiar rápido.
function infectar(m, lista) {
  for (const b of lista) {
    const p = b.plugin;
    if (p.tipo !== 'germen' || p.fuera || !p.toco || m.t < p.madura) continue;
    if (p.n < GERMENES.length - 1) {
      quitar(m, b);
      const c = crear(m, { tipo: 'germen', n: p.n + 1 }, b.position.x, b.position.y, GERMENES[p.n].r / GERMENES[p.n + 1].r);
      c.plugin.toco = true; c.plugin.junta = true;
      Body.setAngle(c, b.angle);
      m.eventos.push({ tipo: 'germen', x: b.position.x, y: b.position.y, n: p.n + 1, solo: true });
    } else {
      p.madura = m.t + GERMEN_CONTAGIA + azar(m) * 4;
      if (m.germenesVivos >= MAX_GERMENES) continue;
      const r = GERMENES[p.n].r + GERMENES[0].r + 2;
      const a = -Math.PI / 2 + (azar(m) - 0.5) * 1.6;
      const x = Math.min(CAJA.ANCHO - 20, Math.max(20, b.position.x + Math.cos(a) * r));
      const c = crear(m, { tipo: 'germen', n: 0 }, x, b.position.y + Math.sin(a) * r, 0.5);
      c.plugin.toco = true; c.plugin.junta = true;
      m.eventos.push({ tipo: 'contagio', x, y: b.position.y + Math.sin(a) * r, n: 0 });
    }
  }
}

export function paso(m) {
  Engine.update(m.engine, DT * 1000);
  m.t += DT;
  unir(m);
  let lista = piezas(m);
  if (m.germenesVivos) { infectar(m, lista); lista = piezas(m); }
  crecer(m, lista);
  revisarPerdida(m, lista);
  if (m.anillos.length && m.t - m.anillos[0].t > 0.8) m.anillos = m.anillos.filter((a) => m.t - a.t <= 0.8);
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
