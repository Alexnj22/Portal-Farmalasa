import { test, expect, devices } from '@playwright/test';

/* Decidir una solicitud DESDE la campana, de punta a punta.
 *
 * Corre contra el ENTORNO DE PRUEBAS, nunca contra producción: aprobar mueve
 * datos de verdad, y ésa es exactamente la razón por la que el branch existe.
 * Levantarlo:
 *
 *   OUT_DIR=dist-staging npm run build:staging
 *   OUT_DIR=dist-staging QA_PORT=4175 npm run preview
 *   E2E_BASE_URL=http://localhost:4175 E2E_USER=pruebas E2E_PASSWORD=… \
 *     npx playwright test --project=webkit-movil -g decidir
 *
 * Necesita dos solicitudes de Min/Max PENDIENTES con su aviso —se siembran con
 * un INSERT en `minmax_change_requests`, que dispara el trigger—. Los títulos
 * de producto son la forma de encontrarlas en la lista.
 */
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const APROBAR  = process.env.CASO_APROBAR  || 'PRODUCTO DE PRUEBA · APROBAR';
const RECHAZAR = process.env.CASO_RECHAZAR || 'PRODUCTO DE PRUEBA · RECHAZAR';

test.use({ ...devices['iPhone 13'] });

test.describe('Decidir desde la campana · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('decidir: aprobar en un toque y rechazar con motivo', async ({ page }) => {
        test.setTimeout(180_000);

        const errores = [];
        page.on('pageerror', e => errores.push(`[pageerror] ${e.message}`));

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'),
            null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(4000);
        expect(page.url(), 'no se pudo entrar').not.toMatch(/\/login/);

        const abrirCampana = async () => {
            await page.locator('button[aria-label="Notificaciones"]').first().click();
            await page.waitForTimeout(1200);
        };
        const panel = page.locator('.z-bell-dropdown');
        const tarjetaDe = (texto) => panel.locator('[data-surface="card"]')
            .filter({ hasText: texto }).first();

        await abrirCampana();
        await expect(panel, 'el panel no se abrió').toBeVisible({ timeout: 10_000 });

        // ── 1 · Aprobar: UN toque, sin salir de la campana ───────────────────
        const aAprobar = tarjetaDe(APROBAR);
        await expect(aAprobar, `no llegó el aviso de «${APROBAR}»`).toBeVisible({ timeout: 10_000 });
        await aAprobar.getByRole('button', { name: /^aprobar$/i }).click();
        // El toast es la constancia de que se APLICÓ, no de que se navegó.
        await expect(page.getByText(/ajuste de min\/max aplicado/i))
            .toBeVisible({ timeout: 20_000 });
        await page.screenshot({ path: 'test-results/campana-decidir-aprobado.png' });
        // Y el aviso se va: ya no pide nada.
        await expect(tarjetaDe(APROBAR)).toHaveCount(0, { timeout: 10_000 });
        // Sin cambiar de pantalla — el toque no era un enlace disfrazado.
        expect(page.url(), 'aprobar navegó a otra pantalla').not.toMatch(/solicitud=/);

        // ── 2 · Rechazar: pide motivo antes de aplicar ───────────────────────
        if (!(await panel.isVisible())) await abrirCampana();
        const aRechazar = tarjetaDe(RECHAZAR);
        await expect(aRechazar, `no llegó el aviso de «${RECHAZAR}»`).toBeVisible({ timeout: 10_000 });
        await aRechazar.getByRole('button', { name: /^rechazar$/i }).click();

        const dialogo = page.locator('[role="dialog"]');
        await expect(dialogo, 'el rechazo no abrió el diálogo del motivo')
            .toBeVisible({ timeout: 20_000 });
        await expect(dialogo.getByText(/motivo de rechazo/i)).toBeVisible();
        const confirmar = dialogo.getByRole('button', { name: /confirmar rechazo/i });
        // Sin motivo no se puede confirmar: es la regla que vive en el diálogo y
        // que por eso NO se copió dentro de la campana.
        await expect(confirmar, 'se podía confirmar un rechazo sin motivo').toBeDisabled();
        await page.screenshot({ path: 'test-results/campana-decidir-motivo.png' });

        await dialogo.locator('textarea').first().fill('Prueba automatizada: rechazo con motivo.');
        await expect(confirmar).toBeEnabled();
        await confirmar.click();
        await expect(page.getByText(/ajuste de min\/max rechazado/i))
            .toBeVisible({ timeout: 20_000 });
        await page.screenshot({ path: 'test-results/campana-decidir-rechazado.png' });

        expect(errores, `errores en consola:\n${errores.join('\n')}`).toEqual([]);
    });
});
