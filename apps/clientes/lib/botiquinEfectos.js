// Los efectos del Botiquín: chispas, ondas, rayos, destellos y las dos piezas
// que se funden. Viven en JavaScript puro (sin React ni Skia) para poder
// probarlos y para que la pantalla sólo dibuje.
//
// Usuario, 2026-11-04, sobre el prototipo HTML aprobado: «necesita más efectos
// de cada elemento… debe ser wow visualmente sin afectar el rendimiento». Por
// eso cada medicamento tiene su firma propia al nacer de una unión (firma), y
// por eso hay un TOPE de partículas vivas: pase lo que pase, el teléfono nunca
// dibuja más que eso.
//
// Lo que cruza al hilo de la interfaz es una foto de puros números
// (fotoEfectos / fotoPiezas). Los colores viajan como índice de COLORES.
import { FORMAS, GERMENES, imagenDe, medidas, piezas } from './botiquinMotor';

export const COLORES = [
  '#FFFFFF', '#E3ECF8', '#FF6FAE', '#FFD3E8', '#E5262D', '#FFC534', '#FFF3B0', '#FFC98A', '#FFD166', '#FF8FB1',
  '#7BDFF2', '#B2F7EF', '#E8EDF4', '#F3A64C', '#8DC311', '#9A1D96', '#F5C542', '#FFF1A8', '#8FD13A', '#C8F56A',
  '#B65CE8', '#EFC0FF', '#F05A44', '#FFB3A3', '#7FD8FF', '#FFD9D9', '#FFE680', '#FFA24D', '#C46B17', '#FFE0B0',
  '#C9F77A', '#E07ADF', '#BFF0FF', '#2BA8E0', '#E0412B', '#F03C28', '#BFE3DF', '#FFE27A', '#A6E22E',
];
const IC = new Map(COLORES.map((c, i) => [c, i]));
/** Índice de un color de COLORES (blanco si no está). */
export const ci = (c) => IC.get(c) ?? 0;

export const FORMA = { punto: 0, estrella: 1, burbuja: 2, chispa: 3, cuadro: 4, cruz: 5, baba: 6, gota: 7, espora: 8, humo: 9, destello: 10 };

// El destello de cada imagen (orden de imagenDe): medicamentos 0-10, gérmenes, gel.
export const ESTILO = [
  { col: ['#FFFFFF', '#E3ECF8'], forma: 'estrella' }, { col: ['#FF6FAE', '#FFD3E8'], forma: 'punto' }, { col: ['#E5262D', '#FFFFFF'], forma: 'chispa' },
  { col: ['#FFC534', '#FFF3B0'], forma: 'estrella' }, { col: ['#FFFFFF', '#FFC98A'], forma: 'burbuja' }, { col: ['#FFD166', '#FF8FB1', '#7BDFF2', '#B2F7EF'], forma: 'punto' },
  { col: ['#E8EDF4', '#FFFFFF', '#FF6FAE'], forma: 'estrella' }, { col: ['#F3A64C', '#FFFFFF'], forma: 'chispa' }, { col: ['#8DC311', '#9A1D96'], forma: 'cuadro' },
  { col: ['#9A1D96', '#8DC311', '#FFFFFF'], forma: 'cruz' }, { col: ['#F5C542', '#FFF1A8', '#FFFFFF'], forma: 'estrella' },
  { col: ['#8FD13A', '#C8F56A'], forma: 'baba' }, { col: ['#B65CE8', '#EFC0FF'], forma: 'baba' }, { col: ['#F05A44', '#FFB3A3'], forma: 'baba' },
  { col: ['#7FD8FF', '#FFFFFF'], forma: 'burbuja' },
];

/** Medida del dibujo de cada imagen en el mundo (la misma regla de scripts/botiquin/arte.mjs). */
export const DIBUJO = [...FORMAS.map(medidas), ...GERMENES.map((g) => ({ w: g.r * 2.5, h: g.r * 2.5 })), { w: 40, h: 40 }];
export const TOPE_PARTICULAS = 320;
const RADIO_GEL = 120;

