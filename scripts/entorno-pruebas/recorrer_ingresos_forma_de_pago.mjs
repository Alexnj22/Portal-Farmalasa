// Recorre en el navegador lo que la sala ve del ingreso con forma de pago
// (2026-10-17). SÓLO contra el entorno de pruebas: el portal tiene que estar
// levantado con `vite --mode staging --port 5173` y se niega si no ve el
// letrero de pruebas. Deja capturas en la carpeta que se le pase.
//
//   node scripts/entorno-pruebas/recorrer_ingresos_forma_de_pago.mjs <carpeta>
import { chromium } from '@playwright/test';

const CARPETA = process.argv[2] || '.';
const BASE = 'http://localhost:5173';
const SALA = 28;
const pasos = [];
const paso = (nombre, ok, detalle = '') => pasos.push({ ok: ok ? '✓' : '✗', nombre, detalle: String(detalle).slice(0, 140) });
const foto = (page, n) => page.screenshot({ path: `${CARPETA}/${n}.png`, fullPage: false });

async function entrar(page, usuario) {
    await page.goto(`${BASE}/login`);
    await page.locator('text=/entorno de pruebas/i >> visible=true').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 4; i++) {
        await page.locator('#username').fill(usuario);
        await page.locator('#password').fill('pruebas2026');
        await page.waitForTimeout(300);
        if (await page.locator('#username').inputValue() === usuario) break;
    }
    await page.locator('#password').press('Enter');
    await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 30_000 });
    await page.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4_000 }).catch(() => {});
}

