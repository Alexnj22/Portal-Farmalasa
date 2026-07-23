// Verificación de contraste AA (WCAG 2.1) sobre los tokens de tema —
// Fase T2, AUDITORIA-TEMA-2026-07.md §8.1/§8.4. Matemática de luminancia
// relativa en JS puro, sin dependencias nuevas. Reutilizable para
// cualquier tema futuro: agregar sus pares a THEMES abajo.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Acepta 'rgba(r,g,b,a)' compuesto sobre un fondo opaco conocido (blend
// manual, ya que WCAG exige el color final percibido, no el canal alpha).
function parseColor(str, bgRgb) {
  if (str.startsWith('#')) return hexToRgb(str);
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error('color no reconocido: ' + str);
  const [r, g, b, a = 1] = m[1].split(',').map(s => parseFloat(s));
  if (a >= 1 || !bgRgb) return [r, g, b];
  return [0, 1, 2].map(i => r_g_b(i));
  function r_g_b(i) {
    const fg = [r, g, b][i];
    return fg * a + bgRgb[i] * (1 - a);
  }
}

function relLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg), l2 = relLuminance(bg);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// Fondos opacos de referencia por tema, para resolver superficies con
// alpha < 1 (blend manual sobre el fondo de página real de cada tema).
const PAGE_BG_OPAQUE = {
  liquid: [0xe4, 0xe0, 0xff],       // aprox. del gradiente --bg-page
  dark:   [0x13, 0x0d, 0x35],
  solid:  [0xf4, 0xf6, 0xfb],
  'solid-dark': [0x0f, 0x17, 0x2a],
};

// Tokens por tema — texto (fg) sobre superficie (bg). Ampliar si se agregan
// más pares durante T3/T4.
const THEMES = {
  liquid: {
    bg: PAGE_BG_OPAQUE.liquid,
    surfaceCard: 'rgba(230,245,255,0.16)',
    content: '#1e293b', content2: '#475569', content3: '#64748b',
  },
  dark: {
    bg: PAGE_BG_OPAQUE.dark,
    surfaceCard: 'rgba(20,30,70,0.50)',
    content: 'rgba(255,255,255,0.92)', content2: 'rgba(255,255,255,0.62)', content3: 'rgba(255,255,255,0.42)',
  },
  solid: {
    bg: PAGE_BG_OPAQUE.solid,
    surfaceCard: 'rgba(255,255,255,1.00)',
    content: '#0f172a', content2: '#475569', content3: '#64748b',
  },
  'solid-dark': {
    bg: PAGE_BG_OPAQUE['solid-dark'],
    surfaceCard: 'rgba(30,41,59,1.00)',
    content: 'rgba(248,250,252,0.95)', content2: 'rgba(148,163,184,0.90)', content3: 'rgba(148,163,184,0.90)',
  },
};

const AA_NORMAL = 4.5, AA_LARGE = 3.0;
let failures = 0;

console.log('Verificación de contraste AA — pares texto/superficie por tema\n');
for (const [themeName, t] of Object.entries(THEMES)) {
  console.log(`── ${themeName} ──`);
  // Superficie de página (fondo detrás de las cards, blend con --surface-page transparent → bg-page opaco)
  const surfaceCardResolved = parseColor(t.surfaceCard, t.bg);
  for (const [role, hex] of [['content', t.content], ['content-2', t.content2], ['content-3', t.content3]]) {
    const fg = parseColor(hex, surfaceCardResolved);
    const ratio = contrastRatio(fg, surfaceCardResolved);
    const min = role === 'content-3' ? AA_LARGE : AA_NORMAL; // content-3 = caption/tertiary, tratado como texto grande
    const pass = ratio >= min;
    if (!pass) failures++;
    console.log(`  ${role.padEnd(10)} sobre surface-card:  ${ratio.toFixed(2)}:1  ${pass ? 'PASS' : 'FAIL'} (mín ${min}:1)`);
  }
  console.log('');
}

if (failures > 0) {
  console.log(`${failures} par(es) NO cumplen AA — revisar antes de cerrar T2/T4.`);
  process.exit(1);
} else {
  console.log('Todos los pares cumplen AA.');
}
