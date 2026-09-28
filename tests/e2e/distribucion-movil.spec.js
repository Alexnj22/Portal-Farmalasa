// Distribución en el teléfono (WebKit iPhone 13), contra el ENTORNO DE PRUEBAS.
// Sólo mira: abre las pestañas y el formulario de pedido, y NO envía nada.
// Correr como `distribucion.spec.js`, con --project=webkit-movil.
import { test, expect } from '@playwright/test';
import { entrar } from './distribucionEntrar.js';

const SALIDA = process.env.E2E_CAPTURAS || 'test-results/distribucion-movil';

test('pestañas y formulario de pedido en el teléfono', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    for (const tab of ['pedidos', 'documentos', 'clientes', 'catalogo', 'emisor']) {
        await page.goto(`/distribucion?tab=${tab}`);
        await page.waitForTimeout(2000);
        await expect(page.getByText(/algo salió mal/i)).toHaveCount(0);
        // Sin desborde horizontal: en el teléfono una tabla que se sale del
        // marco no da error, sólo deja datos fuera de la vista.
        const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect(desborda, `la pestaña ${tab} desborda a lo ancho`).toBe(false);
        await page.screenshot({ path: `${SALIDA}/${tab}.png`, fullPage: true });
    }
    await page.goto('/distribucion?tab=pedidos');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /nueva venta/i }).first().click();
    await expect(page).toHaveURL(/\/distribucion\/venta$/);
    await expect(page.getByRole('heading', { name: 'Nueva venta' }).first()).toBeVisible();
    await page.getByText('Elegir cliente…').click();
    await page.getByText('TIENDA LA ESQUINA', { exact: true }).last().click();
    await page.getByLabel('Buscar producto').fill('a');
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Uno más' }).first().click();
    // La barra de abajo: total y «Facturar», siempre a mano en el teléfono.
    await expect(page.getByRole('button', { name: /Facturar e imprimir/ })).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/nueva-venta.png` });
    await page.locator('[data-renglon]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SALIDA}/nueva-venta-renglon.png` });
    await page.getByRole('button', { name: 'Dividir el pago' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SALIDA}/nueva-venta-pago.png` });
    expect(errores).toEqual([]);
});
