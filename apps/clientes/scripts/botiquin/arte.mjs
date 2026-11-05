// El arte del Botiquín (juego de Bienestar), escrito como SVG y convertido a
// PNG por render.mjs. Vive como código para que un cambio de color sea una
// línea y se regenere todo igual.
//
// Cada pieza se dibuja en SU forma física (lib/botiquinMotor.js → FORMAS): un
// círculo, una cápsula o una caja de esquinas redondeadas, en unidades del
// mundo. El dibujo llena exactamente esa forma, así lo que se ve es lo que
// choca.
//
// Usuario, 2026-11-04: «mejora los iconos a que parezcan pastillas, puedes
// agregar el icono de la empresa». Por eso son medicamentos de verdad —tableta,
// gragea, cápsula, perla, efervescente, cápsula de microgránulos, blíster,
// frasco, caja, botiquín— y el logo de Farmasalud aparece en el frasco, la caja,
// el botiquín y la pieza final. Sin caras: la cara la tienen los gérmenes, que
// son lo malo.
import { FORMAS, GERMENES, GEL } from '../../lib/botiquinMotor.js';

const VERDE = '#8EC30F';
const MAGENTA = '#981D97';

// ── utilidades ────────────────────────────────────────────────────────────────
let nGrad = 0;
const id = (p) => `${p}${nGrad++}`;
const paradas = (l) => l.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');
function lin(defs, l, x1 = 0, y1 = 0, x2 = 0, y2 = 1) { const i = id('l'); defs.push(`<linearGradient id="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${paradas(l)}</linearGradient>`); return `url(#${i})`; }
function rad(defs, l, cx = 0.4, cy = 0.35, r = 0.75) { const i = id('r'); defs.push(`<radialGradient id="${i}" cx="${cx}" cy="${cy}" r="${r}">${paradas(l)}</radialGradient>`); return `url(#${i})`; }
function recorte(defs, forma) { const i = id('c'); defs.push(`<clipPath id="${i}">${forma}</clipPath>`); return `url(#${i})`; }
const rr = (x, y, w, h, r, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${extra}/>`;

// El logo de Farmasalud: arco verde arriba, arco magenta abajo, cruz magenta.
// Mide ~90 unidades de lado con s = 1.
function logo(cx, cy, s) {
  const R = 40 * s; const g = 7 * s;
  const arco = (a0, a1, r, color) => {
    const p = (a, r2) => `${cx + Math.cos(a) * r2},${cy + Math.sin(a) * r2}`;
    return `<path d="M${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} L${p(a1, r - g * 0.25)} A${r - g},${r - g} 0 0 0 ${p(a0, r - g * 0.25)} Z" fill="${color}"/>`;
  };
  const L = 18 * s; const t = 6.5 * s;
  return `<g>${arco(Math.PI * 0.94, Math.PI * 2.06, R, VERDE)}${arco(Math.PI * -0.06, Math.PI * 1.06, R * 1.04, MAGENTA)}
    <rect x="${cx - t}" y="${cy - L}" width="${t * 2}" height="${L * 2}" fill="${MAGENTA}"/><rect x="${cx - L}" y="${cy - t}" width="${L * 2}" height="${t * 2}" fill="${MAGENTA}"/></g>`;
}

// Un brillo de esmalte a lo largo de la parte de arriba de una forma redondeada.
const reflejo = (x, y, w, h, op = 0.6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#fff" opacity="${op}"/>`;

// ── las piezas ────────────────────────────────────────────────────────────────
function tableta({ r }) { // 0 · comprimido blanco visto de arriba, con su ranura
  const D = r * 2; const d = [];
  const cuerpo = rad(d, [[0, '#FFFFFF'], [0.7, '#EEF3FB'], [1, '#C3CFE2']], 0.42, 0.38, 0.7);
  const cara = lin(d, [[0, '#FFFFFF'], [1, '#E3E9F3']]);
  return { w: D, h: D, defs: d, svg: `
    <circle cx="${r}" cy="${r}" r="${r}" fill="${cuerpo}"/>
    <circle cx="${r}" cy="${r}" r="${r * 0.78}" fill="${cara}" stroke="#D0D9E7" stroke-width="${r * 0.05}"/>
    <path d="M${r * 0.38},${r} H${r * 1.62}" stroke="#B5C2D6" stroke-width="${r * 0.1}" stroke-linecap="round"/>
    <path d="M${r * 0.38},${r * 0.94} H${r * 1.62}" stroke="#fff" stroke-width="${r * 0.04}" stroke-linecap="round"/>
    <circle cx="${r}" cy="${r}" r="${r - 0.6}" fill="none" stroke="#A9B7CE" stroke-width="1.1"/>` };
}

function gragea({ w, h }) { // 1 · ovalada, recubierta y brillante
  const d = []; const k = h / 2;
  const base = lin(d, [[0, '#FFB5D6'], [0.45, '#FF6FAE'], [1, '#C8327A']]);
  return { w, h, defs: d, svg: `
    ${rr(0, 0, w, h, k, `fill="${base}"`)}
    ${rr(w * 0.08, h * 0.55, w * 0.84, h * 0.32, h * 0.16, 'fill="#8E1452" opacity="0.18"')}
    ${reflejo(w * 0.18, h * 0.14, w * 0.5, h * 0.2, 0.75)}
    <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.06}" fill="#fff" opacity="0.8"/>
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, k - 0.6, 'fill="none" stroke="#A62466" stroke-width="1.2" opacity="0.7"')}` };
}

function capsula({ w, h }, c1, c2, opciones = {}) { // dos mitades encajadas
  const d = []; const k = h / 2;
  const izq = lin(d, c1); const der = lin(d, c2);
  const clip = recorte(d, rr(0, 0, w, h, k));
  const corte = w * (opciones.corte || 0.47);
  let dentro = '';
  if (opciones.granulos) {
    // mitad transparente con microgránulos de colores
    const cols = ['#FFD166', '#FF8FB1', '#7BDFF2', '#B2F7EF', '#FFFFFF', '#F7A072'];
    let s = 3;
    const r2 = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 46; i++) {
      const x = 4 + r2() * (corte - 6); const y = 4 + r2() * (h - 8); const rg = h * (0.07 + r2() * 0.05);
      dentro += `<circle cx="${x}" cy="${y}" r="${rg}" fill="${cols[i % cols.length]}"/><circle cx="${x - rg * 0.3}" cy="${y - rg * 0.3}" r="${rg * 0.35}" fill="#fff" opacity="0.7"/>`;
    }
  }
  return { w, h, defs: d, svg: `
    <g clip-path="${clip}">
      <rect x="0" y="0" width="${corte + 3}" height="${h}" fill="${izq}"/>
      ${dentro}
      <rect x="${corte}" y="0" width="${w - corte}" height="${h}" fill="${der}"/>
      ${rr(corte - 1.5, 0, 4, h, 1.5, 'fill="#000" opacity="0.16"')}
      ${rr(corte + 1.5, 0, 1.6, h, 0.8, 'fill="#fff" opacity="0.45"')}
      <rect x="0" y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="#000" opacity="0.1"/>
    </g>
    ${reflejo(w * 0.1, h * 0.13, w * 0.8, h * 0.18, opciones.granulos ? 0.75 : 0.6)}
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, k - 0.6, 'fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="1.1"')}` };
}

