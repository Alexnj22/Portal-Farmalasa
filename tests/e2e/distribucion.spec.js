// Distribución contra el ENTORNO DE PRUEBAS (nunca producción: crea pedidos
// y documentos). Correr con el portal compilado en modo staging:
//
//   npx vite build --mode staging --outDir dist-sas-staging
//   npx vite preview --mode staging --outDir dist-sas-staging --port 4173 --strictPort
//   E2E_BASE_URL=http://localhost:4173 npx playwright test tests/e2e/distribucion.spec.js --project=chromium
//
// Se niega a correr si la página no muestra el marco «ENTORNO DE PRUEBAS».
import { test, expect } from '@playwright/test';
import { entrar } from './distribucionEntrar.js';

const SALIDA = process.env.E2E_CAPTURAS || 'test-results/distribucion';


test('las cinco pestañas abren sin romper', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    for (const tab of ['pedidos', 'documentos', 'clientes', 'catalogo', 'emisor']) {
        await page.goto(`/distribucion?tab=${tab}`);
        await expect(page.getByRole('heading', { name: 'Distribución' }).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1500);
        await expect(page.getByText(/algo salió mal/i)).toHaveCount(0);
        await page.screenshot({ path: `${SALIDA}/${tab}.png`, fullPage: true });
    }
    expect(errores).toEqual([]);
});

test('tomar un pedido a una tienda y facturarlo', async ({ page }) => {
    await entrar(page);
    await page.goto('/distribucion?tab=pedidos');
    await page.getByRole('button', { name: /nuevo pedido/i }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Nuevo pedido')).toBeVisible();

    await modal.getByText('Elegir cliente…').click();
    await page.getByText('TIENDA LA ESQUINA', { exact: true }).last().click();
    await expect(modal.getByText(/Sólo venta libre/)).toBeVisible();

    await modal.getByText('Producto…').first().click();
    await page.locator('[role="option"]').first().click();
    await modal.locator('input[name="cantidad-0"]').fill('6');
    await page.screenshot({ path: `${SALIDA}/pedido-lleno.png`, fullPage: true });

    await modal.getByRole('button', { name: /guardar y facturar/i }).click();
    await expect(modal).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/Factura|Pedido guardado/).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SALIDA}/pedido-facturado.png`, fullPage: true });
});
