// Recorre en el navegador los premios del raspable que no son puntos
// (2026-10-19). SÓLO contra el entorno de pruebas, con el portal en
// `vite --mode staging --port 5173`, y con dos premios sembrados: PS-000002
// (promocional en Salud 4, con existencia) y PS-000004 (producto). El de
// producto NO se puede descargar en pruebas —ahí no hay sistema de la caja—:
// lo que se prueba es que la falla no lo deje marcado como entregado.
//   node scripts/entorno-pruebas/recorrer_premios.mjs <carpeta-de-capturas>
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

    // ── Premios: entregar el promocional ──
    await p.goto(`${BASE}/puntos?tab=premios`);
    paso('la pestaña Premios abre', await p.getByText('Premios por entregar').first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
    await p.getByPlaceholder('Código, cliente o DUI').fill('PS-000002');
    const tarjetaPromo = p.locator('li', { hasText: 'PS-000002' }).first();
    paso('busca por código', await tarjetaPromo.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/p1-por-entregar.png` });
    await tarjetaPromo.getByRole('button', { name: 'Entregar' }).click();
    await p.getByRole('button', { name: 'Entregar', exact: true }).last().click();
    paso('el promocional se entrega', await p.getByText('Premio entregado').first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    await p.waitForTimeout(1500);
    paso('sale de la lista de por entregar', !(await p.locator('li', { hasText: 'PS-000002' }).first().isVisible().catch(() => false)));

    // ── Premios: el producto, sin sistema de la caja, falla y NO queda entregado ──
    await p.getByPlaceholder('Código, cliente o DUI').fill('PS-000004');
    const tarjetaProd = p.locator('li', { hasText: 'PS-000004' }).first();
    await tarjetaProd.waitFor({ timeout: 15_000 });
    await tarjetaProd.getByRole('button', { name: 'Entregar' }).click();
    await p.getByRole('button', { name: 'Entregar', exact: true }).last().click();
    paso('el producto sin sistema de la caja avisa que no se pudo', await p.getByText('No se pudo entregar').first().waitFor({ timeout: 40_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/p2-producto-falla.png` });
    await p.getByRole('button', { name: 'Cancelar' }).last().click().catch(() => {});
    await p.reload();
    await p.getByPlaceholder('Código, cliente o DUI').fill('PS-000004');
    paso('el producto sigue por retirar', await p.locator('li', { hasText: 'PS-000004' }).first().getByText('Por retirar').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));

    // ── Regalos: nuevo, entrada a Bodega, envío ──
    await p.getByRole('button', { name: 'Nuevo regalo' }).click();
    await p.getByPlaceholder('Termo Salud').fill('PRUEBA Bolsa ecológica');
    await p.getByRole('button', { name: 'Guardar' }).click();
    paso('crea un regalo', await p.getByText('Regalo guardado').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
    const tarjetaBolsa = p.locator('li', { hasText: 'PRUEBA Bolsa ecológica' }).first();
    await tarjetaBolsa.waitFor({ timeout: 15_000 });
    await tarjetaBolsa.getByRole('button', { name: 'Entrada o ajuste' }).click();
    await p.waitForTimeout(800); await p.screenshot({ path: `${C}/p25-entrada.png` });
    await p.getByPlaceholder('10, o −2 para restar').fill('5');
    await p.getByRole('button', { name: 'Guardar' }).click();
    paso('entrada a Bodega', await p.getByText('Entrada anotada').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
    await p.waitForTimeout(1200);
    paso('la tarjeta dice Bodega 5', await p.locator('li', { hasText: 'PRUEBA Bolsa ecológica' }).first().getByText(/Bodega 5/).isVisible().catch(() => false));
    await p.screenshot({ path: `${C}/p3-regalos.png` });

    // ── Niveles: el editor ofrece los tres tipos ──
    await p.goto(`${BASE}/puntos?tab=niveles`);
    await p.getByText('Raspable del mes').first().waitFor({ timeout: 30_000 });
    paso('el editor muestra el producto configurado', await p.getByText('Micropore').first().isVisible().catch(() => false));
    paso('el editor muestra el promocional configurado', await p.getByText('Termo Salud').first().isVisible().catch(() => false));
    await p.getByText('Raspable del mes').first().scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
    await p.screenshot({ path: `${C}/p4-niveles.png` });
} catch (e) { paso('el recorrido terminó sin tropezar', false, e.message); }
await b.close();
paso('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.table(pasos);
process.exit(pasos.some((x) => x.ok === '✗') ? 1 : 0);