export function crearEfectos({ quieto = false, oscuro = true } = {}) {
  return { parts: [], ondas: [], rayos: [], destellos: [], fantasmas: [], temblor: 0, dx: 0, dy: 0, marco: 0, marcoCol: 0, quieto, oscuro, reloj: 0, estela: 0 };
}

function particula(fx, p) {
  if (fx.parts.length >= TOPE_PARTICULAS) fx.parts[(Math.random() * fx.parts.length) | 0] = p;
  else fx.parts.push(p);
}

/** Un estallido de n partículas con el estilo de la imagen `img` (o el de `opt`). */
export function chispas(fx, x, y, img, n, fuerza = 1, opt = {}) {
  if (fx.quieto) n = Math.ceil(n / 3);
  const e = ESTILO[img] || ESTILO[0]; const fm = opt.forma || e.forma; const cols = opt.col || e.col;
  const sube = fm === 'burbuja' || fm === 'espora';
  for (let i = 0; i < n; i++) {
    const a = opt.ang != null ? opt.ang + (Math.random() - 0.5) * (opt.abre || 1) : Math.random() * Math.PI * 2;
    const v = (60 + Math.random() * 160) * fuerza;
    particula(fx, {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (sube ? 30 : 60),
      g: opt.g != null ? opt.g : sube ? -120 : fm === 'baba' || fm === 'gota' ? 520 : 380,
      r: (1.6 + Math.random() * 3) * (opt.tam || 1) * (fm === 'estrella' ? 1.6 : 1), col: ci(cols[i % cols.length]), forma: FORMA[fm],
      vida: 1, dur: (opt.dur || 1) * (0.5 + Math.random() * 0.5), giro: Math.random() * 6, vg: (Math.random() - 0.5) * 10, roce: opt.roce || 0,
    });
  }
}
export function onda(fx, x, y, r, color, ancho = 5, dur = 0.5, crece = 0.8) { if (!fx.quieto) fx.ondas.push({ x, y, r, col: ci(color), ancho, dur, crece, t: 0 }); }
export function rayo(fx, x, y, r, color, n = 10, dur = 0.8) { if (!fx.quieto) fx.rayos.push({ x, y, r, col: ci(color), n, dur, t: 0, giro: Math.random() * 6 }); }
export function destello(fx, x, y, r, color, dur = 0.35) { fx.destellos.push({ x, y, r, col: ci(color), dur, t: 0 }); }
const sacudir = (fx, f) => { if (!fx.quieto) fx.temblor = Math.max(fx.temblor, f); };
const encender = (fx, a, color) => { fx.marco = Math.max(fx.marco, a); fx.marcoCol = ci(color); };

