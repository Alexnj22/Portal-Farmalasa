// El arte del Botiquín (juego de Bienestar), escrito como SVG y convertido a
// PNG por render.mjs. Vive como código para que un cambio de color sea una
// línea y se regenere todo igual.
//
// Quinta versión (2026-11-04). El usuario rechazó la cuarta («se ve low cost…
// hasta pena me da») y aprobó ESTE arte primero en un prototipo HTML: el logo es
// el ORIGINAL de la casa (los dos arcos y la cruz, medidos sobre
// assets/icono-adaptativo.png — «respeta el icono original de la farmacia»), no
// una aproximación.
//
// Cada dibujo tiene su propia caja (`vb`) y se estira a la medida de su forma
// física (DIBUJO, más abajo): lo que se ve es lo que choca. Los gérmenes asoman
// las púas, por eso su dibujo mide 2.5 radios y no 2.
import { FORMAS, GERMENES, medidas } from '../../lib/botiquinMotor.js';

const LOGO = '<g transform="translate(50 50) scale(0.198) translate(-420 -421)">'
  + '<path d="M186,465 A231,231 0 1 1 632,465 L630.1,465 A221.6,221.6 0 1 0 187.9,465 Z" fill="#8DC311"/>'
  + '<path d="M211,366 A231,231 0 1 0 651,366 A221.6,221.6 0 1 1 211,366 Z" fill="#9A1D96"/>'
  + '<rect x="364" y="313" width="90" height="215" fill="#9A1D96"/><rect x="298" y="377" width="222" height="87" fill="#9A1D96"/></g>';
const usaLogo = (x, y, s) => `<use href="#logo" transform="translate(${x} ${y}) scale(${s / 100})"/>`;

