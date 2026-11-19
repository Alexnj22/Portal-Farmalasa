/*
 * Texturas del sobre 3D, pintadas en <canvas> al abrir la invitación (cero
 * imágenes que bajar). Cada superficie sale en dos lienzos: el COLOR y el ORM
 * (canal verde = rugosidad, azul = metal), que es lo que hace que la lámina
 * champán brille como metal y el papel quede mate.
 */
export const SOBRE = { W: 1.42, H: 1, L: 0.58 };
const PX = 2048;
const PY = Math.round(PX / SOBRE.W);

export const COLOR = {
  carbon: '#161714', carbonClaro: '#1d1e1a', forro: '#2c321e', forroClaro: '#3a4228',
  lamina: '#d2b47c', papel: '#f3ede0', tinta: '#24251e', gris: '#45433b', oroTinta: '#a8823f',
  lino: '#ebe4d4', cera: '#38421c', ceraHonda: '#232a10',
};
const METAL = 'rgb(0,100,185)';
const mate = (r) => `rgb(0,${Math.round(r * 255)},0)`;

const BODONI = '"Bodoni Moda", "Bodoni Respaldo", Didot, serif';
const INTER = '"Inter Tight", system-ui, sans-serif';

function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

let ruidoHecho;
/** Grano de papel con fibras, 512² y repetible. Sirve de relieve y de grano. */
export function ruido() {
  if (ruidoHecho) return ruidoHecho;
  const [c, x] = lienzo(512, 512);
  const img = x.createImageData(512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 116 + Math.random() * 24;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.07;
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI; const l = 6 + Math.random() * 26;
    const px = Math.random() * 512; const py = Math.random() * 512;
    x.strokeStyle = Math.random() < 0.5 ? '#fff' : '#000';
    x.lineWidth = 0.4 + Math.random();
    for (const [dx, dy] of [[0, 0], [-512, 0], [0, -512], [-512, -512]]) {
      x.beginPath(); x.moveTo(px + dx, py + dy); x.lineTo(px + dx + Math.cos(a) * l, py + dy + Math.sin(a) * l); x.stroke();
    }
  }
  ruidoHecho = c;
  return c;
}

function grano(x, w, h, alfa) {
  x.save();
  x.globalAlpha = alfa; x.globalCompositeOperation = 'overlay';
  x.fillStyle = x.createPattern(ruido(), 'repeat');
  x.fillRect(0, 0, w, h);
  x.restore();
}

/** Coordenadas del sobre (x, y en unidades, centro 0,0) a píxeles del lienzo. */
const P = (x, y) => [(x / SOBRE.W + 0.5) * PX, (0.5 - y / SOBRE.H) * PY];

/** Texto con espaciado entre letras (el canvas no lo trae en todos lados). */
function espaciado(x, texto, cx, y, sep, pintar = true) {
  const letras = [...texto];
  const anchos = letras.map((l) => x.measureText(l).width);
  const total = anchos.reduce((a, b) => a + b, 0) + sep * (letras.length - 1);
  let px = cx - total / 2;
  letras.forEach((l, i) => { if (pintar) x.fillText(l, px, y); px += anchos[i] + sep; });
  return total;
}

/** Una línea con tramos de distinta letra y color, centrada. color null = sólo ocupa lugar. */
function linea(x, tramos, cx, y) {
  const medidas = tramos.map((t) => { x.font = t.letra; return x.measureText(t.texto).width; });
  let px = cx - medidas.reduce((a, b) => a + b, 0) / 2;
  tramos.forEach((t, i) => {
    if (t.color) { x.font = t.letra; x.fillStyle = t.color; x.fillText(t.texto, px, y); }
    px += medidas[i];
  });
}

/** El tamaño más grande (desde `px`) con el que `texto` cabe en `max`. */
function cabe(x, letra, texto, px, max) {
  let n = px;
  for (; n > 16; n -= 2) { x.font = letra(n); if (x.measureText(texto).width <= max) break; }
  return n;
}

function dos(w, h, pintar) {
  const [color, xc] = lienzo(w, h);
  const [orm, xo] = lienzo(w, h);
  pintar(xc, false, w, h);
  pintar(xo, true, w, h);
  return { color, orm };
}

/** Las dos rectas de lámina, metidas `d` hacia adentro de los cantos de la solapa. */
function cantoSolapa(d) {
  const { W, H, L } = SOBRE;
  const ex = W / 2; const ey = -L; const n = Math.hypot(ex, ey);
  const e = [ex / n, ey / n]; const nor = [-e[1], e[0]];
  const ax = -W / 2 + nor[0] * d; const ay = H / 2 + nor[1] * d;
  const sTip = -ax / e[0];
  const tip = [0, ay + e[1] * sTip];
  const sTop = (H / 2 - d * 1.4 - ay) / e[1];
  const top = [ax + e[0] * sTop, H / 2 - d * 1.4];
  return [top, tip, [-top[0], top[1]]];
}