function perla({ w, h }) { // 3 · cápsula blanda dorada, traslúcida, con su costura
  const d = []; const k = h / 2;
  const base = rad(d, [[0, '#FFF3B8'], [0.45, '#FFC83D'], [1, '#C98200']], 0.45, 0.4, 0.75);
  const nucleo = rad(d, [[0, '#FFFFFF', 0.75], [1, '#FFFFFF', 0]], 0.5, 0.5, 0.5);
  return { w, h, defs: d, svg: `
    ${rr(0, 0, w, h, k, `fill="${base}"`)}
    <ellipse cx="${w * 0.52}" cy="${h * 0.6}" rx="${w * 0.32}" ry="${h * 0.26}" fill="${nucleo}"/>
    <path d="M${k * 0.5},${h * 0.5} Q${w / 2},${h * 0.62} ${w - k * 0.5},${h * 0.5}" fill="none" stroke="#B87400" stroke-width="1.4" opacity="0.45"/>
    ${reflejo(w * 0.16, h * 0.12, w * 0.46, h * 0.18, 0.8)}
    <circle cx="${w * 0.8}" cy="${h * 0.32}" r="${h * 0.05}" fill="#fff" opacity="0.85"/>
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, k - 0.6, 'fill="none" stroke="#A86A00" stroke-width="1.2" opacity="0.6"')}` };
}

