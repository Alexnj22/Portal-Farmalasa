// Recorre en el navegador el cobro del asegurado de Mapfre (2026-10-19). SÓLO
// contra el entorno de pruebas, con el portal en `vite --mode staging --port 5173`.
//   node scripts/entorno-pruebas/recorrer_mapfre.mjs <carpeta-de-capturas>
import { chromium } from '@playwright/test';
const C = process.argv[2] || '.';
const BASE = 'http://localhost:5173';
const pasos = [];
const paso = (n, ok, d = '') => pasos.push({ ok: ok ? '✓' : '✗', paso: n, detalle: ok ? '' : String(d).slice(0, 140) });
const b = await chromium.launch();
const errores = [];
try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errores.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.locator('text=/entorno de pruebas/i >> visible=true').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    await p.locator('#username').fill('pruebas'); await p.locator('#password').fill('pruebas2026'); await p.locator('#password').press('Enter');
    await p.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 30_000 });
    await p.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4000 }).catch(() => {});
    await p.goto(`${BASE}/caja?sala=28`);
    const aviso = p.getByText(/factura de Mapfre no tiene|facturas de Mapfre no tienen/).first();
    paso('Mi caja avisa de la factura de Mapfre sin cobro', await aviso.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/m1-aviso.png` });
    await p.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
    await p.getByText('Pago de asegurado Mapfre').first().waitFor({ timeout: 10_000 });
    await p.getByText('Factura 99205').first().waitFor({ timeout: 15_000 });
    paso('la lista NO trae las cobradas', !(await p.getByText('Factura PRUEBA-MAP-1').first().isVisible().catch(() => false)));
    paso('la lista NO trae la anotada como «Otro»', !(await p.getByText('Factura PRUEBA-MAP-3').first().isVisible().catch(() => false)));
    paso('la lista NO trae las de antes del 19-oct', !(await p.getByText('Factura PRUEBA-MAP-VIEJA').first().isVisible().catch(() => false)));
    await p.screenshot({ path: `${C}/m2-lista.png` });
    await p.getByText('Factura 99205').first().click();
    paso('el monto es el de la factura ($10.70)', await p.getByRole('button', { name: /Cobrar \$10\.70/ }).isVisible().catch(() => false));
    paso('sin asegurado no deja cobrar', await p.getByRole('button', { name: /Cobrar \$10\.70/ }).isDisabled());
    await p.getByPlaceholder('Cliente: nombre, DUI o teléfono').fill('CARLOS MAR');
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${C}/m25-busqueda.png` });
    await p.getByRole('button', { name: /^CARLOS MARÍA ALVARADO/ }).first().click({ timeout: 15_000 });
    await p.screenshot({ path: `${C}/m3-listo.png` });
    paso('con asegurado se puede cobrar', await p.getByRole('button', { name: /Cobrar \$10\.70/ }).isEnabled());
    await p.getByRole('button', { name: /Cobrar \$10\.70/ }).click();
    paso('avisa que quedó anotado', await p.getByText('Pago del asegurado anotado.').first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    await p.waitForTimeout(3000);
    paso('el aviso de Mapfre desaparece', !(await p.getByText(/facturas? de Mapfre no tienen?/).first().isVisible().catch(() => false)));
    paso('el movimiento aparece en la lista', await p.getByText(/Fac 99205/).first().isVisible().catch(() => false));
    await p.screenshot({ path: `${C}/m4-anotado.png` });
} catch (e) { paso('el recorrido terminó sin tropezar', false, e.message); }
await b.close();
paso('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.table(pasos);
process.exit(pasos.some((x) => x.ok === '✗') ? 1 : 0);
