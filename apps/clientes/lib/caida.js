// El motor de física de «Pastillero» (Bienestar, 2026-11-04). Pedido del
// usuario: un juego de «juntar al caer» —caen medicamentos en un botiquín
// abierto arriba, dos iguales que se tocan se vuelven el siguiente— con física
// propia y simple, sin librerías nuevas.
//
// Por qué propio y no una librería: hacen falta círculos, paredes y un fondo,
// nada más. Un motor general (cuerpos rígidos con rotación real, polígonos,
// juntas) pesa cientos de kB y corre en JavaScript; éste son ~200 líneas que
// corren en el hilo de la interfaz como worklets (cada función lleva
// 'worklet'), al lado del dibujo, sin cruzar de hilo en cada cuadro. Fuera de
// la app (las pruebas de vitest) la directiva es sólo un texto y no hace nada.
//
// El mundo se mide en ANCHOS DE BOTIQUÍN: el interior va de x=0 a x=1, el
// borde de arriba es y=0 y el fondo y=alto (y crece hacia abajo, como la
// pantalla). Así la física no depende del tamaño del teléfono: la pantalla
// sólo multiplica por su escala al dibujar.
//
// Paso fijo (1/120 s) con acumulador: con un `dt` variable la pila tiembla
// distinto en cada teléfono y un cuadro lento (60→20 fps) hace que todo salte.
// En cada paso: gravedad e integración (Euler semi-implícito), y luego varias
// pasadas de contactos — corregir la penetración sin agregar velocidad (así
// una fusión que nace encimada no «explota»), rebote amortiguado sobre la
// normal y fricción de Coulomb sobre la tangente.

/** Los radios de la cadena, en anchos de botiquín (crecen ~20% por nivel). */
export const RADIOS = [0.042, 0.054, 0.068, 0.084, 0.102, 0.122, 0.145, 0.170, 0.198, 0.230];
export const MAX = RADIOS.length - 1;
/** Sólo los cinco más chicos salen al azar; el resto se gana juntando. */
export const AL_AZAR = 5;
// Pesos del azar: más de los chicos, para que haya parejas a menudo.
const PESOS = [30, 26, 20, 14, 10];

export const DT = 1 / 120;
const PASOS_MAX = 6; // un cuadro de 50 ms se pone al día; más, se descarta
const GRAVEDAD = 5.2; // anchos/s²: cae con peso pero se alcanza a seguir con la vista
const ITERACIONES = 4;
const REBOTE = 0.12;
const FRICCION = 0.32;
const AMORT = Math.exp(-0.7 * DT); // el aire: la pila se calma sola
const CORRIGE = 0.6; // fracción de la penetración que se corrige por pasada
const HOLGURA = 0.0015; // penetración que se tolera (evita el temblor de la pila)
const TOCA = 0.003; // dos iguales «se tocan» con esta distancia de sobra
const VEL_MAX = 4.5; // anchos/s; con DT = 1/120 nada avanza más que el radio más chico
/** Segundos por encima del borde antes de perder (el que acaba de caer no cuenta). */
export const ESPERA_PERDER = 2;
/** Dónde aparece la pieza que se suelta: por encima del borde. */
export const ALTURA_SOLTAR = -0.17;
/** Tiempo mínimo entre dos soltadas, para que no se pueda llover con el dedo. */
export const PAUSA_SOLTAR = 0.42;

/** Puntos por crear el nivel `n` (1, 3, 6, 10…: lo alto vale mucho más). */
export function puntosDe(n) {
  'worklet';
  return ((n + 1) * (n + 2)) / 2;
}
/** Dos del último nivel juntos se van del botiquín y dejan este premio. */
export const PREMIO_CUMBRE = 100;

function azar(m) {
  'worklet';
  // Un generador con semilla (Park-Miller): las pruebas son repetibles y el
  // juego no depende de Math.random en el hilo de la interfaz.
  m.semilla = (m.semilla * 16807) % 2147483647;
  return (m.semilla - 1) / 2147483646;
}

export function elegirAlAzar(m) {
  'worklet';
  let total = 0;
  for (let i = 0; i < AL_AZAR; i++) total += PESOS[i];
  let k = azar(m) * total;
  for (let i = 0; i < AL_AZAR; i++) { k -= PESOS[i]; if (k < 0) return i; }
  return 0;
}

/** Un botiquín vacío. `alto` en anchos (p. ej. 1.3). */
export function crearMundo(alto, semilla = 1) {
  'worklet';
  const m = {
    alto, cuerpos: [], sig: 1, t: 0, acum: 0, puntos: 0, mayor: 0, uniones: 0,
    eventos: [], anillos: [], peligro: 0, perdio: false, ultimaSoltada: -10,
    semilla: Math.max(1, Math.floor(semilla) % 2147483646), actual: 0, siguiente: 0,
  };
  m.actual = elegirAlAzar(m);
  m.siguiente = elegirAlAzar(m);
  return m;
}

