// Recorre en el navegador el RETIRO de lo apartado (2026-10-20). SÓLO contra el
// entorno de pruebas, con el portal en `vite --mode staging --port 5173`.
// Aparta con anticipo en efectivo y lo retira al contado (vale automático);
// aparta con tarjeta y comprueba que el retiro pide la factura al crédito.
//   node scripts/entorno-pruebas/recorrer_retirar.mjs <carpeta-de-capturas>
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

async function apartarCon(p, forma) {
    await abrirApartar(p);
    await elegirClienteYProducto(p, 'MICROPORE  2X10', 1);
    await p.getByText(/se aparta 7 días/).first().waitFor({ timeout: 15_000 });
    if (forma !== 'efectivo') {
        await p.getByRole('button', { name: /^Tarjeta$/ }).first().click();
        await p.getByPlaceholder(/Por qué no hay foto|por qué/i).first().fill('Prueba sin voucher').catch(() => {});
    }
    await p.getByRole('button', { name: /^Cobrar anticipo/ }).click();
    await p.getByText('Anticipo cobrado').first().waitFor({ timeout: 30_000 });
    await p.keyboard.press('Escape').catch(() => {});
}

async function abrirRetiro(p) {
    await p.goto(`${BASE}/ofertas-clientes?tab=reservas`);
    const boton = p.getByRole('button', { name: /^Retirar$/ }).first();
    await boton.waitFor({ timeout: 30_000 });
    await boton.click();
    await p.getByText(/^Retirar R-/).first().waitFor({ timeout: 15_000 });
}

try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errores.push(e.message));
    p.on('response', async (r) => { if (/operar-caja|creditos-erp/.test(r.url())) console.log('[resp]', r.status(), (await r.text().catch(() => '')).slice(0, 300)); });
    await p.goto(`${BASE}/login`);
    await p.locator('text=/entorno de pruebas/i >> visible=true').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    await p.locator('#username').fill('pruebas'); await p.locator('#password').fill('pruebas2026'); await p.locator('#password').press('Enter');
    await p.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 30_000 });
    await p.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4000 }).catch(() => {});

    // ── Todo en efectivo: al contado, con vale ──
    if (!process.env.SIN_APARTAR) await apartarCon(p, 'efectivo');
    paso('aparta con anticipo en efectivo', true);
    await abrirRetiro(p);
    paso('el retiro dice factura al contado', await p.getByText(/al contado/).first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/r1-contado.png` });
    await p.getByText('Tarjeta o transferencia', { exact: true }).last().click();
    paso('si el resto es con tarjeta, cambia a crédito', await p.getByText(/al crédito/).first().waitFor({ timeout: 5_000 }).then(() => true).catch(() => false));
    await p.getByText('Efectivo', { exact: true }).last().click();
    await p.getByRole('button', { name: 'Hacer el vale' }).click();
    paso('hace el vale y lo da por retirado', await p.getByText('Retirado').first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
    await p.screenshot({ path: `${C}/r2-vale.png` });
} catch (e) { paso('el recorrido terminó sin tropezar', false, e.message); await b.contexts()[0]?.pages()[0]?.screenshot({ path: `${C}/error.png` }).catch(() => {}); }
await b.close();
paso('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.table(pasos);
process.exit(pasos.some((x) => x.ok === '✗') ? 1 : 0);
