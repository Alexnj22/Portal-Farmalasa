// Partículas en un <canvas> sobre toda la pantalla: confeti, pétalos y polvo
// dorado. Un solo rAF mientras haya partículas vivas; después el lienzo se va.
import { sinMovimiento } from './movimiento';

const COLORES = {
  oro: ['#e9c77b', '#f6dfa4', '#d4a94f', '#fff3cf'],
  petalo: ['#f3d6cf', '#ead1c4', '#fbeee6', '#e2b8ab', '#f7e4dc'],
  confeti: ['#6b7f5e', '#c9a77c', '#e9c77b', '#f3d6cf', '#8c6a5d', '#fbf6ec'],
};
let lienzo = null; let ctx = null; let parts = []; let cuadro = 0;

function asegurarLienzo() {
  if (lienzo) return;
  lienzo = document.createElement('canvas');
  lienzo.className = 'lienzo-particulas';
  lienzo.setAttribute('aria-hidden', 'true');
  document.body.appendChild(lienzo);
  ctx = lienzo.getContext('2d');
  medir();
  window.addEventListener('resize', medir);
}
function medir() {
  if (!lienzo) return;
  const r = Math.min(2, window.devicePixelRatio || 1);
  lienzo.width = innerWidth * r; lienzo.height = innerHeight * r;
  ctx.setTransform(r, 0, 0, r, 0, 0);
}
function quitarLienzo() {
  window.removeEventListener('resize', medir);
  lienzo?.remove(); lienzo = null; ctx = null;
}

function paso() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.vida > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vida -= 1; p.vx *= p.roce; p.vy = p.vy * p.roce + p.grav;
    p.x += p.vx + Math.sin((p.vida + p.fase) / 18) * p.vaiven; p.y += p.vy; p.giro += p.vgiro;
    const alfa = Math.min(1, p.vida / 40) * p.alfa;
    ctx.save(); ctx.globalAlpha = alfa; ctx.translate(p.x, p.y); ctx.rotate(p.giro);
    if (p.tipo === 'oro') {
      ctx.shadowColor = p.color; ctx.shadowBlur = p.r * 4;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
    } else if (p.tipo === 'petalo') {
      ctx.scale(1, Math.abs(Math.cos(p.giro * 1.7)) * 0.8 + 0.2);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.6, p.r, 0, 0, 7); ctx.fill();
    } else {
      ctx.scale(1, Math.cos(p.giro * 2));
      ctx.fillStyle = p.color; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
    }
    ctx.restore();
  }
  if (parts.length) cuadro = requestAnimationFrame(paso);
  else { cuadro = 0; quitarLienzo(); }
}

/**
 * lanzar({ x, y, cantidad, tipo: 'oro'|'petalo'|'confeti', fuerza, lluvia })
 * `lluvia`: caen desde arriba de la pantalla en vez de estallar desde (x, y).
 */
export function lanzar({ x = innerWidth / 2, y = innerHeight / 2, cantidad = 60, tipo = 'confeti', fuerza = 9, lluvia = false } = {}) {
  if (typeof window === 'undefined' || sinMovimiento()) return;
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
  if (!cuadro) cuadro = requestAnimationFrame(paso);
}

// El navegador sólo deja vibrar después de un toque en la página; antes, se omite.
export function vibrar(patron = 18) {
  try { if (navigator.userActivation?.isActive !== false || navigator.userActivation?.hasBeenActive) navigator.vibrate?.(patron); } catch { /* nada */ }
}
