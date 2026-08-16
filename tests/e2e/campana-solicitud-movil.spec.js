import { test, expect, devices } from '@playwright/test';

/* Decidir desde la campana una solicitud de `approval_requests`.
 *
 * Existe aparte de `campana-decidir-movil` y no es una repetición: aquél
 * decide un ajuste de Min/Max, que vive en otra tabla y se resuelve por su
 * propia RPC (`decidirMinMax`) **sin pasar por el store de solicitudes**. Todo
 * lo demás —un permiso, una anulación de factura, una carga de inventario— sí
 * pasa, y ahí estaba el agujero: `approveRequest` buscaba la fila en
 * `get().requests`, una lista que llena UNA sola pantalla (`fetchRequests`, en
 * Solicitudes). Desde la campana esa lista está vacía, así que aprobar moría en
 * `if (!req) return false` y salía «No se pudo procesar la acción» — un error
 * sin causa que desaparecía si antes se había entrado al módulo, que es
 * exactamente cómo lo reportó el usuario el 2026-08-16.
 *
 * Por eso la prueba NO entra a Solicitudes: decide desde el tablero, que es el
 * único sitio donde el defecto se ve.
 *
 * Corre contra el ENTORNO DE PRUEBAS, nunca contra producción: aprobar mueve
 * datos de verdad. Levantarlo:
 *
 *   OUT_DIR=dist-staging npm run build:staging
 *   npx vite preview --outDir dist-staging --port 4176 --strictPort
 *   E2E_BASE_URL=http://localhost:4176 E2E_USER=pruebas E2E_PASSWORD=… \
 *     npx playwright test --project=webkit-movil -g "solicitud desde la campana"
 *
 * Siembra: dos `approval_requests` PENDIENTES con `approver_id` = la cuenta de
 * pruebas y su fila en `notifications` (type `REQUEST_PENDING`, `metadata` con
 * `request_id` y `request_type`). El cuerpo del aviso es cómo se las encuentra.
 */
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const APROBAR  = process.env.CASO_APROBAR  || 'Prueba campana — aprobar';
const RECHAZAR = process.env.CASO_RECHAZAR || 'Prueba campana — rechazar';

test.use({ ...devices['iPhone 13'] });

test.describe('Decidir una solicitud desde la campana · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('solicitud desde la campana: aprobar en un toque, rechazar con motivo', async ({ page }) => {
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
        // La prueba vale porque NUNCA se pasó por Solicitudes: es esa visita la
        // que llenaba la lista y tapaba el defecto.
        expect(page.url(), 'la prueba arrancó dentro del módulo').not.toMatch(/\/requests/);

        const abrirCampana = async () => {
            await page.locator('button[aria-label="Notificaciones"]').first().click();
            await page.waitForTimeout(1200);
        };
        const panel = page.locator('.z-bell-dropdown');
        const tarjetaDe = (texto) => panel.locator('[data-surface="card"]')
            .filter({ hasText: texto }).first();
        const elGenerico = page.getByText(/no se pudo procesar la acción/i);

        await abrirCampana();
        await expect(panel, 'el panel no se abrió').toBeVisible({ timeout: 10_000 });

        // ── 1 · Aprobar: UN toque, sin salir de la campana ───────────────────
        const aAprobar = tarjetaDe(APROBAR);
        await expect(aAprobar, `no llegó el aviso de «${APROBAR}»`).toBeVisible({ timeout: 10_000 });
        await aAprobar.getByRole('button', { name: /^aprobar$/i }).click();
        await expect(page.getByText(/solicitud aprobada/i))
            .toBeVisible({ timeout: 20_000 });
        await expect(elGenerico, 'volvió el error sin causa').toHaveCount(0);
        await page.screenshot({ path: 'test-results/campana-solicitud-aprobada.png' });
        await expect(tarjetaDe(APROBAR)).toHaveCount(0, { timeout: 10_000 });
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
        await expect(confirmar, 'se podía confirmar un rechazo sin motivo').toBeDisabled();

        await dialogo.locator('textarea').first().fill('Prueba automatizada: rechazo con motivo.');
        await expect(confirmar).toBeEnabled();
        await confirmar.click();
        await expect(page.getByText(/solicitud rechazada/i))
            .toBeVisible({ timeout: 20_000 });
        await expect(elGenerico, 'volvió el error sin causa').toHaveCount(0);
        await page.screenshot({ path: 'test-results/campana-solicitud-rechazada.png' });

        expect(errores, `errores en consola:\n${errores.join('\n')}`).toEqual([]);
    });
});