function efervescente({ r }) { // 4 · tableta grande naranja, con burbujitas y bisel
  const D = r * 2; const d = [];
  const borde = rad(d, [[0, '#FFD29A'], [0.75, '#FF9A3D'], [1, '#D9620A']], 0.42, 0.38, 0.72);
  const cara = rad(d, [[0, '#FFC077'], [1, '#FF8F2E']], 0.4, 0.35, 0.8);
  let motas = ''; let s = 11;
  const r2 = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 60; i++) {
    const a = r2() * Math.PI * 2; const dd = Math.sqrt(r2()) * r * 0.74;
    motas += `<circle cx="${r + Math.cos(a) * dd}" cy="${r + Math.sin(a) * dd}" r="${0.5 + r2() * 0.9}" fill="${i % 3 ? '#FFE3BF' : '#E86F12'}" opacity="0.8"/>`;
  }
  let burbujas = '';
  for (let i = 0; i < 9; i++) {
    const a = r2() * Math.PI * 2; const dd = r * (0.3 + r2() * 0.45); const rb = 1.5 + r2() * 2.6;
    burbujas += `<circle cx="${r + Math.cos(a) * dd}" cy="${r + Math.sin(a) * dd}" r="${rb}" fill="#fff" fill-opacity="0.15" stroke="#fff" stroke-width="0.9" opacity="0.9"/>`;
  }
  return { w: D, h: D, defs: d, svg: `
    <circle cx="${r}" cy="${r}" r="${r}" fill="${borde}"/>
    <circle cx="${r}" cy="${r}" r="${r * 0.82}" fill="${cara}"/>
    ${motas}
    <path d="M${r * 1.22},${r * 0.72} A${r * 0.32},${r * 0.32} 0 1 0 ${r * 1.22},${r * 1.28}" fill="none" stroke="#D96A0F" stroke-width="${r * 0.11}" stroke-linecap="round" opacity="0.55"/>
    ${burbujas}
    <ellipse cx="${r * 0.7}" cy="${r * 0.55}" rx="${r * 0.36}" ry="${r * 0.16}" fill="#fff" opacity="0.4" transform="rotate(-30 ${r * 0.7} ${r * 0.55})"/>
    <circle cx="${r}" cy="${r}" r="${r - 0.6}" fill="none" stroke="#B9500A" stroke-width="1.2" opacity="0.6"/>` };
}

function blister({ w, h, cr }) { // 6 · lámina de aluminio con seis burbujas y sus pastillas
  const d = [];
  const papel = lin(d, [[0, '#FBFCFE'], [0.4, '#DCE3EC'], [0.55, '#F4F7FA'], [1, '#B8C3D2']], 0, 0, 1, 1);
  const domo = rad(d, [[0, '#FFFFFF', 0.95], [0.7, '#EAF4FF', 0.55], [1, '#B9CCE4', 0.75]], 0.4, 0.35, 0.7);
  const pild = lin(d, [[0, '#FFFFFF'], [1, '#FFD8EA']]);
  let celdas = '';
  const cw = w / 3; const ch = h / 2;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const x = i * cw + cw / 2; const y = j * ch + ch / 2; const pw = cw * 0.7; const ph = ch * 0.56;
    celdas += `${rr(x - pw / 2 - 2, y - ph / 2 - 2, pw + 4, ph + 4, ph / 2 + 2, `fill="${domo}" stroke="#AFC0D6" stroke-width="0.9"`)}
      ${rr(x - pw * 0.36, y - ph * 0.3, pw * 0.72, ph * 0.6, ph * 0.3, `fill="${pild}" stroke="#E7A9C8" stroke-width="0.8"`)}
      ${reflejo(x - pw * 0.3, y - ph * 0.42, pw * 0.42, ph * 0.16, 0.9)}`;
  }
  return { w, h, defs: d, svg: `
    ${rr(0, 0, w, h, cr, `fill="${papel}"`)}
    <path d="M${cw},4 V${h - 4} M${cw * 2},4 V${h - 4} M4,${ch} H${w - 4}" stroke="#9DAABB" stroke-width="1" stroke-dasharray="2 2.5" opacity="0.8"/>
    ${celdas}
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, cr, 'fill="none" stroke="#8D9AAD" stroke-width="1.2"')}` };
}