const DEFS = `
<linearGradient id="hiV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="sombraAbajo" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<radialGradient id="tabCuerpo" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".75" stop-color="#e9eef6"/><stop offset="1" stop-color="#c4cfdf"/></radialGradient>
<linearGradient id="tabCara" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e6ebf3"/></linearGradient>
<radialGradient id="graCuerpo" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#ffd3e8"/><stop offset=".45" stop-color="#ff6fae"/><stop offset="1" stop-color="#b8216a"/></radialGradient>
<linearGradient id="capRojo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".22" stop-color="#ffa0a0"/><stop offset=".55" stop-color="#e5262d"/><stop offset="1" stop-color="#8f0f14"/></linearGradient>
<linearGradient id="capBlanco" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef5"/><stop offset=".22" stop-color="#fff"/><stop offset=".6" stop-color="#e8edf4"/><stop offset="1" stop-color="#a9b5c6"/></linearGradient>
<radialGradient id="perlaCuerpo" cx=".42" cy=".35" r=".75"><stop offset="0" stop-color="#fff6c9"/><stop offset=".5" stop-color="#ffc534"/><stop offset="1" stop-color="#c77e00"/></radialGradient>
<radialGradient id="perlaNucleo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="efeBorde" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc98a"/><stop offset="1" stop-color="#d9580a"/></linearGradient>
<radialGradient id="efeCara" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffd8a8"/><stop offset=".6" stop-color="#ff9d42"/><stop offset="1" stop-color="#f07a1a"/></radialGradient>
<linearGradient id="microClaro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff3ff" stop-opacity=".55"/><stop offset=".25" stop-color="#fff" stop-opacity=".75"/><stop offset=".7" stop-color="#cfe9f7" stop-opacity=".35"/><stop offset="1" stop-color="#8fb8d4" stop-opacity=".7"/></linearGradient>
<linearGradient id="microTeal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fb8ad"/><stop offset=".22" stop-color="#86eee4"/><stop offset=".6" stop-color="#12a39a"/><stop offset="1" stop-color="#07534d"/></linearGradient>
<linearGradient id="plata" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfcfe"/><stop offset=".35" stop-color="#d9e0ea"/><stop offset=".5" stop-color="#f6f8fb"/><stop offset=".7" stop-color="#cdd5e1"/><stop offset="1" stop-color="#aeb9c9"/></linearGradient>
<radialGradient id="domo" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".7" stop-color="#e4f1ff" stop-opacity=".6"/><stop offset="1" stop-color="#a9c0dc" stop-opacity=".9"/></radialGradient>
<linearGradient id="ambar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a3804"/><stop offset=".15" stop-color="#c46b17"/><stop offset=".38" stop-color="#f3a64c"/><stop offset=".55" stop-color="#d9822b"/><stop offset="1" stop-color="#6a3003"/></linearGradient>
<linearGradient id="tapa" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9d2de"/><stop offset=".3" stop-color="#fff"/><stop offset=".7" stop-color="#e6ebf2"/><stop offset="1" stop-color="#aab6c6"/></linearGradient>
<linearGradient id="carton" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e7ecf3"/></linearGradient>
<linearGradient id="botiCuerpo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#eef2f7"/><stop offset="1" stop-color="#c9d3e0"/></linearGradient>
<linearGradient id="cruz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b42fb2"/><stop offset="1" stop-color="#7e1580"/></linearGradient>
<linearGradient id="oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".3" stop-color="#f5c542"/><stop offset=".55" stop-color="#c98a00"/><stop offset=".8" stop-color="#ffdf6e"/><stop offset="1" stop-color="#b77900"/></linearGradient>
<radialGradient id="discoBlanco" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e1e7f0"/></radialGradient>
<radialGradient id="g0" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#d4ff7a"/><stop offset=".55" stop-color="#79c21f"/><stop offset="1" stop-color="#3a730a"/></radialGradient>
<radialGradient id="g1" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#efc0ff"/><stop offset=".55" stop-color="#a046df"/><stop offset="1" stop-color="#571584"/></radialGradient>
<radialGradient id="g2" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffb3a3"/><stop offset=".55" stop-color="#ea4a31"/><stop offset="1" stop-color="#8e1a0c"/></radialGradient>
<radialGradient id="gelCuerpo" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#a8ecff" stop-opacity=".9"/><stop offset="1" stop-color="#1f9fd8"/></radialGradient>
<clipPath id="clipCap"><rect width="220" height="80" rx="40"/></clipPath>
<clipPath id="clipMicro"><rect width="230" height="100" rx="50"/></clipPath>
<clipPath id="clipFrasco"><rect width="100" height="150" rx="18"/></clipPath>
<clipPath id="clipCaja"><rect width="150" height="100" rx="10"/></clipPath>
<g id="logo">${LOGO}</g>
<g id="pua"><line x1="50" y1="20" x2="50" y2="8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="7" r="5.5" fill="currentColor"/></g>
<g id="cara"><ellipse cx="38" cy="49" rx="7" ry="8" fill="#fff"/><ellipse cx="62" cy="49" rx="7" ry="8" fill="#fff"/><circle cx="40" cy="51" r="4" fill="#1b1030"/><circle cx="60" cy="51" r="4" fill="#1b1030"/><path d="M29,37 L46,43" stroke="#1b1030" stroke-width="4.5" stroke-linecap="round"/><path d="M71,37 L54,43" stroke="#1b1030" stroke-width="4.5" stroke-linecap="round"/><path d="M40,67 Q50,60 60,67" stroke="#1b1030" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M45.5,64.2 L48,69 L50.5,63.2 Z" fill="#fff"/></g>`;

const domos = [[25,25],[75,25],[125,25],[25,75],[75,75]].map(([x,y]) => `<rect x="${x-19}" y="${y-14}" width="38" height="28" rx="14" fill="url(#domo)" stroke="#a9bbd3"/><rect x="${x-13}" y="${y-8}" width="26" height="16" rx="8" fill="url(#graCuerpo)"/><rect x="${x-14}" y="${y-11}" width="16" height="4" rx="2" fill="#fff" opacity=".9"/>`).join('');
const puas = (n, color) => `<g style="color:${color}">` + Array.from({ length: n }, (_, i) => `<use href="#pua" transform="rotate(${(360 / n) * i} 50 50)"/>`).join('') + '</g>';
const germen = (g, color, n) => `${puas(n, color)}<circle cx="50" cy="50" r="32" fill="url(#${g})" stroke="${color}" stroke-width="2"/><circle cx="30" cy="62" r="3.5" fill="${color}" opacity=".25"/><circle cx="70" cy="64" r="2.6" fill="${color}" opacity=".25"/><circle cx="62" cy="30" r="2.4" fill="${color}" opacity=".25"/><use href="#cara"/><ellipse cx="38" cy="30" rx="10" ry="4.5" fill="#fff" opacity=".45" transform="rotate(-25 38 30)"/>`;