const navegador = await chromium.launch();
const errores = [];
try {
    // ── La sala anota ──────────────────────────────────────────────────────
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    await entrar(page, 'pruebas');
    await page.goto(`${BASE}/caja?sala=${SALA}`);
    await page.getByRole('button', { name: /^entrada$/i }).first().waitFor({ timeout: 30_000 });
    await foto(page, '01-mi-caja');
    await page.getByRole('button', { name: /^entrada$/i }).first().click();
    await page.getByText('Anotar un ingreso').first().waitFor({ timeout: 10_000 });

    // Elegir «Otro»
    await page.getByText('Elige de qué se trata').first().click();
    await page.getByRole('option', { name: /^Otro$/ }).first().click().catch(async () => {
        await page.getByText(/^Otro$/).last().click();
    });
    const tieneForma = await page.getByText('Cómo pagó', { exact: true }).first().isVisible().catch(() => false);
    paso('el ingreso pregunta «Cómo pagó»', tieneForma);
    await foto(page, '02-dialogo-efectivo');

    await page.getByRole('radio', { name: 'Tarjeta' }).first().click().catch(async () => {
        await page.getByText('Tarjeta', { exact: true }).first().click();
    });
    paso('con tarjeta pide la foto del voucher', await page.getByText('Foto del voucher').first().isVisible().catch(() => false));
    paso('con tarjeta dice que no entra al cajón', await page.getByText(/No entra al cajón/).first().isVisible().catch(() => false));
    const anotar = page.getByRole('button', { name: /^Anotar$/ });
    paso('sin foto ni «no tengo» el botón queda apagado', await anotar.isDisabled());
    await foto(page, '03-dialogo-tarjeta');

    await page.getByText('No tengo el voucher').first().click();
    paso('«no tengo» avisa que queda pendiente de autorización', await page.getByText(/pendiente de autorización/).first().isVisible().catch(() => false));
    await page.getByLabel(/Por qué no hay voucher/i).fill('el POS no imprimió el voucher').catch(async () => {
        await page.locator('textarea').first().fill('el POS no imprimió el voucher');
    });
    await page.getByLabel(/Cuánto es de este ingreso/i).fill('3.25').catch(async () => {
        await page.locator('input[inputmode="decimal"]').first().fill('3.25');
    });
    await page.getByPlaceholder('de qué se trata').first().fill('prueba en pantalla');
    await foto(page, '04-dialogo-sin-voucher');
    paso('con el motivo el botón se enciende', await anotar.isEnabled());
    await anotar.click();
    const toast = await page.getByText(/falta autorizarlo/i).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    paso('al anotar avisa «falta autorizarlo»', toast);
    // La pantalla pinta primero lo que dice la base y después lo que contesta
    // la caja: se espera a que llegue el panel del efectivo.
    await page.getByText(/Ingresos con tarjeta o transferencia/).first().waitFor({ timeout: 25_000 }).catch(() => {});
    await foto(page, '05-despues-de-anotar');

    // La fila en la lista del día
    await page.getByText('prueba en pantalla').first().scrollIntoViewIfNeeded().catch(() => {});
    paso('la lista marca «No entra al cajón»', await page.getByText('No entra al cajón').first().isVisible().catch(() => false));
    paso('la lista marca «Falta autorizarlo»', await page.getByText('Falta autorizarlo').first().isVisible().catch(() => false));
    paso('el panel muestra el renglón de tarjeta/transferencia',
        await page.getByText(/Ingresos con tarjeta o transferencia/).first().isVisible().catch(() => false));
    await foto(page, '06-lista-del-dia');

    // Pedir cambio de forma de pago
    await page.getByText('prueba en pantalla').first().click();
    await page.getByRole('button', { name: 'Corregir' }).first().click();
    paso('corregir ofrece «Cambiar cómo pagó»', await page.getByRole('button', { name: 'Cambiar cómo pagó' }).isVisible().catch(() => false));
    await page.getByRole('button', { name: 'Cambiar cómo pagó' }).click();
    await page.getByText('Efectivo', { exact: true }).last().click();
    paso('a efectivo avisa que entra a la caja', await page.getByText(/entra a la caja del día/).first().isVisible().catch(() => false));
    await page.getByPlaceholder('Se anotó dos veces').fill('en realidad pagó en efectivo');
    await foto(page, '07-corregir-forma');
    await page.getByRole('button', { name: 'Pedir' }).click();
    paso('pedir la corrección', await page.getByText(/Queda pedido/).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    await ctx.close();

    // ── Quien decide ───────────────────────────────────────────────────────
    const ctx2 = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errores.push(e.message));
    await entrar(p2, 'qa.test');
    await p2.goto(`${BASE}/solicitudes`);
    await p2.waitForTimeout(5000);
    paso('la bandeja muestra «Ingreso sin comprobante»', await p2.getByText(/Ingreso sin comprobante/).first().isVisible().catch(() => false));
    paso('la bandeja muestra la corrección de caja pedida', await p2.getByText('en realidad pagó en efectivo').first().isVisible().catch(() => false));
    await foto(p2, '08-bandeja');
    await p2.getByText('el POS no imprimió el voucher').last().click();
    await p2.waitForTimeout(2000);
    paso('el detalle explica que no entra al cajón', await p2.getByText(/No entra al cajón/).first().isVisible().catch(() => false));
    await foto(p2, '09-detalle-autorizacion');
    // Aprobar desde la pantalla: pasa por `approveRequest` → `_decidirIngreso`.
    await p2.getByRole('button', { name: 'Aprobar' }).last().click();
    paso('aprobar desde la pantalla autoriza el ingreso',
        await p2.getByText(/Solicitud aprobada|Ingreso autorizado/).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    await foto(p2, '10-autorizado');
    await p2.waitForTimeout(1500);
    await p2.getByText('en realidad pagó en efectivo').last().click();
    await p2.waitForTimeout(2000);
    paso('el detalle de la corrección dice que entra a la caja', await p2.getByText(/mete este monto en la caja/).first().isVisible().catch(() => false));
    await foto(p2, '11-detalle-correccion');
    await p2.getByRole('button', { name: 'Aprobar' }).last().click();
    paso('aprobar la corrección desde la pantalla la pasa a efectivo',
        await p2.getByText(/Solicitud aprobada|Forma de pago cambiada/).first().waitFor({ timeout: 25_000 }).then(() => true).catch(() => false));
    await foto(p2, '12-correccion-aprobada');
    await ctx2.close();
} catch (e) {
    paso('el recorrido terminó sin tropezar', false, e.message);
} finally {
    await navegador.close();
}
paso('sin errores de JavaScript en la página', errores.length === 0, errores.join(' | '));
console.table(pasos);
process.exit(pasos.some((p) => p.ok === '✗') ? 1 : 0);
