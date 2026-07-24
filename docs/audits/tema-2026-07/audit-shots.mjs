import { chromium } from '/Users/alexnunez/Documents/Portal-Farmalasa/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const env = fs.readFileSync('/Users/alexnunez/Documents/Portal-Farmalasa/.env', 'utf8');
const user = env.match(/^portal-user=(.*)$/m)[1].trim();
const pass = env.match(/^portal-password=(.*)$/m)[1].trim();
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 200)));

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });

// ── Login (tema liquid default) ──
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('01-login-liquid');

await page.fill('#username', user);
await page.fill('#password', pass);
await page.click('text=Ingresar al Portal');
await page.waitForTimeout(5000);
await shot('02-inicio-liquid');

const views = [['/ventas', '03-ventas-liquid'], ['/minmax', '04-minmax-liquid'], ['/pedidos', '05-pedidos-liquid']];
for (const [route, name] of views) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3500);
  await shot(name);
}

// ── Temas alternativos (mismo login, vistas clave) ──
for (const theme of ['dark', 'solid', 'solid-dark']) {
  await page.evaluate(t => localStorage.setItem('portal-theme', t), theme);
  await page.goto(BASE + '/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3500);
  await shot(`06-inicio-${theme}`);
  await page.goto(BASE + '/ventas', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3500);
  await shot(`07-ventas-${theme}`);
}

console.log('done →', OUT);

// ── Fase T2 — matriz del GATE de aprobación ──
// {liquid actual vs solid ("Solid Modern")} × {login, /overview, /ventas,
// /pedidos} × {1440×900, 1366×768 zoom 125% (~1093×614 efectivo), 1024×768}.
// AUDITORIA-TEMA-2026-07.md §4 Fase T2, punto G del plan de ejecución.
const T2_RESOLUTIONS = [
  ['1440x900', 1440, 900],
  ['1366x768-zoom125', 1093, 614],
  ['1024x768', 1024, 768],
];
const T2_AUTH_ROUTES = [['/overview', 'overview'], ['/ventas', 'ventas'], ['/pedidos', 'pedidos']];
const T2_OUT = new URL('./shots-t2-gate/', import.meta.url).pathname;
fs.mkdirSync(T2_OUT, { recursive: true });

// /login se captura en un contexto NUEVO sin sesión (la página actual ya está
// autenticada — navegar a /login redirige a /overview vía App.jsx).
const loginCtx = await browser.newContext({ deviceScaleFactor: 1.5 });
const loginPage = await loginCtx.newPage();
for (const theme of ['liquid', 'solid']) {
  await loginPage.goto(BASE + '/login', { waitUntil: 'networkidle' }).catch(() => {});
  await loginPage.evaluate(t => {
    if (t === 'liquid') localStorage.removeItem('portal-theme');
    else localStorage.setItem('portal-theme', t);
  }, theme);
  for (const [resName, w, h] of T2_RESOLUTIONS) {
    await loginPage.setViewportSize({ width: w, height: h });
    await loginPage.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await loginPage.waitForTimeout(1200);
    await loginPage.screenshot({ path: `${T2_OUT}${theme}-login-${resName}.png` });
  }
}
await loginCtx.close();

for (const theme of ['liquid', 'solid']) {
  await page.evaluate(t => {
    if (t === 'liquid') localStorage.removeItem('portal-theme');
    else localStorage.setItem('portal-theme', t);
  }, theme);
  for (const [resName, w, h] of T2_RESOLUTIONS) {
    await page.setViewportSize({ width: w, height: h });
    for (const [route, routeName] of T2_AUTH_ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${T2_OUT}${theme}-${routeName}-${resName}.png` });
    }
  }
}
console.log('T2 gate matrix done →', T2_OUT);

// ── Fase T7.2 — matriz completa de QA final ─────────────────────────────
// {4 temas: liquid/dark/solid/solid-dark} × {login, /overview, /ventas,
// /pedidos, /minmax, menú abierto, un modal abierto} × {1440×900,
// 1366×768 zoom 125% (~1093×614 efectivo), 1024×768, iPhone 13}.
// AUDITORIA-TEMA-2026-07.md §4 Fase T7, T7.2.
const T7_THEMES = ['liquid', 'dark', 'solid', 'solid-dark'];
const T7_RESOLUTIONS = [
  ['1440x900', { width: 1440, height: 900 }, 1.5],
  ['1366x768-zoom125', { width: 1093, height: 614 }, 1.5],
  ['1024x768', { width: 1024, height: 768 }, 1.5],
  ['iphone13', { width: 390, height: 844 }, 3],
];
const T7_OUT = new URL('./shots-t7-final/', import.meta.url).pathname;
fs.mkdirSync(T7_OUT, { recursive: true });

const setTheme = (p, t) => p.evaluate(theme => {
  if (theme === 'liquid') localStorage.removeItem('portal-theme');
  else localStorage.setItem('portal-theme', theme);
}, t);

// Login — contexto nuevo sin sesión por cada combinación tema×resolución.
for (const theme of T7_THEMES) {
  for (const [resName, viewport, dsf] of T7_RESOLUTIONS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
    const p = await ctx.newPage();
    await p.goto(BASE + '/login', { waitUntil: 'networkidle' }).catch(() => {});
    await setTheme(p, theme);
    await p.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${T7_OUT}${theme}-login-${resName}.png` });
    await ctx.close();
  }
}
console.log('T7.2 login matrix done');

// Vistas autenticadas + menú + modal — un contexto por tema (login una vez),
// reutilizado a través de las 4 resoluciones.
const T7_ROUTES = [['/overview', 'overview'], ['/ventas', 'ventas'], ['/pedidos', 'pedidos'], ['/minmax', 'minmax']];

for (const theme of T7_THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#username', user);
  await p.fill('#password', pass);
  await p.click('text=Ingresar al Portal');
  await p.waitForTimeout(4000);
  await setTheme(p, theme);

  for (const [resName, viewport] of T7_RESOLUTIONS) {
    await p.setViewportSize(viewport);
    for (const [route, routeName] of T7_ROUTES) {
      await p.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
      await p.waitForTimeout(3000);
      await p.screenshot({ path: `${T7_OUT}${theme}-${routeName}-${resName}.png` });
    }
  }

  // Menú abierto (buscador ⌘K) — 1440×900 únicamente, no depende de resolución.
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(BASE + '/overview', { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(2000);
  await p.keyboard.press('Meta+k').catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${T7_OUT}${theme}-menu-search-1440x900.png` });
  await p.keyboard.press('Escape').catch(() => {});

  // Un modal abierto (ConfirmModal vía "Activar todo" en Permisos) — 1440×900.
  await p.goto(BASE + '/permissions', { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.click('text=Gerente General').catch(() => {});
  await p.waitForTimeout(1200);
  await p.click('text=Activar todo').catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${T7_OUT}${theme}-modal-1440x900.png` });

  await ctx.close();
}
console.log('T7.2 full matrix done →', T7_OUT);

await browser.close();