// Cada dibujo, en su caja: medicamentos 0-10, gérmenes 11-13, gel 14.
const ARTE = [
  { vb: [100, 100], c: `<circle cx="50" cy="50" r="49" fill="url(#tabCuerpo)"/><circle cx="50" cy="50" r="39" fill="url(#tabCara)" stroke="#d3dbe7" stroke-width="1.5"/><rect x="17" y="46" width="66" height="7" rx="3.5" fill="#c2ccda"/><rect x="19" y="52" width="62" height="1.6" rx=".8" fill="#fff" opacity=".9"/><ellipse cx="38" cy="27" rx="22" ry="8" fill="url(#hiV)" transform="rotate(-18 38 27)"/><circle cx="50" cy="50" r="48.5" fill="none" stroke="#9eadc3" stroke-width="1" opacity=".7"/>` },
  { vb: [160, 100], c: `<rect x="1" y="1" width="158" height="98" rx="49" fill="url(#graCuerpo)"/><rect x="1" y="1" width="158" height="98" rx="49" fill="url(#sombraAbajo)"/><rect x="30" y="12" width="82" height="22" rx="11" fill="url(#hiV)"/><circle cx="128" cy="30" r="5" fill="#fff" opacity=".85"/><rect x="1" y="1" width="158" height="98" rx="49" fill="none" stroke="#a11b5c" stroke-width="1.5" opacity=".5"/>` },
  { vb: [220, 80], c: `<g clip-path="url(#clipCap)"><rect width="112" height="80" fill="url(#capRojo)"/><rect x="108" width="112" height="80" fill="url(#capBlanco)"/><rect x="106" width="4" height="80" fill="#000" opacity=".18"/><rect x="110" width="2" height="80" fill="#fff" opacity=".6"/></g><rect x="22" y="10" width="176" height="14" rx="7" fill="url(#hiV)"/><rect x=".75" y=".75" width="218.5" height="78.5" rx="39.25" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="1.5"/>` },
  { vb: [150, 100], c: `<rect x="1" y="1" width="148" height="98" rx="49" fill="url(#perlaCuerpo)"/><ellipse cx="77" cy="64" rx="44" ry="22" fill="url(#perlaNucleo)"/><path d="M22,52 Q75,64 128,52" fill="none" stroke="#a66a00" stroke-width="2" opacity=".35"/><rect x="26" y="12" width="66" height="18" rx="9" fill="url(#hiV)"/><circle cx="120" cy="28" r="4.5" fill="#fff" opacity=".9"/><rect x="1" y="1" width="148" height="98" rx="49" fill="none" stroke="#a46b00" stroke-width="1.5" opacity=".5"/>` },
  { vb: [100, 100], c: `<circle cx="50" cy="50" r="49" fill="url(#efeBorde)"/><circle cx="50" cy="50" r="42" fill="url(#efeCara)"/><circle cx="30" cy="40" r="1.4" fill="#fff3e0" opacity=".8"/><circle cx="66" cy="30" r="1.2" fill="#fff3e0" opacity=".8"/><circle cx="72" cy="62" r="1.5" fill="#d4600c" opacity=".5"/><circle cx="34" cy="68" r="1.3" fill="#d4600c" opacity=".5"/><circle cx="56" cy="76" r="1.2" fill="#fff3e0" opacity=".8"/><g transform="translate(1.4 1.4)" opacity=".6"><rect x="44" y="31" width="12" height="38" rx="3" fill="#d2600e"/><rect x="31" y="44" width="38" height="12" rx="3" fill="#d2600e"/></g><g transform="translate(-1.2 -1.2)" opacity=".7"><rect x="44" y="31" width="12" height="38" rx="3" fill="#ffe0bd"/><rect x="31" y="44" width="38" height="12" rx="3" fill="#ffe0bd"/></g><rect x="44" y="31" width="12" height="38" rx="3" fill="#ffa24d"/><rect x="31" y="44" width="38" height="12" rx="3" fill="#ffa24d"/><circle cx="70" cy="34" r="3.2" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-width="1"/><circle cx="28" cy="62" r="2.4" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-width="1"/><ellipse cx="34" cy="26" rx="18" ry="7" fill="url(#hiV)" transform="rotate(-28 34 26)"/><circle cx="50" cy="50" r="48.5" fill="none" stroke="#b9500a" stroke-width="1.2" opacity=".55"/>` },
  { vb: [230, 100], c: `<g clip-path="url(#clipMicro)"><rect width="118" height="100" fill="#e6f6ff" opacity=".55"/><circle cx="22" cy="44" r="8" fill="#ffd166"/><circle cx="40" cy="64" r="7" fill="#ff8fb1"/><circle cx="58" cy="40" r="8" fill="#7bdff2"/><circle cx="34" cy="28" r="6" fill="#fff"/><circle cx="76" cy="62" r="8" fill="#f7a072"/><circle cx="92" cy="38" r="7" fill="#ffd166"/><circle cx="64" cy="78" r="6" fill="#b2f7ef"/><circle cx="20" cy="70" r="6" fill="#7bdff2"/><circle cx="102" cy="66" r="7" fill="#ff8fb1"/><circle cx="80" cy="22" r="6" fill="#b2f7ef"/><circle cx="48" cy="84" r="5" fill="#ffd166"/><circle cx="104" cy="22" r="5" fill="#f7a072"/><rect width="118" height="100" fill="url(#microClaro)"/><rect x="112" width="118" height="100" fill="url(#microTeal)"/><rect x="110" width="4" height="100" fill="#000" opacity=".16"/><rect x="114" width="2" height="100" fill="#fff" opacity=".55"/></g><rect x="24" y="12" width="182" height="16" rx="8" fill="url(#hiV)"/><rect x=".75" y=".75" width="228.5" height="98.5" rx="49.25" fill="none" stroke="#06433e" stroke-opacity=".3" stroke-width="1.5"/>` },
  { vb: [150, 100], c: `<rect x="1" y="1" width="148" height="98" rx="12" fill="url(#plata)" stroke="#8e9bb0" stroke-width="1.5"/><path d="M50,6 V94 M100,6 V94 M6,50 H144" stroke="#95a3b7" stroke-width="1.2" stroke-dasharray="2 3" fill="none"/>${domos}<rect x="106" y="61" width="38" height="28" rx="14" fill="#c3ccd8" stroke="#a9b4c4"/><path d="M110,66 L122,80 L128,70 L140,84" stroke="#8d99ab" stroke-width="1.4" fill="none"/>` },
  { vb: [100, 150], c: `<g clip-path="url(#clipFrasco)"><rect y="30" width="100" height="120" fill="url(#ambar)"/><rect width="100" height="34" fill="url(#tapa)"/><line x1="4" y1="17" x2="96" y2="17" stroke="#aeb9c9" stroke-width="24" stroke-dasharray="2 4" opacity=".55"/><rect y="31" width="100" height="4" fill="#000" opacity=".25"/><rect x="8" y="54" width="84" height="70" rx="5" fill="#fff"/><rect x="8" y="54" width="84" height="11" fill="#8DC311"/><rect x="8" y="114" width="84" height="10" fill="#9A1D96"/>${usaLogo(30, 68, 42)}<rect x="11" y="40" width="9" height="104" rx="4.5" fill="#fff" opacity=".3"/><rect x="84" y="36" width="16" height="114" fill="#000" opacity=".12"/></g><rect x=".75" y=".75" width="98.5" height="148.5" rx="17.5" fill="none" stroke="#4e2403" stroke-opacity=".45" stroke-width="1.5"/>` },
  { vb: [150, 100], c: `<g clip-path="url(#clipCaja)"><rect width="150" height="100" fill="url(#carton)"/><path d="M0,72 C52,58 90,92 150,70 V100 H0 Z" fill="#8DC311"/><path d="M0,84 C60,72 99,100 150,84 V100 H0 Z" fill="#9A1D96"/><rect x="12" y="16" width="64" height="9" rx="4.5" fill="#2e3a55"/><rect x="12" y="32" width="46" height="6" rx="3" fill="#97a3b6"/><rect x="12" y="44" width="32" height="6" rx="3" fill="#c0c9d6"/>${usaLogo(92, 8, 52)}<rect width="150" height="5" fill="#fff"/><rect width="150" height="100" fill="url(#sombraAbajo)" opacity=".6"/></g><rect x=".75" y=".75" width="148.5" height="98.5" rx="9.5" fill="none" stroke="#8d9bb0" stroke-width="1.5"/>` },
  { vb: [140, 104], c: `<rect x="47" y="2" width="46" height="20" rx="9" fill="none" stroke="#9aa7b9" stroke-width="6"/><rect x="1" y="12" width="138" height="91" rx="16" fill="url(#botiCuerpo)" stroke="#9aa6b8" stroke-width="1.5"/><rect x="2" y="40" width="136" height="2" fill="#b5c0cf"/><rect x="10" y="33" width="12" height="15" rx="3" fill="#8DC311"/><rect x="118" y="33" width="12" height="15" rx="3" fill="#8DC311"/><circle cx="70" cy="72" r="25" fill="#fff" stroke="#e3e8ef" stroke-width="2"/>${usaLogo(46, 48, 48)}<rect x="12" y="17" width="54" height="6" rx="3" fill="#fff" opacity=".95"/><rect x="1" y="12" width="138" height="91" rx="16" fill="url(#sombraAbajo)" opacity=".5"/>` },
  { vb: [100, 100], c: `<circle cx="50" cy="50" r="49" fill="url(#oro)"/><circle cx="50" cy="50" r="45.5" fill="none" stroke="#a87400" stroke-width="5" stroke-dasharray="1.6 2.2" opacity=".5"/><circle cx="50" cy="50" r="39" fill="#9A1D96"/><circle cx="50" cy="50" r="35.5" fill="url(#discoBlanco)"/>${usaLogo(21, 21, 58)}<path d="M19,40 A33,33 0 0 1 60,15" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".75"/><circle cx="50" cy="50" r="48.5" fill="none" stroke="#9a6a00" stroke-width="1.2"/>` },
  { vb: [100, 100], c: germen('g0', '#3a730a', 8) },
  { vb: [100, 100], c: germen('g1', '#571584', 10) },
  { vb: [100, 100], c: germen('g2', '#8e1a0c', 12) },
  { vb: [100, 100], c: `<circle cx="50" cy="50" r="48" fill="url(#gelCuerpo)"/><path d="M50,22 C62,40 68,50 68,60 A18,18 0 0 1 32,60 C32,50 38,40 50,22 Z" fill="#fff"/><path d="M41,60 A9,9 0 0 0 50,69" stroke="#2ba8e0" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M78,18 L81,25 L88,28 L81,31 L78,38 L75,31 L68,28 L75,25 Z" fill="#fff"/><ellipse cx="31" cy="27" rx="13" ry="5.5" fill="#fff" opacity=".8" transform="rotate(-35 31 27)"/><circle cx="50" cy="50" r="47.3" fill="none" stroke="#1c87bc" stroke-width="1.4" opacity=".6"/>` },
];