function frasco({ w, h, cr }) { // 7 · frasco ámbar con tapa blanca y etiqueta de la casa
  const d = [];
  const tapaH = h * 0.24;
  const vidrio = lin(d, [[0, '#9A4A06'], [0.22, '#D9822B'], [0.5, '#F2A34A'], [0.8, '#C46B17'], [1, '#7A3804']], 0, 0, 1, 0);
  const tapa = lin(d, [[0, '#E3E8EF'], [0.3, '#FFFFFF'], [1, '#C7D0DC']], 0, 0, 1, 0);
  const clip = recorte(d, rr(0, 0, w, h, cr));
  let estrias = '';
  for (let x = 4; x < w - 2; x += 4.2) estrias += `<rect x="${x}" y="2" width="1.6" height="${tapaH - 5}" rx="0.8" fill="#AEB9C8" opacity="0.6"/>`;
  const ey = tapaH + (h - tapaH) * 0.2; const eh = (h - tapaH) * 0.56;
  return { w, h, defs: d, svg: `
    <g clip-path="${clip}">
      <rect x="0" y="${tapaH - 4}" width="${w}" height="${h - tapaH + 4}" fill="${vidrio}"/>
      <rect x="0" y="0" width="${w}" height="${tapaH}" fill="${tapa}"/>
      ${estrias}
      <rect x="0" y="${tapaH - 3}" width="${w}" height="3" fill="#8D99AA" opacity="0.5"/>
      <rect x="4" y="${ey}" width="${w - 8}" height="${eh}" rx="4" fill="#FFFFFF"/>
      <rect x="4" y="${ey}" width="${w - 8}" height="${eh * 0.16}" fill="${VERDE}"/>
      <rect x="4" y="${ey + eh * 0.86}" width="${w - 8}" height="${eh * 0.14}" fill="${MAGENTA}"/>
      ${logo(w / 2, ey + eh * 0.52, (eh * 0.62) / 90)}
      <rect x="${w * 0.12}" y="${tapaH + 2}" width="${w * 0.1}" height="${h - tapaH - 8}" rx="${w * 0.05}" fill="#fff" opacity="0.28"/>
    </g>
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, cr, 'fill="none" stroke="#5E2C04" stroke-opacity="0.45" stroke-width="1.2"')}` };
}

function caja({ w, h, cr }) { // 8 · caja de medicamento de la casa
  const d = [];
  const carton = lin(d, [[0, '#FFFFFF'], [1, '#E9EEF5']]);
  const clip = recorte(d, rr(0, 0, w, h, cr));
  return { w, h, defs: d, svg: `
    <g clip-path="${clip}">
      <rect x="0" y="0" width="${w}" height="${h}" fill="${carton}"/>
      <path d="M0,${h * 0.72} C${w * 0.35},${h * 0.58} ${w * 0.6},${h * 0.92} ${w},${h * 0.7} V${h} H0 Z" fill="${VERDE}"/>
      <path d="M0,${h * 0.84} C${w * 0.4},${h * 0.72} ${w * 0.66},${h} ${w},${h * 0.84} V${h} H0 Z" fill="${MAGENTA}"/>
      <rect x="${w * 0.08}" y="${h * 0.16}" width="${w * 0.42}" height="${h * 0.09}" rx="${h * 0.045}" fill="#33415C"/>
      <rect x="${w * 0.08}" y="${h * 0.32}" width="${w * 0.3}" height="${h * 0.06}" rx="${h * 0.03}" fill="#97A3B6"/>
      <rect x="${w * 0.08}" y="${h * 0.44}" width="${w * 0.22}" height="${h * 0.06}" rx="${h * 0.03}" fill="#C0C9D6"/>
      ${logo(w * 0.75, h * 0.34, (h * 0.5) / 90)}
      <rect x="0" y="0" width="${w}" height="${h * 0.06}" fill="#fff" opacity="0.9"/>
    </g>
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, cr, 'fill="none" stroke="#9AA7B9" stroke-width="1.3"')}` };
}