/** Cara de afuera de la solapa: papel carbón y doble filete de lámina en los cantos. */
export function solapa() {
  return dos(PX, PY, (x, orm, w, h) => {
    if (orm) { x.fillStyle = mate(0.78); x.fillRect(0, 0, w, h); } else {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, COLOR.carbonClaro); g.addColorStop(0.6, COLOR.carbon);
      x.fillStyle = g; x.fillRect(0, 0, w, h); grano(x, w, h, 0.55);
    }
    x.strokeStyle = orm ? METAL : COLOR.lamina; x.lineJoin = 'miter';
    for (const [d, ancho] of [[0.026, 5], [0.04, 1.6]]) {
      const pts = cantoSolapa(d).map(([a, b]) => P(a, b));
      x.lineWidth = ancho; x.beginPath(); x.moveTo(...pts[0]); x.lineTo(...pts[1]); x.lineTo(...pts[2]); x.stroke();
    }
  });
}

/** El frente con bolsillo: carbón, la hoja de abajo un tono más clara, y «Para …». */
export function bolsillo({ para, etiqueta }) {
  const { W, H } = SOBRE;
  return dos(PX, PY, (x, orm, w, h) => {
    if (orm) { x.fillStyle = mate(0.8); x.fillRect(0, 0, w, h); } else {
      x.fillStyle = COLOR.carbon; x.fillRect(0, 0, w, h);
      // La hoja de abajo (la de encima) recibe más luz.
      const g = x.createLinearGradient(0, h, 0, h * 0.4);
      g.addColorStop(0, '#191a17'); g.addColorStop(1, '#21221d');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(...P(-W / 2, -H / 2)); x.lineTo(...P(W / 2, -H / 2)); x.lineTo(...P(0.09, 0.03)); x.lineTo(...P(-0.09, 0.03)); x.fill();
      grano(x, w, h, 0.55);
    }
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.font = `500 30px ${INTER}`; x.fillStyle = orm ? METAL : COLOR.lamina;
    const [, y1] = P(0, -0.2);
    espaciado(x, etiqueta.toUpperCase(), w / 2, y1, 16);
    const n = cabe(x, (px) => `italic 400 ${px}px ${BODONI}`, para, 92, w * 0.5);
    x.font = `italic 400 ${n}px ${BODONI}`;
    const [, y2] = P(0, -0.31);
    if (!orm) { x.fillStyle = COLOR.lino; espaciado(x, para, w / 2, y2, 0); }
  });
}

/** El forro: oliva hondo con una retícula fina de lámina que brilla al moverse. */
export function forro() {
  return dos(PX, PY, (x, orm, w, h) => {
    if (orm) { x.fillStyle = mate(0.62); x.fillRect(0, 0, w, h); } else {
      const g = x.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, w * 0.7);
      g.addColorStop(0, COLOR.forroClaro); g.addColorStop(1, COLOR.forro);
      x.fillStyle = g; x.fillRect(0, 0, w, h); grano(x, w, h, 0.35);
    }
    x.strokeStyle = orm ? METAL : COLOR.lamina; x.globalAlpha = orm ? 1 : 0.55; x.lineWidth = 2;
    const paso = 58;
    for (let i = -h; i < w + h; i += paso) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke();
      x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke();
    }
    x.globalAlpha = 1;
  });
}