/** Lo que hace cada medicamento al nacer de una unión: su propio estallido. */
export function firma(fx, n, x, y, radio) {
  const F = 1 + n * 0.07;
  switch (n) {
    case 1: chispas(fx, x, y, 1, 16, F); chispas(fx, x, y, 0, 6, F * 0.8, { forma: 'estrella', tam: 1.2 }); break;
    case 2: chispas(fx, x, y, 2, 16, F * 1.2, { roce: 0.96 }); chispas(fx, x, y, 2, 10, F * 0.7, { forma: 'punto', col: ['#FFFFFF', '#FFD9D9'], tam: 0.7 }); break;
    case 3: chispas(fx, x, y, 3, 18, F, { forma: 'gota', col: ['#FFC534', '#FFE680'] }); onda(fx, x, y, radio * 0.6, '#FFC534', 4, 0.55, 1.2); break;
    case 4: chispas(fx, x, y, 4, 26, F * 0.8, { ang: -Math.PI / 2, abre: 1.6, dur: 1.6 }); chispas(fx, x, y, 4, 10, F, { forma: 'estrella', col: ['#FFA24D', '#FFFFFF'] }); break;
    case 5: chispas(fx, x, y, 5, 40, F * 1.1, { tam: 1.1 }); onda(fx, x, y, radio * 0.5, '#7BDFF2', 3, 0.5, 1.4); break;
    case 6: chispas(fx, x, y, 6, 16, F); chispas(fx, x, y, 1, 12, F * 0.9, { forma: 'burbuja', col: ['#FF6FAE', '#FFFFFF'] }); break;
    case 7: chispas(fx, x, y, 7, 26, F * 1.2, { forma: 'gota', col: ['#F3A64C', '#C46B17', '#FFE0B0'], ang: -Math.PI / 2, abre: 2.2 }); rayo(fx, x, y, radio * 2.2, '#F5C542', 10, 0.7); break;
    case 8: chispas(fx, x, y, 8, 36, F * 1.2, { dur: 1.4 }); rayo(fx, x, y, radio * 2.2, '#C9F77A', 12, 0.8); break;
    case 9: chispas(fx, x, y, 9, 40, F * 1.3, { tam: 1.4, dur: 1.4 }); rayo(fx, x, y, radio * 2.4, '#E07ADF', 14, 0.9); onda(fx, x, y, radio, '#9A1D96', 8, 0.7, 1.3); break;
    case 10: chispas(fx, x, y, 10, 60, F * 1.5, { tam: 1.4, dur: 1.6 }); rayo(fx, x, y, radio * 3, '#F5C542', 16, 1.4); onda(fx, x, y, radio, '#F5C542', 10, 0.9, 1.5); break;
    default: chispas(fx, x, y, 0, 12, F);
  }
}

/** Al soltar una pieza: chispas de su estilo, una onda y un destello. */
export function lanzamiento(fx, x, y, img) {
  const d = DIBUJO[img]; const R = Math.max(d.w, d.h); const c = (ESTILO[img] || ESTILO[0]).col[0];
  chispas(fx, x, y, img, 18, 1);
  onda(fx, x, y, R * 0.5, c, 3, 0.35, 0.6);
  destello(fx, x, y, R * 1.3, c, 0.3);
}

