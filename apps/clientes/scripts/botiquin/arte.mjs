// El arte del Botiquín (juego de Bienestar), escrito como SVG y convertido a
// PNG por `npm run botiquin:arte` (render.mjs). Vive como código y no como
// archivos sueltos para que un cambio de color sea una línea y se vuelva a
// generar todo igual.
//
// Cada pieza es un CÍRCULO que llena su caja: el motor de física choca círculos,
// así que el dibujo tiene que ocupar exactamente ese círculo o las piezas se
// verían flotando o metidas una en otra.
//
// La luz va APARTE (`brillo`): la pieza gira al rodar y su dibujo gira con
// ella, pero el brillo de arriba a la izquierda y la sombra de abajo se quedan
// quietos, como la luz de verdad. Es lo que hace que se vean como objetos y no
// como calcomanías girando.

const V = 200; // lado del lienzo de cada pieza
const C = V / 2;
const R = 98; // radio del círculo: llena el lienzo dejando 2 px para el borde suave

// ── Caras ─────────────────────────────────────────────────────────────────────
// Ojos ovalados con su punto de luz, cachetes y boca. `s` escala todo; `estilo`
// cambia la expresión para que cada pieza tenga carácter propio.
function cara(cx, cy, s, estilo = 'feliz', tinta = '#2A1E3D') {
  const ox = 17 * s; const ew = 6.2 * s; const eh = 8.4 * s;
  let ojos;
  if (estilo === 'contenta') {
    // ojos cerrados de alegría: dos arcos
    const a = (x) => `<path d="M${x - ew * 1.2},${cy + eh * 0.3} Q${x},${cy - eh * 1.1} ${x + ew * 1.2},${cy + eh * 0.3}" fill="none" stroke="${tinta}" stroke-width="${3.4 * s}" stroke-linecap="round"/>`;
    ojos = a(cx - ox) + a(cx + ox);
  } else if (estilo === 'guino') {
    const izq = `<ellipse cx="${cx - ox}" cy="${cy}" rx="${ew}" ry="${eh}" fill="${tinta}"/><circle cx="${cx - ox + ew * 0.35}" cy="${cy - eh * 0.38}" r="${2.3 * s}" fill="#fff"/>`;
    const der = `<path d="M${cx + ox - ew * 1.2},${cy} Q${cx + ox},${cy - eh * 0.9} ${cx + ox + ew * 1.2},${cy}" fill="none" stroke="${tinta}" stroke-width="${3.4 * s}" stroke-linecap="round"/>`;
    ojos = izq + der;
  } else {
    const o = (x) => `<ellipse cx="${x}" cy="${cy}" rx="${ew}" ry="${eh}" fill="${tinta}"/><circle cx="${x + ew * 0.35}" cy="${cy - eh * 0.38}" r="${2.4 * s}" fill="#fff"/><circle cx="${x - ew * 0.3}" cy="${cy + eh * 0.42}" r="${1.1 * s}" fill="#fff" opacity="0.8"/>`;
    ojos = o(cx - ox) + o(cx + ox);
  }
  const cachetes = `<ellipse cx="${cx - ox - 9 * s}" cy="${cy + 12 * s}" rx="${7.5 * s}" ry="${4.6 * s}" fill="#FF6F91" opacity="0.42"/>`
    + `<ellipse cx="${cx + ox + 9 * s}" cy="${cy + 12 * s}" rx="${7.5 * s}" ry="${4.6 * s}" fill="#FF6F91" opacity="0.42"/>`;
  const my = cy + 13 * s;
  let boca;
  if (estilo === 'sorpresa') {
    boca = `<ellipse cx="${cx}" cy="${my + 2 * s}" rx="${4.6 * s}" ry="${5.6 * s}" fill="${tinta}"/>`;
  } else if (estilo === 'feliz' || estilo === 'contenta') {
    // boca abierta con lengua
    boca = `<path d="M${cx - 8.5 * s},${my - 1 * s} Q${cx},${my + 13 * s} ${cx + 8.5 * s},${my - 1 * s} Z" fill="${tinta}"/>`
      + `<path d="M${cx - 4.5 * s},${my + 5.2 * s} Q${cx},${my + 1.2 * s} ${cx + 4.5 * s},${my + 5.2 * s} Q${cx},${my + 9 * s} ${cx - 4.5 * s},${my + 5.2 * s} Z" fill="#FF7A90"/>`;
  } else {
    boca = `<path d="M${cx - 7 * s},${my} Q${cx},${my + 8 * s} ${cx + 7 * s},${my}" fill="none" stroke="${tinta}" stroke-width="${3.2 * s}" stroke-linecap="round"/>`;
  }
  return `<g>${ojos}${cachetes}${boca}</g>`;
}