/** Agrega un cuerpo de nivel `n` (sin reglas de juego: lo usan las pruebas y `soltar`). */
export function agregar(m, n, x, y, vx = 0, vy = 0) {
  'worklet';
  const r = RADIOS[n];
  const b = { id: m.sig++, n, r, masa: r * r, x: Math.min(1 - r, Math.max(r, x)), y, vx, vy, ang: 0, toco: false, arriba: 0, nace: m.t, fuera: false };
  m.cuerpos.push(b);
  return b;
}

/** ¿Se puede soltar ahora? (una pausa corta entre una y otra). */
export function puedeSoltar(m) {
  'worklet';
  return !m.perdio && m.t - m.ultimaSoltada >= PAUSA_SOLTAR;
}

/** Suelta la pieza actual en x (0..1) y saca la siguiente. Devuelve el cuerpo o null. */
export function soltar(m, x) {
  'worklet';
  if (!puedeSoltar(m)) return null;
  const b = agregar(m, m.actual, x, ALTURA_SOLTAR, 0, 0.4);
  m.ultimaSoltada = m.t;
  m.actual = m.siguiente;
  m.siguiente = elegirAlAzar(m);
  return b;
}

function contactoParedes(m, b) {
  'worklet';
  // Paredes: suben sin fin (nada se escapa por arriba de los costados).
  if (b.x - b.r < 0) {
    b.x = b.r;
    if (b.vx < 0) { const jn = -b.vx; b.vx = jn * REBOTE; b.vy -= Math.sign(b.vy) * Math.min(Math.abs(b.vy), FRICCION * jn * 0.5); }
  } else if (b.x + b.r > 1) {
    b.x = 1 - b.r;
    if (b.vx > 0) { const jn = b.vx; b.vx = -jn * REBOTE; b.vy -= Math.sign(b.vy) * Math.min(Math.abs(b.vy), FRICCION * jn * 0.5); }
  }
  if (b.y + b.r > m.alto) {
    b.y = m.alto - b.r;
    b.toco = true;
    if (b.vy > 0) {
      const jn = b.vy;
      b.vy = jn > 0.08 ? -jn * REBOTE : 0;
      b.vx -= Math.sign(b.vx) * Math.min(Math.abs(b.vx), FRICCION * jn);
    }
  }
}

/** Un paso fijo de física. Las fusiones quedan en `m.eventos`. */
export function paso(m) {
  'worklet';
  const cs = m.cuerpos;
  const n = cs.length;
  m.t += DT;
  for (let i = 0; i < n; i++) {
    const b = cs[i];
    b.vy += GRAVEDAD * DT;
    b.vx *= AMORT; b.vy *= AMORT;
    const v = Math.hypot(b.vx, b.vy);
    if (v > VEL_MAX) { b.vx *= VEL_MAX / v; b.vy *= VEL_MAX / v; }
    b.x += b.vx * DT; b.y += b.vy * DT;
    // Rodar: sólo de adorno (el motor no tiene giro real), proporcional a lo que avanza.
    if (b.toco) b.ang += (b.vx * DT) / b.r;
  }

  let parejas = null;
  for (let it = 0; it < ITERACIONES; it++) {
    for (let i = 0; i < n; i++) {
      const a = cs[i];
      if (a.fuera) continue;
      for (let j = i + 1; j < n; j++) {
        const b = cs[j];
        if (b.fuera) continue;
        const dx = b.x - a.x;
        const rr = a.r + b.r;
        if (dx > rr + TOCA || dx < -rr - TOCA) continue;
        const dy = b.y - a.y;
        if (dy > rr + TOCA || dy < -rr - TOCA) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= (rr + TOCA) * (rr + TOCA)) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const nx = d2 > 0 ? dx / d : 0;
        const ny = d2 > 0 ? dy / d : 1;
        // Dos iguales que se tocan: se anotan una sola vez (la primera pasada).
        if (it === 0 && a.n === b.n) {
          if (!parejas) parejas = [];
          parejas.push(i, j);
        }
        const pen = rr - d;
        if (pen <= 0) continue;
        a.toco = true; b.toco = true;
        const ia = 1 / a.masa; const ib = 1 / b.masa; const is = ia + ib;
        const corr = (Math.max(0, pen - HOLGURA) * CORRIGE) / is;
        a.x -= nx * corr * ia; a.y -= ny * corr * ia;
        b.x += nx * corr * ib; b.y += ny * corr * ib;
        const rvx = b.vx - a.vx; const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const j = (-(1 + REBOTE) * vn) / is;
          a.vx -= j * nx * ia; a.vy -= j * ny * ia;
          b.vx += j * nx * ib; b.vy += j * ny * ib;
          // Fricción: frena el deslizamiento, nunca más que μ·j (Coulomb).
          const tx = -ny; const ty = nx;
          const vt = rvx * tx + rvy * ty;
          let jt = -vt / is;
          const lim = FRICCION * j;
          if (jt > lim) jt = lim; else if (jt < -lim) jt = -lim;
          a.vx -= jt * tx * ia; a.vy -= jt * ty * ia;
          b.vx += jt * tx * ib; b.vy += jt * ty * ib;
        }
      }
    }
    for (let i = 0; i < n; i++) if (!cs[i].fuera) contactoParedes(m, cs[i]);
  }

  if (parejas) fusionar(m, parejas);
  revisarPerdida(m);
}