/** Lo que se ve de un evento del motor (el sonido y los avisos son de la pantalla). */
export function efectoDe(fx, e) {
  const fundir = () => {
    for (const s of [e.a, e.b]) if (s) fx.fantasmas.push({ img: s[0], x: s[1], y: s[2], ang: s[3], esc: s[4], hx: e.x, hy: e.y, t: 0 });
  };
  switch (e.tipo) {
    case 'golpe': {
      const F = e.fuerza;
      if (e.x == null) return;
      chispas(fx, e.x, e.y, e.img, Math.round(3 + F * 8), 0.5 + F * 0.6, { tam: 0.8 });
      if (F > 0.3) chispas(fx, e.x, e.y, e.img, 2 + Math.round(F * 4), 0.3, { forma: 'humo', col: [fx.oscuro ? '#BFE3DF' : '#FFFFFF'], g: -20, dur: 1.3, roce: 0.92, tam: 2.4, ang: -Math.PI / 2, abre: 3 });
      if (F > 0.6) sacudir(fx, 1.5 + F * 2);
      return;
    }
    case 'junta': case 'cumbre': {
      fundir();
      const cumbre = e.tipo === 'cumbre'; const R = e.radio || 110;
      destello(fx, e.x, e.y, R * (cumbre ? 3.2 : 1.9), cumbre ? '#FFE27A' : ESTILO[e.n].col[0], cumbre ? 0.8 : 0.4);
      onda(fx, e.x, e.y, R * 0.9, cumbre || e.n >= 7 ? '#F5C542' : '#FFFFFF', cumbre ? 10 : 5, cumbre ? 0.9 : 0.5, cumbre ? 1.6 : 0.7);
      firma(fx, cumbre ? 10 : e.n, e.x, e.y, R);
      if (e.n >= 6 || cumbre) sacudir(fx, cumbre ? 12 : 2 + (e.n - 5) * 1.6);
      if (e.racha > 1) encender(fx, Math.min(1, 0.35 + e.racha * 0.15), e.racha >= 4 ? '#F5C542' : '#E07ADF');
      return;
    }
    case 'limpia': {
      const r = GERMENES[e.n].r;
      chispas(fx, e.x, e.y, 11 + e.n, 16 + e.n * 4, 1.1); chispas(fx, e.x, e.y, 11 + e.n, 6, 0.6, { forma: 'espora', g: -60 });
      destello(fx, e.x, e.y, r * 2.4, '#C9F77A', 0.3); onda(fx, e.x, e.y, r, '#C9F77A', 4, 0.4, 0.9);
      return;
    }
    case 'gel':
      onda(fx, e.x, e.y, RADIO_GEL * 0.3, '#7FD8FF', 8, 0.6, 2.4); onda(fx, e.x, e.y, RADIO_GEL * 0.2, '#FFFFFF', 4, 0.5, 2.6); onda(fx, e.x, e.y, RADIO_GEL * 0.1, '#7FD8FF', 3, 0.8, 4);
      destello(fx, e.x, e.y, RADIO_GEL * 1.4, '#7FD8FF', 0.5); rayo(fx, e.x, e.y, RADIO_GEL * 1.3, '#BFF0FF', 12, 0.6);
      chispas(fx, e.x, e.y, 14, 30, 1.7, { forma: 'gota', col: ['#7FD8FF', '#FFFFFF', '#2BA8E0'] }); chispas(fx, e.x, e.y, 14, 16, 0.8, { dur: 1.6 });
      sacudir(fx, 4); encender(fx, 0.9, '#7FD8FF');
      return;
    case 'germen': {
      const r = GERMENES[e.n].r;
      if (e.solo) { // creció solo
        chispas(fx, e.x, e.y, 11 + e.n, 14, 1); destello(fx, e.x, e.y, r * 3, '#E0412B', 0.35); onda(fx, e.x, e.y, r, '#E0412B', 5, 0.5, 0.7);
        encender(fx, 0.5, '#E0412B');
        return;
      }
      fundir();
      chispas(fx, e.x, e.y, 11 + e.n, 20, 1.2); destello(fx, e.x, e.y, r * 3, '#E0412B', 0.4); onda(fx, e.x, e.y, r, '#E0412B', 4, 0.45, 0.6);
      encender(fx, 0.7, '#E0412B'); sacudir(fx, 3);
      return;
    }
    case 'contagio': {
      if (e.desde) chispas(fx, e.desde.x, e.desde.y, 11, 18, 1.3, { ang: Math.atan2(e.y - e.desde.y, e.x - e.desde.x), abre: 0.6, g: 100 });
      destello(fx, e.x, e.y, 50, '#8FD13A', 0.4); onda(fx, e.x, e.y, 14, '#8FD13A', 3, 0.4, 1);
      encender(fx, 0.5, '#E0412B');
      return;
    }
    default:
  }
}