export const NOMBRES = ['Tableta', 'Gragea', 'Cápsula', 'Perla', 'Efervescente', 'Microgránulos', 'Blíster', 'Frasco', 'Caja', 'Botiquín', 'Sello Farmasalud'];
const ARCHIVOS = [...FORMAS.map((_, n) => `pieza-${n}`), ...GERMENES.map((_, n) => `germen-${n}`), 'gel'];

/** Medida del dibujo en el mundo, en el orden de imagenDe (la pantalla usa la misma regla). */
export function dibujo(i) {
  if (i < FORMAS.length) return medidas(FORMAS[i]);
  if (i < FORMAS.length + GERMENES.length) { const d = GERMENES[i - FORMAS.length].r * 2.5; return { w: d, h: d }; }
  return { w: 40, h: 40 };
}

/** Todas las figuras: { archivo, w, h (mundo), vb, svg (sin envoltorio) }. Más el logo solo. */
export function catalogo() {
  const sale = ARTE.map((a, i) => ({ archivo: ARCHIVOS[i], ...dibujo(i), vb: a.vb, svg: `<defs>${DEFS}</defs>${a.c}` }));
  sale.push({ archivo: 'logo', w: 100, h: 100, vb: [100, 100], svg: LOGO, sinSombra: true });
  return sale;
}
