// Partículas en un <canvas> sobre toda la pantalla: confeti, pétalos y polvo
// dorado. Un solo rAF mientras haya partículas vivas; después el lienzo se va.
import { sinMovimiento } from './movimiento';

// Champán mate, lino y oliva: la paleta del sitio, sin colores de fiesta.
const COLORES = {
  oro: ['#c9ad7e', '#dcc7a2', '#b39467', '#ede7db'],
  petalo: ['#ede7db', '#e2d8c6', '#d6c9b2', '#f4efe6'],
  confeti: ['#c9ad7e', '#ede7db', '#91976d', '#b39467', '#d6c9b2'],
};
let lienzo = null; let ctx = null; let parts = []; let cuadro = 0;
let ancho = 0; let alto = 0;
let contenedor = null; // por defecto <body>; el sobre lo pone dentro de su <dialog> (capa superior)

/** Dónde vive el lienzo: dentro de un <dialog> abierto o en <body>. Mueve el que exista. */
export function fijarContenedor(el) {
  contenedor = el;
  if (lienzo) (contenedor || document.body).appendChild(lienzo);
}

// El polvo dorado se dibuja de un sprite pre-renderizado (un círculo con su
// halo, uno por color): drawImage es barato; shadowBlur por partícula costaba
// cuadros en un Android modesto.
const sprites = {};
function sprite(color) {
  if (sprites[color]) return sprites[color];
  const t = 32; const c = document.createElement('canvas');
  c.width = t; c.height = t;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(t / 2, t / 2, 0, t / 2, t / 2, t / 2);
  r.addColorStop(0, color); r.addColorStop(0.28, color); r.addColorStop(0.45, `${color}88`); r.addColorStop(1, `${color}00`);
  g.fillStyle = r; g.fillRect(0, 0, t, t);
  sprites[color] = c;
  return c;
}

function asegurarLienzo() {
  if (lienzo) return;
  lienzo = document.createElement('canvas');
  lienzo.className = 'lienzo-particulas';
  lienzo.setAttribute('aria-hidden', 'true');
  (contenedor || document.body).appendChild(lienzo);
  ctx = lienzo.getContext('2d');
  medir();
  window.addEventListener('resize', medir);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
}
function medir() {
  if (!lienzo) return;
  const r = Math.min(2, window.devicePixelRatio || 1);
  ancho = lienzo.clientWidth || window.innerWidth; alto = lienzo.clientHeight || window.innerHeight;
  lienzo.width = Math.round(ancho * r); lienzo.height = Math.round(alto * r);
  ctx.setTransform(r, 0, 0, r, 0, 0);
}
function quitarLienzo() {
  window.removeEventListener('resize', medir);
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  lienzo?.remove(); lienzo = null; ctx = null;
}
// Con la pestaña oculta no se dibuja nada; al volver sigue donde iba.
function alCambiarVisibilidad() {
  if (document.hidden) { cancelAnimationFrame(cuadro); cuadro = 0; } else if (parts.length && !cuadro) cuadro = requestAnimationFrame(paso);
}

function paso() {
  ctx.clearRect(0, 0, ancho, alto);
  parts = parts.filter((p) => p.vida > 0 && p.y < alto + 40);
  for (const p of parts) {
    p.vida -= 1; p.vx *= p.roce; p.vy = p.vy * p.roce + p.grav;
    p.x += p.vx + Math.sin((p.vida + p.fase) / 18) * p.vaiven; p.y += p.vy; p.giro += p.vgiro;
    const alfa = Math.min(1, p.vida / 40) * p.alfa;
    ctx.globalAlpha = alfa;
    if (p.tipo === 'oro') {
      const d = p.r * 5;
      ctx.drawImage(sprite(p.color), p.x - d / 2, p.y - d / 2, d, d);
      continue;
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.giro);
    if (p.tipo === 'petalo') {
      ctx.scale(1, Math.abs(Math.cos(p.giro * 1.7)) * 0.8 + 0.2);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.6, p.r, 0, 0, 7); ctx.fill();
    } else {
      ctx.scale(1, Math.cos(p.giro * 2));
      ctx.fillStyle = p.color; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (parts.length) cuadro = requestAnimationFrame(paso);
  else { cuadro = 0; quitarLienzo(); }
}

/**
 * lanzar({ x, y, cantidad, tipo: 'oro'|'petalo'|'confeti', fuerza, lluvia })
 * `lluvia`: caen desde arriba de la pantalla en vez de estallar desde (x, y).
 */
export function lanzar({ x = innerWidth / 2, y = innerHeight / 2, cantidad = 60, tipo = 'confeti', fuerza = 9, lluvia = false } = {}) {
  if (typeof window === 'undefined' || sinMovimiento() || document.hidden) return;
  asegurarLienzo();
  const colores = COLORES[tipo];
  for (let i = 0; i < cantidad; i++) {
    const ang = Math.random() * Math.PI * 2;
    const v = (0.35 + Math.random() * 0.65) * fuerza;
    parts.push({
      tipo, color: colores[i % colores.length],
      x: lluvia ? Math.random() * innerWidth : x, y: lluvia ? -20 - Math.random() * innerHeight * 0.6 : y,
      vx: lluvia ? (Math.random() - 0.5) * 1.2 : Math.cos(ang) * v, vy: lluvia ? 1 + Math.random() * 1.6 : Math.sin(ang) * v - fuerza * 0.35,
      grav: tipo === 'oro' ? 0.02 : tipo === 'petalo' ? 0.035 : 0.16, roce: tipo === 'confeti' ? 0.985 : 0.975,
      r: tipo === 'oro' ? 1 + Math.random() * 2.2 : tipo === 'petalo' ? 5 + Math.random() * 5 : 4 + Math.random() * 4,
      giro: Math.random() * 6, vgiro: (Math.random() - 0.5) * 0.2, vaiven: tipo === 'confeti' ? 0.3 : 0.9, fase: Math.random() * 100,
      vida: 160 + Math.random() * (lluvia ? 260 : 120), alfa: tipo === 'oro' ? 0.95 : 1,
    });
  }
  if (!cuadro && !document.hidden) cuadro = requestAnimationFrame(paso);
}

// El navegador sólo deja vibrar después de un toque en la página; antes, se omite.
export function vibrar(patron = 18) {
  try { if (navigator.userActivation?.isActive !== false || navigator.userActivation?.hasBeenActive) navigator.vibrate?.(patron); } catch { /* nada */ }
}