function fusionar(m, parejas) {
  'worklet';
  const cs = m.cuerpos;
  const nuevos = [];
  for (let k = 0; k < parejas.length; k += 2) {
    const a = cs[parejas[k]]; const b = cs[parejas[k + 1]];
    // Cada cuerpo se une una sola vez por paso: si ya se fue con otro, no cuenta.
    if (a.fuera || b.fuera || a.n !== b.n) continue;
    a.fuera = true; b.fuera = true;
    const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2;
    m.uniones += 1;
    if (a.n === MAX) {
      // Dos del último nivel: se van con un premio y dejan espacio.
      m.puntos += PREMIO_CUMBRE;
      m.eventos.push({ tipo: 'cumbre', n: MAX, x, y, puntos: PREMIO_CUMBRE });
      m.anillos.push({ x, y, r: a.r * 1.4, t: m.t, n: MAX });
      continue;
    }
    const n = a.n + 1;
    const p = puntosDe(n);
    m.puntos += p;
    if (n > m.mayor) m.mayor = n;
    nuevos.push({ n, x, y, vx: (a.vx + b.vx) / 2, vy: Math.min(0, (a.vy + b.vy) / 2) });
    m.eventos.push({ tipo: 'junta', n, x, y, puntos: p });
    m.anillos.push({ x, y, r: RADIOS[n], t: m.t, n });
  }
  m.cuerpos = cs.filter((c) => !c.fuera);
  for (let i = 0; i < nuevos.length; i++) {
    const q = nuevos[i];
    const b = agregar(m, q.n, q.x, q.y, q.vx, q.vy);
    b.toco = true;
    b.junta = true; // nació de una unión: la pantalla le da un saltito
    // El nuevo es más grande: si nació pegado al fondo o a una pared, se
    // acomoda ya (los vecinos se apartan en las pasadas siguientes).
    contactoParedes(m, b);
  }
  // Los anillos duran medio segundo.
  if (m.anillos.length > 12 || (m.anillos.length && m.t - m.anillos[0].t > 0.6)) m.anillos = m.anillos.filter((r) => m.t - r.t <= 0.6);
}

/**
 * Perder: algo que YA tocó la pila (no el que viene cayendo) queda con su
 * parte de arriba por encima del borde durante ESPERA_PERDER segundos
 * seguidos. Si baja, el reloj de ese cuerpo vuelve a cero.
 */
export function revisarPerdida(m) {
  'worklet';
  let peor = 0;
  const cs = m.cuerpos;
  for (let i = 0; i < cs.length; i++) {
    const b = cs[i];
    if (b.toco && b.y - b.r < 0) b.arriba += DT; else b.arriba = 0;
    if (b.arriba > peor) peor = b.arriba;
  }
  m.peligro = peor;
  if (peor >= ESPERA_PERDER) m.perdio = true;
}

/** Avanza el tiempo de un cuadro (`dt` en segundos) en pasos fijos. Devuelve cuántos dio. */
export function avanzar(m, dt) {
  'worklet';
  if (m.perdio) return 0;
  m.acum += Math.min(Math.max(0, dt), PASOS_MAX * DT);
  let k = 0;
  while (m.acum >= DT && k < PASOS_MAX) { paso(m); m.acum -= DT; k++; if (m.perdio) break; }
  if (m.acum >= DT) m.acum = 0;
  return k;
}

/** Energía cinética total (para las pruebas: la pila se calma). */
export function energia(m) {
  'worklet';
  let e = 0;
  for (let i = 0; i < m.cuerpos.length; i++) { const b = m.cuerpos[i]; e += 0.5 * b.masa * (b.vx * b.vx + b.vy * b.vy); }
  return e;
}