function botiquin({ w, h, cr }) { // 9 · botiquín blanco con la cruz de la casa
  const d = [];
  const cuerpo = lin(d, [[0, '#FFFFFF'], [0.6, '#F1F4F9'], [1, '#CDD6E3']]);
  const tapa = lin(d, [[0, '#FFFFFF'], [1, '#E6EBF2']]);
  const cruzF = lin(d, [[0, '#C04BC0'], [1, '#7E1580']]);
  const L = h * 0.26; const t = h * 0.09; const cx = w / 2; const cy = h * 0.62;
  return { w, h, defs: d, svg: `
    ${rr(0, 0, w, h, cr, `fill="${cuerpo}"`)}
    ${rr(3, 3, w - 6, h * 0.3, cr - 2, `fill="${tapa}"`)}
    ${rr(w * 0.36, h * 0.07, w * 0.28, h * 0.09, h * 0.045, 'fill="#B6C1D0"')}
    ${rr(w * 0.38, h * 0.085, w * 0.24, h * 0.04, h * 0.02, 'fill="#8995A8"')}
    <rect x="3" y="${h * 0.33}" width="${w - 6}" height="2" fill="#AEB9C9"/>
    ${rr(w * 0.04, h * 0.27, w * 0.07, h * 0.14, 3, `fill="${VERDE}"`)}
    ${rr(w * 0.89, h * 0.27, w * 0.07, h * 0.14, 3, `fill="${VERDE}"`)}
    <circle cx="${cx}" cy="${cy}" r="${L * 1.35}" fill="#fff" stroke="#E5E9F0" stroke-width="2"/>
    <rect x="${cx - t}" y="${cy - L}" width="${t * 2}" height="${L * 2}" rx="${t * 0.35}" fill="${cruzF}"/>
    <rect x="${cx - L}" y="${cy - t}" width="${L * 2}" height="${t * 2}" rx="${t * 0.35}" fill="${cruzF}"/>
    ${reflejo(w * 0.07, h * 0.06, w * 0.24, h * 0.06, 0.9)}
    ${rr(0.6, 0.6, w - 1.2, h - 1.2, cr, 'fill="none" stroke="#9AA6B8" stroke-width="1.4"')}` };
}

function emblema({ r }) { // 10 · el sello de la casa: la meta
  const D = r * 2; const d = [];
  const oro = lin(d, [[0, '#FFF3B0'], [0.35, '#F7C948'], [0.7, '#D99A00'], [1, '#FFE17A']], 0, 0, 1, 1);
  const disco = rad(d, [[0, '#FFFFFF'], [0.8, '#F4F6FA'], [1, '#DDE3EC']], 0.45, 0.4, 0.7);
  let rayos = '';
  for (let i = 0; i < 24; i++) rayos += `<rect x="${r - 1.6}" y="${r * 0.09}" width="3.2" height="${r * 0.08}" rx="1.6" fill="#fff" opacity="0.75" transform="rotate(${i * 15} ${r} ${r})"/>`;
  return { w: D, h: D, defs: d, svg: `
    <circle cx="${r}" cy="${r}" r="${r}" fill="${oro}"/>
    ${rayos}
    <circle cx="${r}" cy="${r}" r="${r * 0.78}" fill="${MAGENTA}"/>
    <circle cx="${r}" cy="${r}" r="${r * 0.72}" fill="${disco}"/>
    ${logo(r, r, (r * 1.12) / 90)}
    <path d="M${r * 0.42},${r * 0.62} A${r * 0.62},${r * 0.62} 0 0 1 ${r * 1.1},${r * 0.32}" fill="none" stroke="#fff" stroke-width="${r * 0.06}" stroke-linecap="round" opacity="0.7"/>
    <circle cx="${r}" cy="${r}" r="${r - 0.8}" fill="none" stroke="#A87400" stroke-width="1.6"/>` };
}

