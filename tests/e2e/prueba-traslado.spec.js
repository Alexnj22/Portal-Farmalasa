// Prueba real controlada del traslado automático — pedido #102 a Salud 5.
//
// Va por la pantalla de verdad a propósito: la captura de hojas y el disparo
// del traslado viven en el navegador, así que un script contra la base los
// saltearía justo donde hay que mirar.
//
//   PEDIDO=<uuid> npx playwright test tests/e2e/prueba-traslado.spec.js --headed
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const PEDIDO = process.env.PEDIDO;

test.describe('traslado automático', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD || !PEDIDO, 'Requiere E2E_USER/E2E_PASSWORD/PEDIDO');
    test.setTimeout(240_000);

    test('reconocer la pantalla de pedidos', async ({ page }) => {
        const errores = [];
        page.on('console', m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
        // Dejar que la sesión termine de asentarse: navegar encima cancela las
        // peticiones en vuelo y el error se ve igual que un fallo de red.
        await expect(page.getByText('Inicio').first()).toBeVisible({ timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(3000);

        await page.goto('/pedidos?tab=pedidos');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(8000);

        console.log('URL:', page.url());
        const main = page.locator('main').first();
        const cuerpo = (await main.count()) ? await main.innerText() : await page.locator('body').innerText();
        const desde = cuerpo.indexOf('102');
        console.log('CODIGOS:', JSON.stringify([...cuerpo.matchAll(/\d{2}-\d{6}-\d+-\w+/g)].map(m => m[0])));

        // La tarjeta de la prueba, y su botón de finalizar.
        const CODIGO = '03-110826-1-S5';
        const tarjeta = page.locator(`:text("${CODIGO}")`).first();
        await expect(tarjeta).toBeVisible({ timeout: 15_000 });
        await tarjeta.scrollIntoViewIfNeeded();

        // El contenedor real de la tarjeta: el ancestro que ya trae los botones.
        const caja = page.locator('div', { has: page.locator(`:text("${CODIGO}")`) })
            .filter({ has: page.getByRole('button') }).last();
        console.log('TARJETA:', JSON.stringify((await caja.innerText()).replace(/\n{2,}/g, '\n').slice(0, 900)));
        console.log('SUS BOTONES:', JSON.stringify((await caja.getByRole('button').allInnerTexts()).filter(Boolean)));

        const iniciar = caja.getByRole('button', { name: /^iniciar$/i }).first();
        if (await iniciar.count()) {
            await iniciar.click();
            await page.waitForTimeout(4000);
            console.log('TRAS INICIAR:', JSON.stringify((await page.locator('body').innerText())
                .replace(/\n{2,}/g, '\n').slice(0, 400)));
            await page.screenshot({ path: 'test-results/iniciar.png', fullPage: true });
        }

        // Abrir el modal de finalizar. NO se confirma acá: sólo se mira.
        const caja2 = page.locator('div', { has: page.locator(`:text("${CODIGO}")`) })
            .filter({ has: page.getByRole('button', { name: /finalizar/i }) }).last();
        await caja2.getByRole('button', { name: /^finalizar$/i }).first().click();
        await page.waitForTimeout(10_000);   // la verificación arranca al abrir

        const modal = page.locator('.fixed').filter({ hasText: /caja|finaliz/i }).last();
        console.log('MODAL:', JSON.stringify((await modal.innerText()).replace(/\n{2,}/g, '\n').slice(0, 2000)));
        console.log('BOTONES MODAL:', JSON.stringify((await modal.getByRole('button').allInnerTexts()).filter(Boolean)));
        await page.screenshot({ path: 'test-results/modal.png', fullPage: true });

        // Pantalla 1: cuántas cajas salen.
        const campoCajas = modal.locator('input[type="number"], input[type="text"]').first();
        if (await campoCajas.count()) { await campoCajas.fill('1'); await page.waitForTimeout(500); }
        await modal.getByRole('button', { name: /siguiente/i }).first().click();
        await page.waitForTimeout(6000);
        console.log('PANTALLA 2:', JSON.stringify((await modal.innerText()).replace(/\n{2,}/g, '\n').slice(0, 2000)));
        console.log('BOTONES 2:', JSON.stringify((await modal.getByRole('button').allInnerTexts()).filter(Boolean)));
        await page.screenshot({ path: 'test-results/pantalla2.png', fullPage: true });

        // Pantalla 3: qué se envía de verdad. Acá es donde se pone 531 en cero.
        await modal.getByRole('button', { name: /siguiente/i }).first().click();
        await page.waitForTimeout(8000);
        console.log('PANTALLA 3:', JSON.stringify((await modal.innerText()).replace(/\n{2,}/g, '\n').slice(0, 2500)));
        console.log('BOTONES 3:', JSON.stringify((await modal.getByRole('button').allInnerTexts()).filter(Boolean)));
        console.log('CAMPOS 3:', await modal.locator('input').count());
        await page.screenshot({ path: 'test-results/pantalla3.png', fullPage: true });

        // El ajuste es POR EXCEPCIÓN: se busca el producto y se le cambia la
        // cantidad. Acá se pone el CLORURO en cero — el camino «no se envía».
        const buscador = modal.locator('input[placeholder*="Salió distinto"]').first();
        await buscador.fill('CLORURO');
        await page.waitForTimeout(2500);
        const sugerencias = modal.locator('button', { hasText: /asignado/i });
        console.log('SUGERENCIAS:', await sugerencias.count());
        await sugerencias.first().click();
        await page.waitForTimeout(2500);
        console.log('TRAS ELEGIR:', JSON.stringify((await modal.innerText()).replace(/\n{2,}/g, '\n').slice(0, 1600)));

        // La fila del ajuste trae su propio campo de cantidad: a cero.
        const cantidad = modal.locator('input').first();
        await cantidad.fill('0');
        await page.waitForTimeout(2500);
        console.log('CON EL CERO:', JSON.stringify((await modal.innerText()).replace(/\n{2,}/g, '\n').slice(0, 1600)));
        await page.screenshot({ path: 'test-results/ajuste.png', fullPage: true });

        if (!process.env.CONFIRMAR) { console.log('— no se confirma (falta CONFIRMAR=1) —'); return; }

        // ── ACÁ SE MUEVE INVENTARIO DE VERDAD ────────────────────────────────
        await modal.getByRole('button', { name: /confirmar y finalizar/i }).click();
        for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(6000);
            const t = await page.locator('body').innerText();
            if (/no salió al sistema|en el sistema|traslado/i.test(t) || !(await modal.count())) break;
        }
        await page.waitForTimeout(8000);
        console.log('DESPUÉS:', JSON.stringify((await page.locator('body').innerText())
            .replace(/\n{2,}/g, '\n').match(/03-110826-1-S5[\s\S]{0,500}/)?.[0] ?? '(no encontrada)'));
        if (errores.length) console.log('ERRORES:', JSON.stringify(errores.slice(0, 6)));
        await page.screenshot({ path: 'test-results/finalizado.png', fullPage: true });
        if (errores.length) console.log('ERRORES CONSOLA:', JSON.stringify(errores.slice(0, 5)));

        await page.screenshot({ path: 'test-results/pedidos.png', fullPage: true });
    });
});
