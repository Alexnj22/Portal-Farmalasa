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
    await page.getByRole('button', { name: /nuevo pedido/i }).first().click();
    await expect(page.getByRole('dialog').getByText('Nuevo pedido')).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/nuevo-pedido.png` });
    expect(errores).toEqual([]);
});
