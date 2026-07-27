import { chromium } from '/Users/alexnunez/Documents/Portal-Farmalasa/node_modules/playwright/index.mjs';
import fs from 'fs';

const OUT = '/Users/alexnunez/Documents/Portal-Farmalasa/docs/audits/diseno-2026-07-26/post-D1b';
const EXE = '/Users/alexnunez/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
fs.mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync('/Users/alexnunez/Documents/Portal-Farmalasa/.env', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const ROUTES = [
  'overview', 'ventas', 'productos', 'pedidos', 'minmax', 'requests', 'staff',
  'schedules', 'payroll', 'branches', 'facturacion', 'cotizaciones', 'promociones',
  'proveedores', 'facturas-compra', 'compras', 'audit', 'roles', 'permissions',
  'announcements', 'encuesta', 'monitor', 'vacation-plan', 'ventas-perdidas',
  'conteo-inventario', 'my-requests', 'my-documents', 'profile', 'laboratorios',
];

// Escáner de "blanco que no debería estar" + contraste, corrido DENTRO de la página.
const SCAN = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Devuelve null si en el camino hay un backgroundImage (gradiente, patrón,
  // foto): ahí el color efectivo no se puede determinar leyendo backgroundColor
  // y medir contra el ancestro da un número inventado. Falso positivo real:
  // el banner de construcción usa repeating-linear-gradient sin
  // backgroundColor, así que el walk lo atravesaba y medía su texto oscuro
  // contra el fondo oscuro de la página → 1.1:1 reportado, 8.28:1 real.
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a >= 0.85) return c;
      n = n.parentElement;
    }
    return { r: 8, g: 12, b: 30, a: 1 }; // fondo de página dark
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };

  const white = [], lowContrast = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;

    // 1) superficie casi blanca y opaca, de tamaño real → sospechoso en dark
    const bg = parse(cs.backgroundColor);
    if (bg && bg.a >= 0.6 && bg.r >= 232 && bg.g >= 232 && bg.b >= 232 && r.width * r.height >= 2400) {
      white.push({ cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 110), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor });
    }

    // 2) contraste de texto real (solo nodos con texto propio)
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own) {
      const fg = parse(cs.color);
      const bg = fg && fg.a > 0.5 ? effBg(el) : null;
      if (fg && fg.a > 0.5 && bg) {
        const cr = ratio(fg, bg);
        const px = parseFloat(cs.fontSize) || 16;
        const bold = (parseInt(cs.fontWeight) || 400) >= 700;
        const min = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
        if (cr < min) lowContrast.push({ txt: el.textContent.trim().slice(0, 40), px: Math.round(px), cr: +cr.toFixed(2), min, color: cs.color });
      }
    }
  }
  const dedupe = (a, k) => { const s = new Set(), o = []; for (const x of a) { const key = k(x); if (!s.has(key)) { s.add(key); o.push(x); } } return o; };
  return {
    white: dedupe(white, x => x.cls + x.bg).slice(0, 8),
    whiteTotal: white.length,
    lowContrast: dedupe(lowContrast, x => x.color + x.px).slice(0, 6),
    lowContrastTotal: lowContrast.length,
  };
};

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const consoleErrs = {};
let currentRoute = '';
page.on('console', m => { if (m.type() === 'error') (consoleErrs[currentRoute] ??= []).push(m.text().slice(0, 120)); });

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#username', { timeout: 30000 });
await page.screenshot({ path: `${OUT}/login.png` });
await page.fill('#username', env.E2E_USER);
await page.fill('#password', env.E2E_PASSWORD);
await page.click('button:has-text("Ingresar al Portal")');
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 40000 });
await page.waitForTimeout(4000);

const forceDark = () => page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
const report = {};

for (const r of ROUTES) {
  currentRoute = r;
  try {
    await page.goto(`http://localhost:4173/${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);          // deja que cargue Y que useThemeSync aterrice
    await forceDark();
    await page.waitForTimeout(900);
    const res = await page.evaluate(SCAN);
    report[r] = res;
    await page.screenshot({ path: `${OUT}/dark-${r}.png` });
    console.log(`${r.padEnd(20)} blanco:${String(res.whiteTotal).padStart(3)}  bajo-contraste:${String(res.lowContrastTotal).padStart(3)}`);
  } catch (e) {
    report[r] = { error: e.message.slice(0, 120) };
    console.log(`${r.padEnd(20)} ERROR ${e.message.slice(0, 60)}`);
  }
}

fs.writeFileSync(`${OUT}/scan-dark-post-D1b.json`, JSON.stringify({ report, consoleErrs }, null, 2));
console.log('\n=== escrito scan-dark-post-D1b.json ===');
await browser.close();
