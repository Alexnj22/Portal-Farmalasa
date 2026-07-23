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

await browser.close();