/** Lo que vive solo: la estela de lo que cae, esporas, brillos sobre los medicamentos, burbujas del gel. */
export function ambiente(fx, m, dt) {
  if (fx.quieto || !m) return;
  for (const b of piezas(m)) {
    const p = b.plugin; const i = imagenDe(p); const bx = b.position.x; const by = b.position.y;
    if (p.lanzada) {
      if (p.toco) p.lanzada = false;
      else if (fx.reloj - fx.estela > 0.02) { fx.estela = fx.reloj; chispas(fx, bx + (Math.random() - 0.5) * DIBUJO[i].w * 0.6, by - DIBUJO[i].h * 0.3, i, 1, 0.25, { ang: -Math.PI / 2, abre: 1.2 }); }
    }
    if (p.tipo === 'germen') {
      const r = GERMENES[p.n].r;
      if (Math.random() < dt * (1.2 + p.n)) particula(fx, { x: bx + (Math.random() - 0.5) * r, y: by - r * 0.7, vx: (Math.random() - 0.5) * 14, vy: -18 - Math.random() * 18, g: -14, r: 1.6 + Math.random() * 1.8, col: ci(ESTILO[i].col[1]), forma: FORMA.espora, vida: 1, dur: 1.4 + Math.random(), giro: 0, vg: 0, roce: 0.99 });
    } else if (p.tipo === 'gel') {
      if (Math.random() < dt * 4) particula(fx, { x: bx + (Math.random() - 0.5) * 20, y: by - 10, vx: 0, vy: -20, g: -40, r: 1.5 + Math.random() * 1.5, col: ci('#BFF0FF'), forma: FORMA.burbuja, vida: 1, dur: 1.2, giro: 0, vg: 0, roce: 0.99 });
    } else if (p.toco) {
      const n = p.n;
      if (Math.random() < dt * (0.12 + n * 0.08)) {
        const d = DIBUJO[i]; const lx = (Math.random() - 0.5) * d.w * 0.7 * p.esc; const ly = (Math.random() - 0.5) * d.h * 0.7 * p.esc;
        const c = Math.cos(b.angle); const s = Math.sin(b.angle);
        particula(fx, { x: bx + lx * c - ly * s, y: by + lx * s + ly * c, vx: 0, vy: 0, g: 0, r: 2.6 + n * 0.4, col: ci(n >= 7 ? '#FFF1A8' : '#FFFFFF'), forma: FORMA.destello, vida: 1, dur: 0.6, giro: Math.random(), vg: 0, roce: 1 });
      }
      if (n === FORMAS.length - 1 && Math.random() < dt * 6) particula(fx, { x: bx + (Math.random() - 0.5) * 150, y: by + (Math.random() - 0.5) * 150, vx: 0, vy: -15, g: -20, r: 2.4, col: ci('#F5C542'), forma: FORMA.estrella, vida: 1, dur: 1.2, giro: 0, vg: 2, roce: 0.99 });
    }
  }
}

function compactar(arr, fn) { let j = 0; for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (fn(v)) arr[j++] = v; } arr.length = j; }

/** Avanza todo `dt` segundos. */
export function avanzarEfectos(fx, dt) {
  fx.reloj += dt;
  compactar(fx.parts, (p) => {
    const r = p.roce || 0.985;
    p.vy += p.g * dt; p.vx *= r; if (p.roce) p.vy *= r;
    p.x += p.vx * dt; p.y += p.vy * dt; p.giro += p.vg * dt; p.vida -= dt / p.dur;
    return p.vida > 0;
  });
  const vivo = (o) => { o.t += dt; return o.t < o.dur; };
  compactar(fx.ondas, vivo); compactar(fx.rayos, vivo); compactar(fx.destellos, vivo);
  compactar(fx.fantasmas, (f) => { f.t += dt; return f.t < 0.12; });
  fx.marco = Math.max(0, fx.marco - dt * 1.6);
  if (fx.temblor > 0.2) { fx.temblor *= Math.pow(0.0008, dt); fx.dx = (Math.random() - 0.5) * fx.temblor; fx.dy = (Math.random() - 0.5) * fx.temblor; } else { fx.temblor = 0; fx.dx = 0; fx.dy = 0; }
}

/**
 * La foto de los efectos, en números del mundo:
 * p: 8 por partícula (x, y, radio, forma, color, alfa, giro, largo) ·
 * o: 6 por onda (x, y, radio, color, alfa, ancho) · d: 5 por destello (x, y, radio, color, alfa) ·
 * y: 7 por rayo (x, y, largo, color, alfa, giro, cuántos) · f: 6 por fantasma (imagen, x, y, giro, escala, alfa).
 */