const circulo = (fill, extra = '') => `<circle cx="${C}" cy="${C}" r="${R}" fill="${fill}" ${extra}/>`;
const borde = (color, ancho = 4.5) => `<circle cx="${C}" cy="${C}" r="${R - ancho / 2}" fill="none" stroke="${color}" stroke-width="${ancho}"/>`;
const radial = (id, paradas, cx = '42%', cy = '38%', r = '70%') => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${paradas.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const lineal = (id, paradas, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${paradas.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

// ── Las once piezas, de la más chica a la más grande ──────────────────────────
export const PIEZAS = [
  {
    nombre: 'Pastilla',
    svg: () => `<defs>${radial('g', [[0, '#FFFFFF'], [0.6, '#DDEBFF'], [1, '#B2CCF4']])}</defs>
      ${circulo('url(#g)')}
      <circle cx="${C}" cy="${C}" r="${R * 0.8}" fill="none" stroke="#C9D6EA" stroke-width="3"/>
      <path d="M${C - R * 0.62},${C - 34} L${C + R * 0.62},${C - 34}" stroke="#B9C8E0" stroke-width="5" stroke-linecap="round"/>
      ${cara(C, C + 6, 1.7, 'sonrisa', '#36456B')}
      ${borde('#87A7DA')}`,
  },
  {
    nombre: 'Gragea',
    svg: () => `<defs>${radial('g', [[0, '#FFC2DD'], [0.55, '#FF7DB5'], [1, '#E2438E']])}</defs>
      ${circulo('url(#g)')}
      ${cara(C, C + 2, 1.75, 'feliz')}
      ${borde('#C93079')}`,
  },
  {
    nombre: 'Perla',
    svg: () => `<defs>${radial('g', [[0, '#FFF6C9'], [0.5, '#FFD34F'], [1, '#E09000']])}${radial('n', [[0, '#FFFFFF', 0.7], [1, '#FFFFFF', 0]], '50%', '62%', '45%')}</defs>
      ${circulo('url(#g)')}
      <circle cx="${C}" cy="${C + 22}" r="${R * 0.62}" fill="url(#n)"/>
      <circle cx="${C + 46}" cy="${C - 40}" r="7" fill="#fff" opacity="0.7"/>
      <circle cx="${C + 60}" cy="${C - 18}" r="4" fill="#fff" opacity="0.6"/>
      <circle cx="${C - 58}" cy="${C + 34}" r="5" fill="#fff" opacity="0.5"/>
      ${cara(C, C, 1.75, 'contenta', '#5A3A00')}
      ${borde('#C27C00')}`,
  },
  {
    nombre: 'Gomita',
    svg: () => {
      const azucar = [];
      for (let i = 0; i < 38; i++) {
        const a = i * 2.39996; const d = R * 0.2 + ((i * 37) % 70);
        const x = C + Math.cos(a) * d; const y = C + Math.sin(a) * d;
        if (Math.hypot(x - C, y - C) > R - 10) continue;
        if (y > C - 30 && y < C + 50 && Math.abs(x - C) < 52) continue; // la cara queda limpia
        azucar.push(`<rect x="${x - 2.6}" y="${y - 2.6}" width="5.2" height="5.2" rx="1.2" fill="#fff" opacity="${0.55 + (i % 3) * 0.12}" transform="rotate(${(i * 47) % 90} ${x} ${y})"/>`);
      }
      return `<defs>${radial('g', [[0, '#E2CCFF'], [0.55, '#A877FF'], [1, '#6A2FDB']])}</defs>
      ${circulo('url(#g)')}
      ${azucar.join('')}
      ${cara(C, C + 6, 1.75, 'guino', '#2A1050')}
      ${borde('#5523B8')}`;
    },
  },
  {
    nombre: 'Efervescente',
    svg: () => {
      const burbujas = [[-52, -46, 9], [-30, -64, 5], [48, -54, 7], [64, -24, 4.5], [-66, 8, 5.5], [58, 40, 8], [-40, 60, 6], [24, 68, 4.5], [70, 6, 3.5], [-12, -72, 4]]
        .map(([x, y, r]) => `<circle cx="${C + x}" cy="${C + y}" r="${r}" fill="none" stroke="#fff" stroke-width="2.4" opacity="0.75"/><circle cx="${C + x - r * 0.3}" cy="${C + y - r * 0.3}" r="${r * 0.25}" fill="#fff" opacity="0.8"/>`);
      return `<defs>${radial('g', [[0, '#FFE1B0'], [0.55, '#FFA04A'], [1, '#F26A0F']])}</defs>
      ${circulo('url(#g)')}
      <circle cx="${C}" cy="${C}" r="${R * 0.84}" fill="none" stroke="#FFC98A" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>
      ${burbujas.join('')}
      ${cara(C, C + 4, 1.8, 'feliz', '#5A2300')}
      ${borde('#D25500')}`;
    },
  },
  {
    nombre: 'Algodón',
    svg: () => {
      // borde de nube: bultos por dentro del círculo, para que el contorno
      // siga siendo el círculo que choca
      const bultos = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        bultos.push(`<circle cx="${C + Math.cos(a) * (R - 26)}" cy="${C + Math.sin(a) * (R - 26)}" r="27" fill="url(#b)"/>`);
      }
      return `<defs>${radial('g', [[0, '#FFFFFF'], [0.7, '#F3F5FA'], [1, '#D9DEEA']])}${radial('b', [[0, '#FFFFFF'], [0.8, '#F6F8FC'], [1, '#E2E7F1']], '40%', '35%', '65%')}</defs>
      ${circulo('#E6EAF3')}
      ${bultos.join('')}
      <circle cx="${C}" cy="${C}" r="${R - 30}" fill="url(#g)"/>
      ${cara(C, C + 2, 1.85, 'contenta', '#3A4058')}
      ${borde('#C6CDDC', 3.5)}`;
    },
  },
  {
    nombre: 'Tapa',
    svg: () => {
      const estrias = [];
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * 360;
        estrias.push(`<rect x="${C - 2.2}" y="${C - R + 1}" width="4.4" height="17" rx="2" fill="#2F6FE0" transform="rotate(${a} ${C} ${C})"/>`);
      }
      return `<defs>${radial('g', [[0, '#9CC8FF'], [0.6, '#4E93FF'], [1, '#1F5FD6']])}${radial('d', [[0, '#C9E1FF'], [1, '#6FA8FF']])}</defs>
      ${circulo('url(#g)')}
      ${estrias.join('')}
      <circle cx="${C}" cy="${C}" r="${R - 24}" fill="url(#d)"/>
      <circle cx="${C}" cy="${C}" r="${R - 24}" fill="none" stroke="#3B7BE8" stroke-width="3"/>
      ${cara(C, C + 2, 1.9, 'feliz', '#0E2C66')}
      ${borde('#164DB8')}`;
    },
  },
  {
    nombre: 'Crema',
    svg: () => `<defs>${radial('g', [[0, '#C8FFEC'], [0.55, '#5FE0B6'], [1, '#14A57B']])}${radial('d', [[0, '#FFFFFF'], [1, '#E3FFF5']])}</defs>
      ${circulo('url(#g)')}
      <circle cx="${C}" cy="${C}" r="${R * 0.7}" fill="url(#d)"/>
      <circle cx="${C}" cy="${C}" r="${R * 0.7}" fill="none" stroke="#2EC08F" stroke-width="5"/>
      <path d="M${C - 20},${C - 52} h40" stroke="#2EC08F" stroke-width="7" stroke-linecap="round"/>
      <path d="M${C - 12},${C - 40} h24" stroke="#7FDDBE" stroke-width="5" stroke-linecap="round"/>
      ${cara(C, C + 10, 1.75, 'sonrisa', '#0C4A37')}
      ${borde('#0E8A65')}`,
  },
  {
    nombre: 'Pastillero',
    svg: () => {
      // siete casillas de colores, una por día, con una pastilla en cada una
      const col = ['#FF8FB1', '#FFC66B', '#FFE66B', '#8EE68A', '#6FD6FF', '#9C9BFF', '#E59BFF'];
      const gajos = [];
      for (let i = 0; i < 7; i++) {
        const a0 = (i / 7) * Math.PI * 2 - Math.PI / 2; const a1 = ((i + 1) / 7) * Math.PI * 2 - Math.PI / 2;
        const r0 = R * 0.38; const r1 = R - 10;
        const p = (r, a) => `${C + Math.cos(a) * r},${C + Math.sin(a) * r}`;
        gajos.push(`<path d="M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z" fill="${col[i]}" stroke="#FFFFFF" stroke-width="5" stroke-linejoin="round"/>`);
        const am = (a0 + a1) / 2; const rm = (r0 + r1) / 2;
        gajos.push(`<ellipse cx="${C + Math.cos(am) * rm}" cy="${C + Math.sin(am) * rm}" rx="9" ry="6" fill="#fff" opacity="0.85" transform="rotate(${(am * 180) / Math.PI + 90} ${C + Math.cos(am) * rm} ${C + Math.sin(am) * rm})"/>`);
      }
      return `<defs>${radial('h', [[0, '#FFFFFF'], [1, '#E7ECF5']])}</defs>
      ${circulo('#FFFFFF')}
      ${gajos.join('')}
      <circle cx="${C}" cy="${C}" r="${R * 0.4}" fill="url(#h)" stroke="#FFFFFF" stroke-width="4"/>
      ${cara(C, C - 2, 1.05, 'feliz')}
      ${borde('#C9D2E3')}`;
    },
  },
  {
    nombre: 'Estetoscopio',
    svg: () => `<defs>${radial('g', [[0, '#FFFFFF'], [0.45, '#D9DFE8'], [1, '#8C97A8']])}${radial('d', [[0, '#5C6B82'], [1, '#26324A']], '45%', '40%', '70%')}${lineal('a', [[0, '#F2F5F9'], [1, '#9AA5B6']])}</defs>
      ${circulo('url(#g)')}
      <circle cx="${C}" cy="${C}" r="${R * 0.8}" fill="url(#a)"/>
      <circle cx="${C}" cy="${C}" r="${R * 0.66}" fill="url(#d)"/>
      <circle cx="${C}" cy="${C}" r="${R * 0.66}" fill="none" stroke="#C4CCD8" stroke-width="3"/>
      <path d="M${C - R * 0.42},${C - R * 0.36} A${R * 0.56},${R * 0.56} 0 0 1 ${C + R * 0.1},${C - R * 0.55}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
      ${cara(C, C + 2, 1.55, 'contenta', '#FFFFFF')}
      ${borde('#6E7A8E')}`,
  },
  {
    nombre: 'Cruz de farmacia',
    svg: () => {
      const L = 62; const g = 23;
      const cruz = (fill, d = 0) => `<rect x="${C - g - d}" y="${C - L - d}" width="${(g + d) * 2}" height="${(L + d) * 2}" rx="${10 + d}" fill="${fill}"/><rect x="${C - L - d}" y="${C - g - d}" width="${(L + d) * 2}" height="${(g + d) * 2}" rx="${10 + d}" fill="${fill}"/>`;
      const rayos = [];
      for (let i = 0; i < 16; i++) rayos.push(`<rect x="${C - 3}" y="${C - R + 4}" width="6" height="14" rx="3" fill="#FFE27A" opacity="0.9" transform="rotate(${i * 22.5} ${C} ${C})"/>`);
      return `<defs>${radial('g', [[0, '#DFFF9E'], [0.55, '#8DD236'], [1, '#3E8E1C']])}${lineal('c', [[0, '#FFFFFF'], [1, '#E9F7D9']])}${lineal('o', [[0, '#FFF1A8'], [1, '#E0A800']])}</defs>
      ${circulo('url(#o)')}
      <circle cx="${C}" cy="${C}" r="${R - 9}" fill="url(#g)"/>
      ${rayos.join('')}
      ${cruz('#2F7A12', 3)}
      ${cruz('url(#c)')}
      ${cara(C, C + 2, 1.35, 'feliz', '#245E0C')}
      <circle cx="${C}" cy="${C}" r="${R - 9}" fill="none" stroke="#FFF6C4" stroke-width="3" opacity="0.8"/>
      ${borde('#B07D00', 5)}`;
    },
  },
];

// La luz que NO gira: brillo arriba a la izquierda, sombra abajo a la derecha.
export const BRILLO = `<defs>
  ${radial('s', [[0, '#000', 0], [0.72, '#000', 0], [1, '#000', 0.26]], '38%', '32%', '78%')}
  ${radial('l', [[0, '#FFFFFF', 0.85], [1, '#FFFFFF', 0]], '50%', '50%', '50%')}
  </defs>
  <circle cx="${C}" cy="${C}" r="${R}" fill="url(#s)"/>
  <ellipse cx="${C - 36}" cy="${C - 46}" rx="34" ry="21" fill="url(#l)" transform="rotate(-32 ${C - 36} ${C - 46})"/>
  <ellipse cx="${C - 60}" cy="${C - 12}" rx="5" ry="9" fill="#fff" opacity="0.45" transform="rotate(-20 ${C - 60} ${C - 12})"/>`;

export const LADO = V;

// ── El botiquín ───────────────────────────────────────────────────────────────
// En unidades del mundo (lib/botiquinMotor.js): el hueco mide ANCHO × ALTO.
// `fondo` va detrás de las piezas y `frente` delante (el vidrio y el canto).
export function caja({ ANCHO, ALTO, PARED, ARRIBA }) {
  const W = ANCHO + PARED * 2; const H = ARRIBA + ALTO + PARED;
  const x0 = PARED; const y0 = ARRIBA; // esquina del hueco
  const rad = 16;
  const hueco = `M${x0},${y0} L${x0},${y0 + ALTO - rad} Q${x0},${y0 + ALTO} ${x0 + rad},${y0 + ALTO} L${x0 + ANCHO - rad},${y0 + ALTO} Q${x0 + ANCHO},${y0 + ALTO} ${x0 + ANCHO},${y0 + ALTO - rad} L${x0 + ANCHO},${y0} Z`;
  const exterior = `M${0},${y0 - 10} Q0,${y0 - 22} 12,${y0 - 22} L${PARED + 4},${y0 - 22} L${PARED + 4},${y0} L${x0 + ANCHO - 4},${y0} L${x0 + ANCHO - 4},${y0 - 22} L${W - 12},${y0 - 22} Q${W},${y0 - 22} ${W},${y0 - 10} L${W},${H - rad - 6} Q${W},${H} ${W - rad - 6},${H} L${rad + 6},${H} Q0,${H} 0,${H - rad - 6} Z`;
  const cruzGrande = (cx, cy, L, g, fill, op) => `<g opacity="${op}"><rect x="${cx - g}" y="${cy - L}" width="${g * 2}" height="${L * 2}" rx="${g * 0.4}" fill="${fill}"/><rect x="${cx - L}" y="${cy - g}" width="${L * 2}" height="${g * 2}" rx="${g * 0.4}" fill="${fill}"/></g>`;
  const fondo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      ${lineal('pared', [[0, '#FFFFFF'], [0.5, '#F1F5FA'], [1, '#D6DEEA']], 0, 0, 1, 0)}
      ${lineal('interior', [[0, '#E9FBF7', 0.2], [1, '#BFEFE6', 0.34]])}
      ${radial('luz', [[0, '#FFFFFF', 0.25], [1, '#FFFFFF', 0]], '50%', '30%', '60%')}
      <clipPath id="recorte"><path d="${hueco}"/></clipPath>
      <filter id="sombra" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>
    </defs>
    <ellipse cx="${W / 2}" cy="${H - 6}" rx="${W * 0.46}" ry="16" fill="#00130F" opacity="0.45" filter="url(#sombra)"/>
    <path d="${exterior}" fill="url(#pared)"/>
    <path d="${hueco}" fill="#0E3B39"/>
    <path d="${hueco}" fill="url(#interior)"/>
    <ellipse cx="${W / 2}" cy="${y0 + ALTO * 0.35}" rx="${ANCHO * 0.9}" ry="${ALTO * 0.7}" fill="url(#luz)" clip-path="url(#recorte)"/>
    ${cruzGrande(W / 2, y0 + ALTO * 0.56, ANCHO * 0.2, ANCHO * 0.066, '#FFFFFF', 0.07)}
    <!-- broches -->
    <rect x="${PARED * 0.15}" y="${y0 - 34}" width="${PARED * 1.5}" height="20" rx="7" fill="#8EC30F"/>
    <rect x="${W - PARED * 1.65}" y="${y0 - 34}" width="${PARED * 1.5}" height="20" rx="7" fill="#8EC30F"/>
  </svg>`;
  const frente = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      ${lineal('canto', [[0, '#FFFFFF'], [1, '#E3EAF3']])}
      ${lineal('reflejo', [[0, '#FFFFFF', 0.24], [1, '#FFFFFF', 0]], 0, 0, 1, 0)}
      ${lineal('base', [[0, '#F4F7FB'], [1, '#C9D4E2']])}
      ${lineal('sombraIn', [[0, '#000', 0.22], [1, '#000', 0]], 0, 0, 1, 0)}
      ${lineal('sombraDer', [[0, '#000', 0], [1, '#000', 0.18]], 0, 0, 1, 0)}
    </defs>
    <!-- sombra que las paredes echan hacia adentro -->
    <rect x="${x0}" y="${y0}" width="14" height="${ALTO - rad}" fill="url(#sombraIn)"/>
    <rect x="${x0 + ANCHO - 14}" y="${y0}" width="14" height="${ALTO - rad}" fill="url(#sombraDer)"/>
    <!-- reflejo del vidrio -->
    <path d="M${x0 + 18},${y0 + 10} L${x0 + 38},${y0 + 10} L${x0 + 30},${y0 + ALTO - 40} L${x0 + 14},${y0 + ALTO - 40} Z" fill="url(#reflejo)"/>
    <path d="M${x0 + 46},${y0 + 10} L${x0 + 52},${y0 + 10} L${x0 + 44},${y0 + ALTO * 0.45} L${x0 + 40},${y0 + ALTO * 0.45} Z" fill="#fff" opacity="0.1"/>
    <!-- canto de arriba de las paredes -->
    <rect x="0" y="${y0 - 22}" width="${PARED + 4}" height="10" rx="5" fill="#FFFFFF"/>
    <rect x="${W - PARED - 4}" y="${y0 - 22}" width="${PARED + 4}" height="10" rx="5" fill="#FFFFFF"/>
    <!-- la base con la cruz -->
    <rect x="${W / 2 - 18}" y="${H - PARED + 3}" width="36" height="${PARED - 8}" rx="6" fill="#E03A5C" opacity="0"/>
    ${cruzGrande(W / 2, y0 + ALTO + PARED / 2, PARED * 0.3, PARED * 0.11, '#5C7F0A', 1)}
  </svg>`;
  return { fondo, frente, W, H };
}