/** La tarjeta: lino, doble filete, monograma y nombres con lámina de oro. */
export function tarjeta({ ella, el, monograma, texto, fecha, para }) {
  const w = PX; const h = Math.round(PX / 1.427);
  return dos(w, h, (x, orm) => {
    const c = orm ? { tinta: null, gris: null, oro: METAL } : { tinta: COLOR.tinta, gris: COLOR.gris, oro: COLOR.oroTinta };
    if (orm) { x.fillStyle = mate(0.86); x.fillRect(0, 0, w, h); } else {
      const g = x.createRadialGradient(w * 0.35, h * 0.2, 0, w * 0.5, h * 0.5, w * 0.75);
      g.addColorStop(0, '#f7f2e6'); g.addColorStop(1, '#ebe4d4');
      x.fillStyle = g; x.fillRect(0, 0, w, h); grano(x, w, h, 0.22);
    }
    x.strokeStyle = c.oro;
    x.lineWidth = 4; x.strokeRect(w * 0.04, w * 0.04, w * 0.92, h - w * 0.08);
    x.lineWidth = 1.6; x.strokeRect(w * 0.052, w * 0.052, w * 0.896, h - w * 0.104);

    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    const [m1, m2] = monograma;
    linea(x, [
      { texto: m1, letra: `400 150px ${BODONI}`, color: c.tinta },
      { texto: '&', letra: `italic 400 150px ${BODONI}`, color: c.oro },
      { texto: m2, letra: `400 150px ${BODONI}`, color: c.tinta },
    ], w / 2, h * 0.27);
    x.fillStyle = c.oro; x.fillRect(w / 2 - 70, h * 0.335, 140, 3);

    const nombres = `${ella} & ${el}`;
    const n = cabe(x, (px) => `400 ${px}px ${BODONI}`, nombres, 128, w * 0.8);
    linea(x, [
      { texto: `${ella} `, letra: `400 ${n}px ${BODONI}`, color: c.tinta },
      { texto: '&', letra: `italic 400 ${n}px ${BODONI}`, color: c.oro },
      { texto: ` ${el}`, letra: `400 ${n}px ${BODONI}`, color: c.tinta },
    ], w / 2, h * 0.5);

    x.font = `400 54px ${INTER}`;
    if (c.gris) { x.fillStyle = c.gris; espaciado(x, texto, w / 2, h * 0.59, 3); }
    x.font = `500 58px ${INTER}`; x.fillStyle = c.oro;
    espaciado(x, fecha, w / 2, h * 0.7, 22);
    const np = cabe(x, (px) => `italic 400 ${px}px ${BODONI}`, para, 78, w * 0.7);
    x.font = `italic 400 ${np}px ${BODONI}`;
    if (c.tinta) { x.fillStyle = c.tinta; espaciado(x, para, w / 2, h * 0.83, 0); }
  });
}

/** El dorso de la tarjeta: papel liso con el monograma chico en lámina. */
export function dorso({ monograma }) {
  const w = 1024; const h = Math.round(w / 1.427);
  return dos(w, h, (x, orm) => {
    if (orm) { x.fillStyle = mate(0.86); x.fillRect(0, 0, w, h); } else { x.fillStyle = '#efe8da'; x.fillRect(0, 0, w, h); grano(x, w, h, 0.2); }
    x.textBaseline = 'middle'; x.textAlign = 'left';
    linea(x, [
      { texto: monograma[0], letra: `400 64px ${BODONI}`, color: orm ? METAL : COLOR.oroTinta },
      { texto: '&', letra: `italic 400 64px ${BODONI}`, color: orm ? METAL : COLOR.oroTinta },
      { texto: monograma[1], letra: `400 64px ${BODONI}`, color: orm ? METAL : COLOR.oroTinta },
    ], w / 2, h / 2);
  });
}

/** El lacre: cera oliva, anillo y monograma en lámina, y su relieve. R = medio lado en unidades. */
export function lacre({ monograma }) {
  const s = 512;
  const dibujo = (x, modo) => {
    const metal = modo === 'orm' ? METAL : modo === 'relieve' ? '#fff' : COLOR.lamina;
    x.strokeStyle = metal; x.fillStyle = metal; x.lineWidth = 5;
    x.beginPath(); x.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1.6;
    x.beginPath(); x.arc(s / 2, s / 2, s * 0.275, 0, Math.PI * 2); x.stroke();
    x.textBaseline = 'middle'; x.textAlign = 'left';
    linea(x, [
      { texto: monograma[0], letra: `400 112px ${BODONI}`, color: metal },
      { texto: '&', letra: `italic 400 112px ${BODONI}`, color: metal },
      { texto: monograma[1], letra: `400 112px ${BODONI}`, color: metal },
    ], s / 2, s / 2 + 6);
  };
  const [color, xc] = lienzo(s, s);
  const g = xc.createRadialGradient(s * 0.42, s * 0.38, 0, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, '#46512a'); g.addColorStop(0.7, COLOR.cera); g.addColorStop(1, COLOR.ceraHonda);
  xc.fillStyle = g; xc.fillRect(0, 0, s, s); grano(xc, s, s, 0.25);
  dibujo(xc, 'color');
  const [orm, xo] = lienzo(s, s);
  xo.fillStyle = mate(0.38); xo.fillRect(0, 0, s, s); dibujo(xo, 'orm');
  const [relieve, xr] = lienzo(s, s);
  xr.fillStyle = '#7a7a7a'; xr.fillRect(0, 0, s, s);
  xr.filter = 'blur(2.5px)'; dibujo(xr, 'relieve'); xr.filter = 'none';
  return { color, orm, relieve };
}

/** Sombra suave para la mesa, detrás del sobre. */
export function sombra() {
  const [c, x] = lienzo(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(0.45, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return c;
}