export const PIEZAS = [
  { nombre: 'Tableta', hacer: (f) => tableta(f) },
  { nombre: 'Gragea', hacer: (f) => gragea(f) },
  { nombre: 'Cápsula', hacer: (f) => capsula(f, [[0, '#FF8A8A'], [0.5, '#E53935'], [1, '#A31515']], [[0, '#FFFFFF'], [0.5, '#F2F4F8'], [1, '#C9D1DE']]) },
  { nombre: 'Perla', hacer: (f) => perla(f) },
  { nombre: 'Efervescente', hacer: (f) => efervescente(f) },
  { nombre: 'Microgránulos', hacer: (f) => capsula(f, [[0, '#FFFFFF', 0.55], [0.5, '#E8F6FF', 0.35], [1, '#B8D7EE', 0.6]], [[0, '#6FE3D8'], [0.5, '#12A39A'], [1, '#08665F']], { granulos: true, corte: 0.5 }) },
  { nombre: 'Blíster', hacer: (f) => blister(f) },
  { nombre: 'Frasco', hacer: (f) => frasco(f) },
  { nombre: 'Caja', hacer: (f) => caja(f) },
  { nombre: 'Botiquín', hacer: (f) => botiquin(f) },
  { nombre: 'Sello Farmasalud', hacer: (f) => emblema(f) },
];

// ── lo malo: los gérmenes ─────────────────────────────────────────────────────
// Bolitas con púas y cara de pocos amigos. Dos iguales se juntan en uno más
// grande (es lo malo: crecen solos). Una unión de medicamentos cerca los elimina.
const TONO_GERMEN = [
  ['#C8F56A', '#6FB51C', '#3F7A0A'],
  ['#E3A6FF', '#9B3FD6', '#5A178A'],
  ['#FF9C8A', '#E0412B', '#8E1A0C'],
];
export function germen(nivel) {
  const { r } = GERMENES[nivel]; const D = r * 2; const d = [];
  const [cl, md, os] = TONO_GERMEN[nivel];
  const cuerpo = rad(d, [[0, cl], [0.6, md], [1, os]], 0.4, 0.35, 0.75);
  const nucleo = r * 0.74;
  let puas = '';
  const n = 10 + nivel * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const x1 = r + Math.cos(a) * nucleo * 0.9; const y1 = r + Math.sin(a) * nucleo * 0.9;
    const x2 = r + Math.cos(a) * (r - 2.2); const y2 = r + Math.sin(a) * (r - 2.2);
    puas += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${os}" stroke-width="${r * 0.09}" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="${r * 0.085}" fill="${md}" stroke="${os}" stroke-width="0.8"/>`;
  }
  let motas = '';
  for (let i = 0; i < 5; i++) { const a = i * 1.7; motas += `<circle cx="${r + Math.cos(a) * nucleo * 0.55}" cy="${r + Math.sin(a) * nucleo * 0.6 + nucleo * 0.25}" r="${nucleo * (0.08 + (i % 2) * 0.05)}" fill="${os}" opacity="0.35"/>`; }
  const e = nucleo * 0.17; const ox = nucleo * 0.33; const ey = r - nucleo * 0.08;
  const ojo = (x, lado) => `<ellipse cx="${x}" cy="${ey}" rx="${e}" ry="${e * 1.1}" fill="#fff"/><circle cx="${x + lado * e * 0.25}" cy="${ey + e * 0.2}" r="${e * 0.55}" fill="#1B1030"/>
    <path d="M${x - e * 1.3},${ey - e * (lado > 0 ? 0.8 : 1.9)} L${x + e * 1.3},${ey - e * (lado > 0 ? 1.9 : 0.8)}" stroke="#1B1030" stroke-width="${e * 0.55}" stroke-linecap="round"/>`;
  return { w: D, h: D, defs: d, svg: `
    ${puas}
    <circle cx="${r}" cy="${r}" r="${nucleo}" fill="${cuerpo}" stroke="${os}" stroke-width="1.4"/>
    ${motas}
    ${ojo(r - ox, -1)}${ojo(r + ox, 1)}
    <path d="M${r - nucleo * 0.24},${r + nucleo * 0.36} Q${r},${r + nucleo * 0.2} ${r + nucleo * 0.24},${r + nucleo * 0.36}" fill="none" stroke="#1B1030" stroke-width="${e * 0.5}" stroke-linecap="round"/>
    <path d="M${r - nucleo * 0.1},${r + nucleo * 0.3} l${e * 0.35},${e * 0.6} l${e * 0.35},${-e * 0.6}" fill="#fff"/>
    <ellipse cx="${r - nucleo * 0.35}" cy="${r - nucleo * 0.5}" rx="${nucleo * 0.25}" ry="${nucleo * 0.12}" fill="#fff" opacity="0.45" transform="rotate(-30 ${r - nucleo * 0.35} ${r - nucleo * 0.5})"/>` };
}

