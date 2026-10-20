// Recorre en el navegador «Apartar o encargar» (2026-10-20). SÓLO contra el
// entorno de pruebas, con el portal en `vite --mode staging --port 5173`.
// Aparta un producto que HAY en Salud 4 (anticipo del 50 % en efectivo) y
// registra un encargo de uno que no alcanza.
//   node scripts/entorno-pruebas/recorrer_apartar.mjs <carpeta-de-capturas>
import { chromium } from '@playwright/test';
const C = process.argv[2] || '.';
const BASE = 'http://localhost:5173';
const pasos = [];
const paso = (n, ok, d = '') => pasos.push({ ok: ok ? '✓' : '✗', paso: n, detalle: ok ? '' : String(d).slice(0, 140) });
const b = await chromium.launch();
const errores = [];

async function abrirApartar(p) {
    await p.goto(`${BASE}/caja?sala=28`);
    await p.getByRole('button', { name: /^entrada$/i }).first().waitFor({ timeout: 30_000 });
    await p.getByRole('button', { name: /^entrada$/i }).first().click();
    await p.getByText('Anotar un ingreso').first().waitFor({ timeout: 10_000 });
    await p.getByText('Elige de qué se trata').first().click();
    await p.getByRole('option', { name: /Apartar o encargar/ }).first().click().catch(async () => {
        await p.getByText(/Apartar o encargar/).last().click();
    });
    await p.getByText('Si hay en la sala se aparta').first().waitFor({ timeout: 15_000 });
}
async function elegirClienteYProducto(p, producto, cantidad) {
    await p.getByPlaceholder('Cliente: nombre, DUI o teléfono').fill('CARLOS MAR');
    await p.getByRole('button', { name: /^CARLOS MARÍA ALVARADO/ }).first().click({ timeout: 15_000 });
    await p.getByPlaceholder('Producto a apartar o encargar…').fill(producto);
    await p.getByText(producto).first().click({ timeout: 15_000 });
    await p.getByText('¿Cuál?').first().click();
    await p.getByRole('option').first().click();
    await p.locator('input[type=number]').last().fill(String(cantidad));
}

try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errores.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.locator('text=/entorno de pruebas/i >> visible=true').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    await p.locator('#username').fill('pruebas'); await p.locator('#password').fill('pruebas2026'); await p.locator('#password').press('Enter');
    await p.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 30_000 });
    await p.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4000 }).catch(() => {});

    // ── Apartar: hay 18 en Salud 4 ──
    await abrirApartar(p);
    paso('el motivo «Apartar o encargar» abre su diálogo', true);
    await elegirClienteYProducto(p, 'MICROPORE  2X10', 2);
    paso('con existencia, dice que se aparta', await p.getByText(/se aparta 7 días/).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/a1-apartar.png` });
    const cobrar = p.getByRole('button', { name: /^Cobrar anticipo/ });
    paso('el anticipo nace en el 50 %', /\$4\.\d\d/.test(await cobrar.textContent().catch(() => '')), await cobrar.textContent().catch(() => ''));
    await cobrar.click();
    paso('cobra el anticipo', await p.getByText('Anticipo cobrado').first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/a2-cobrado.png` });

    // ── Encargar: hay 3 de este y se piden 5 ──
    await abrirApartar(p);
    await elegirClienteYProducto(p, 'MICROPORE 1/2X10', 5);
    paso('sin existencia suficiente, dice que se encarga', await p.getByText(/se encarga/).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
    await p.getByRole('button', { name: 'Registrar encargo' }).click();
    paso('registra el encargo sin cobrar', await p.getByText('Encargo registrado').first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/a3-encargo.png` });
} catch (e) { paso('el recorrido terminó sin tropezar', false, e.message); await b.contexts()[0]?.pages()[0]?.screenshot({ path: `${C}/error.png` }).catch(() => {}); }
await b.close();
paso('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.table(pasos);
process.exit(pasos.some((x) => x.ok === '✗') ? 1 : 0);