export function fotoEfectos(fx) {
  const p = new Array(fx.parts.length * 8); let k = 0;
  for (const s of fx.parts) {
    const v = s.vida; let r; let a; let rot = s.giro; let largo = 0;
    if (s.forma === FORMA.humo) { r = s.r * (2.6 - v * 1.6); a = v * 0.3; }
    else if (s.forma === FORMA.destello) { r = s.r * Math.sin(v * Math.PI); a = 1; }
    else { r = s.r * (0.4 + 0.6 * v); a = Math.min(1, v * 1.4); }
    if (s.forma === FORMA.chispa || s.forma === FORMA.gota) {
      rot = Math.atan2(s.vy, s.vx); const vel = Math.hypot(s.vx, s.vy);
      largo = s.forma === FORMA.chispa ? Math.min(r * 5, r * 1.2 + vel * 0.03) : r * (1.2 + Math.min(1.2, vel * 0.004));
    }
    p[k++] = s.x; p[k++] = s.y; p[k++] = r; p[k++] = s.forma; p[k++] = s.col; p[k++] = a; p[k++] = rot; p[k++] = largo;
  }
  const o = [];
  for (const w of fx.ondas) { const q = w.t / w.dur; o.push(w.x, w.y, w.r * (1 + w.crece * (1 - Math.pow(1 - q, 3))), w.col, (1 - q) * 0.9, w.ancho * (1 - q) + 1); }
  const d = [];
  for (const s of fx.destellos) { const q = s.t / s.dur; d.push(s.x, s.y, s.r * (0.6 + 0.4 * q), s.col, 0.95 * (1 - q)); }
  const y = [];
  for (const r of fx.rayos) { const q = r.t / r.dur; y.push(r.x, r.y, r.r * (0.5 + 0.5 * q), r.col, (1 - q) * 0.45 * Math.min(1, q * 6), r.giro + q * 0.8, r.n); }
  const f = [];
  for (const g of fx.fantasmas) { const q = Math.min(1, g.t / 0.12); f.push(g.img, g.x + (g.hx - g.x) * q * q, g.y + (g.hy - g.y) * q * q, g.ang, g.esc * (1 - 0.35 * q), 1 - q); }
  return { p, o, d, y, f, marco: fx.marco, marcoCol: fx.marcoCol, dx: fx.dx, dy: fx.dy };
}

/** 8 números por pieza: imagen, x, y, giro, escala, estiramiento x/y y el aviso de un germen que va a crecer (0..1). */
export function fotoPiezas(m, fx, mov) {
  const lista = piezas(m);
  const c = new Array(lista.length * 8); let k = 0; const t = fx.reloj;
  for (const b of lista) {
    const p = b.plugin; let e = p.esc; let sx = 1; let sy = 1; let ang = b.angle; let aviso = 0;
    if (mov) {
      if (p.junta) { const q = (m.t - p.nace - 0.1) / 0.35; if (q > 0 && q < 1) e *= 1 + 0.16 * Math.sin(q * Math.PI * 2) * (1 - q); }
      if (p.golpe > 0.02) { sx = 1 + 0.13 * p.golpe; sy = 1 - 0.13 * p.golpe; }
      if (p.tipo === 'germen') { const s = 1 + 0.06 * Math.sin(t * 5 + (p.id || 0)); sx *= s; sy *= 2 - s; ang += Math.sin(t * 2.3 + (p.id || 0)) * 0.1; }
    }
    if (p.tipo === 'germen' && p.toco && p.madura - m.t < 2) aviso = 1 - Math.max(0, p.madura - m.t) / 2;
    c[k++] = imagenDe(p); c[k++] = b.position.x; c[k++] = b.position.y; c[k++] = ang; c[k++] = e; c[k++] = sx; c[k++] = sy; c[k++] = aviso;
  }
  return c;
}