// ── lo bueno: el gel antibacterial ────────────────────────────────────────────
// Sale de vez en cuando como la próxima pieza: al tocar algo estalla y limpia
// los gérmenes que tiene cerca.
export function gel() {
  const { r } = GEL; const D = r * 2; const d = [];
  const burbuja = rad(d, [[0, '#FFFFFF', 0.95], [0.55, '#9FE7FF', 0.85], [1, '#2BA8E0', 0.95]], 0.38, 0.32, 0.75);
  return { w: D, h: D, defs: d, svg: `
    <circle cx="${r}" cy="${r}" r="${r}" fill="${burbuja}"/>
    <path d="M${r},${r * 0.42} C${r * 1.35},${r * 0.9} ${r * 1.4},${r * 1.15} ${r * 1.4},${r * 1.25} A${r * 0.4},${r * 0.4} 0 0 1 ${r * 0.6},${r * 1.25} C${r * 0.6},${r * 1.15} ${r * 0.65},${r * 0.9} ${r},${r * 0.42} Z" fill="#fff"/>
    <path d="M${r * 0.82},${r * 1.18} A${r * 0.2},${r * 0.2} 0 0 0 ${r},${r * 1.38}" fill="none" stroke="#2BA8E0" stroke-width="${r * 0.08}" stroke-linecap="round"/>
    <path d="M${r * 1.55},${r * 0.45} l${r * 0.08},${r * 0.2} l${r * 0.2},${r * 0.08} l${-r * 0.2},${r * 0.08} l${-r * 0.08},${r * 0.2} l${-r * 0.08},${-r * 0.2} l${-r * 0.2},${-r * 0.08} l${r * 0.2},${-r * 0.08} Z" fill="#fff"/>
    <ellipse cx="${r * 0.62}" cy="${r * 0.5}" rx="${r * 0.3}" ry="${r * 0.14}" fill="#fff" opacity="0.8" transform="rotate(-35 ${r * 0.62} ${r * 0.5})"/>
    <circle cx="${r}" cy="${r}" r="${r - 0.6}" fill="none" stroke="#1C87BC" stroke-width="1.2" opacity="0.7"/>` };
}

/** Todas las piezas a dibujar: { archivo, w, h, svg } en unidades del mundo. */
export function catalogo() {
  const sale = [];
  const meter = (archivo, p) => sale.push({ archivo, w: p.w, h: p.h, svg: `<defs>${p.defs.join('')}</defs>${p.svg}` });
  PIEZAS.forEach((p, n) => meter(`pieza-${n}`, p.hacer(FORMAS[n])));
  GERMENES.forEach((_, n) => meter(`germen-${n}`, germen(n)));
  meter('gel', gel());
  return sale;
}

// ── el botiquín que hace de tablero ───────────────────────────────────────────
// En unidades del mundo: el hueco mide ANCHO × ALTO y su esquina de arriba a la
// izquierda es (0, 0). `fondo` va detrás de las piezas y `frente` delante.
export function estuche({ ANCHO, ALTO, PARED, ARRIBA }) {
  const W = ANCHO + PARED * 2; const H = ARRIBA + ALTO + PARED;
  const x0 = PARED; const y0 = ARRIBA; const r = 16;
  const d = [];
  const hueco = `M${x0},${y0} L${x0},${y0 + ALTO - r} Q${x0},${y0 + ALTO} ${x0 + r},${y0 + ALTO} L${x0 + ANCHO - r},${y0 + ALTO} Q${x0 + ANCHO},${y0 + ALTO} ${x0 + ANCHO},${y0 + ALTO - r} L${x0 + ANCHO},${y0} Z`;
  const exterior = `M0,${y0 - 10} Q0,${y0 - 22} 12,${y0 - 22} L${PARED + 4},${y0 - 22} L${PARED + 4},${y0} L${x0 + ANCHO - 4},${y0} L${x0 + ANCHO - 4},${y0 - 22} L${W - 12},${y0 - 22} Q${W},${y0 - 22} ${W},${y0 - 10} L${W},${H - 22} Q${W},${H} ${W - 22},${H} L22,${H} Q0,${H} 0,${H - 22} Z`;
  const pared = lin(d, [[0, '#FFFFFF'], [0.5, '#F1F5FA'], [1, '#D3DCE8']], 0, 0, 1, 0);
  const interior = lin(d, [[0, '#15414C'], [1, '#0B2830']]);
  const brillo = rad(d, [[0, '#FFFFFF', 0.16], [1, '#FFFFFF', 0]], 0.5, 0.25, 0.7);
  const clip = recorte(d, `<path d="${hueco}"/>`);
  let estantes = '';
  for (let i = 1; i < 4; i++) estantes += `<rect x="${x0}" y="${y0 + (ALTO / 4) * i}" width="${ANCHO}" height="1.2" fill="#fff" opacity="0.05"/>`;
  const fondo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs>${d.join('')}<filter id="desenfoque" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="10"/></filter></defs>
    <ellipse cx="${W / 2}" cy="${H - 4}" rx="${W * 0.47}" ry="14" fill="#000" opacity="0.5" filter="url(#desenfoque)"/>
    <path d="${exterior}" fill="${pared}"/>
    <path d="${hueco}" fill="${interior}"/>
    <g clip-path="${clip}">
      <ellipse cx="${W / 2}" cy="${y0 + ALTO * 0.3}" rx="${ANCHO * 0.9}" ry="${ALTO * 0.7}" fill="${brillo}"/>
      ${estantes}
      <g opacity="0.08">${logo(W / 2, y0 + ALTO * 0.55, ANCHO / 150).replace(/fill="#[0-9A-Fa-f]+"/g, 'fill="#FFFFFF"')}</g>
    </g>
    <rect x="${PARED * 0.15}" y="${y0 - 34}" width="${PARED * 1.5}" height="20" rx="7" fill="${VERDE}"/>
    <rect x="${W - PARED * 1.65}" y="${y0 - 34}" width="${PARED * 1.5}" height="20" rx="7" fill="${MAGENTA}"/>
  </svg>`;
  const d2 = [];
  const sIn = lin(d2, [[0, '#000', 0.3], [1, '#000', 0]], 0, 0, 1, 0);
  const sDer = lin(d2, [[0, '#000', 0], [1, '#000', 0.24]], 0, 0, 1, 0);
  const vidrio = lin(d2, [[0, '#FFFFFF', 0.2], [1, '#FFFFFF', 0]], 0, 0, 1, 0);
  const frente = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs>${d2.join('')}</defs>
    <rect x="${x0}" y="${y0}" width="12" height="${ALTO - r}" fill="${sIn}"/>
    <rect x="${x0 + ANCHO - 12}" y="${y0}" width="12" height="${ALTO - r}" fill="${sDer}"/>
    <path d="M${x0 + 16},${y0 + 8} L${x0 + 34},${y0 + 8} L${x0 + 26},${y0 + ALTO - 36} L${x0 + 12},${y0 + ALTO - 36} Z" fill="${vidrio}"/>
    <rect x="0" y="${y0 - 22}" width="${PARED + 4}" height="10" rx="5" fill="#FFFFFF"/>
    <rect x="${W - PARED - 4}" y="${y0 - 22}" width="${PARED + 4}" height="10" rx="5" fill="#FFFFFF"/>
    ${logo(W / 2, y0 + ALTO + PARED / 2, PARED / 110)}
  </svg>`;
  return { fondo, frente, W, H };
}
