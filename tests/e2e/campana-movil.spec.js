import { test, expect, devices } from '@playwright/test';

/* La campana en el teléfono: ¿se puede llegar hasta la última notificación?
 *
 * WebKit iPhone 13 y no Chromium: los contenedores de scroll anidados con
 * `overscroll-behavior: contain` se comportan distinto en cada motor, y los bugs
 * de layout móvil de este proyecto han sido WebKit-only más de una vez.
 *
 * `mouse.wheel` NO existe en WebKit móvil (Playwright lo rechaza) y un
 * `TouchEvent` sintético no produce scroll nativo, así que el deslizamiento no
 * se puede imitar. Lo que sí se puede medir —y es la causa, no el síntoma— es la
 * CADENA de contenedores: cuántos hay dentro del panel, cuánto desborda cada
 * uno, y si el que desborda tiene por encima otro que también desborda con el
 * encadenamiento cortado. Ahí es donde el dedo se queda sin recorrido.
 *
 * Sólo LEE. No marca leído, no borra, no decide nada.
 *
 *   E2E_BASE_URL=http://localhost:4174 npx playwright test --project=webkit-movil -g campana
 */
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// `serviceWorkers: 'block'` no es opcional: con el worker de `public/sw.js`
// registrado, `page.route` NUNCA se dispara aunque la petición exista —el test
// mediría la campana real, con una sola notificación, y saldría en verde sin
// haber probado nada.
test.use({ ...devices['iPhone 13'], serviceWorkers: 'block' });

test.describe('Campana · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('campana: la cadena de scroll llega al fondo', async ({ page }) => {
        test.setTimeout(120_000);

        /* La cuenta de QA tiene UNA notificación, así que nada desborda y la
         * medición saldría en verde sin haber probado nada —cero hallazgos y
         * cero datos se ven igual—. Se fabrica la lista interceptando la
         * lectura: no toca producción y la geometría queda fija, que es lo que
         * hace comparable el antes y el después.
         *
         * `request_id` apunta a una solicitud REAL que esta cuenta puede leer:
         * el detalle desplegado es el tercer contenedor de scroll y con un id
         * inventado no se montaría. */
        const REQ_REAL = 'f5ca7417-238d-415e-936a-23463f592374';
        let intercepciones = 0;
        await page.route('**/rest/v1/notifications*', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            intercepciones++;
            const base = new Date('2026-08-14T14:00:00Z').getTime();
            const filas = Array.from({ length: 12 }, (_, i) => ({
                id: `fake-${i}`,
                type: i < 3 ? 'REQUEST_PENDING' : 'SYSTEM',
                title: `Notificación de prueba ${i + 1}`,
                body: 'Un cuerpo de dos renglones para que la tarjeta tenga el alto que tiene de verdad cuando llega una solicitud.',
                link: '/requests',
                metadata: i < 3
                    ? { request_id: REQ_REAL, request_type: 'INVENTORY_DISCARD_REQUEST' }
                    : {},
                branch_id: null,
                created_by: null,
                created_at: new Date(base - i * 600_000).toISOString(),
                read_at: i < 2 ? null : new Date(base).toISOString(),
            }));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'content-range': `0-${filas.length - 1}/${filas.length}` },
                body: JSON.stringify(filas),
            });
        });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'),
            null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(4000);
        expect(page.url()).not.toMatch(/\/login/);

        // El control ANTES de la aserción real: sin interceptar, lo que se mide
        // es la campana de QA con una sola notificación —cero desborde— y el
        // verde no significaría nada.
        expect(intercepciones, 'la lista fabricada no llegó a interceptarse').toBeGreaterThan(0);

        const campana = page.locator('button[aria-label="Notificaciones"]').first();
        await expect(campana).toBeVisible({ timeout: 15_000 });
        await campana.click();
        await page.waitForTimeout(1500);

        // `.z-bell-dropdown` y no `[data-surface="dropdown"]` a secas: el banner
        // de «agregá el portal a tu pantalla» usa la misma superficie y el
        // selector resolvía a dos elementos.
        const panel = page.locator('.z-bell-dropdown [data-surface="dropdown"]');
        await expect(panel, 'el panel de la campana no se abrió').toBeVisible({ timeout: 10_000 });

        // Antes de empujar nada: así se ve al abrirla, con los controles de la
        // primera tarjeta a la vista.
        await page.screenshot({ path: 'test-results/campana-movil-arriba.png' });

        const medida = await page.evaluate(() => {
            const panel = document.querySelector('.z-bell-dropdown [data-surface="dropdown"]');
            const raiz  = panel.parentElement;   // el motion.div que posiciona
            const clase = (el) => (el.className?.baseVal ?? el.className ?? '').toString();

            // La cadena: cada ancestro-o-descendiente del panel que puede hacer
            // scroll vertical, en orden de arriba hacia abajo del árbol.
            const cadena = [];
            const visitar = (el, prof) => {
                const cs = getComputedStyle(el);
                if (/auto|scroll/.test(cs.overflowY)) {
                    const desborda = el.scrollHeight - el.clientHeight;
                    cadena.push({
                        prof,
                        clase: clase(el).replace(/\s+/g, ' ').trim().slice(0, 60),
                        alto: Math.round(el.getBoundingClientRect().height),
                        contenido: el.scrollHeight,
                        desborda,
                        overscrollY: cs.overscrollBehaviorY,
                    });
                }
                [...el.children].forEach(h => visitar(h, prof + 1));
            };
            visitar(raiz, 0);

            const tarjetas = [...panel.querySelectorAll('[data-surface="card"]')];
            const ultima = tarjetas.at(-1);

            // ¿Alcanza con llevar TODOS los scrollers a su fondo? Es el mejor
            // caso posible del dedo — si ni así se ve la última, el problema es
            // de altura, no de encadenamiento.
            const antes = ultima ? Math.round(ultima.getBoundingClientRect().bottom) : null;
            cadena.forEach(() => {});
            const scrollers = [];
            const juntar = (el) => {
                if (/auto|scroll/.test(getComputedStyle(el).overflowY)) scrollers.push(el);
                [...el.children].forEach(juntar);
            };
            juntar(raiz);
            scrollers.forEach(el => { el.scrollTop = el.scrollHeight; });
            const despues = ultima ? Math.round(ultima.getBoundingClientRect().bottom) : null;

            return {
                vp: { w: innerWidth, h: innerHeight },
                panelCaja: (({ top, bottom, height }) => ({
                    top: Math.round(top), bottom: Math.round(bottom), alto: Math.round(height),
                }))(raiz.getBoundingClientRect()),
                tarjetas: tarjetas.length,
                cadena,
                // El fondo de la última tarjeta, antes y después de empujar todos
                // los scrollers a su límite.
                ultimaAbajo: { antes, despues },
                // Cuántos de la cadena desbordan a la vez: dos o más anidados es
                // el dedo compitiendo con dos recorridos.
                desbordanALaVez: cadena.filter(c => c.desborda > 0).length,
            };
        });

        console.log('\n══ CAMPANA EN iPHONE 13 ══');
        console.log(JSON.stringify(medida, null, 2));
        await page.screenshot({ path: 'test-results/campana-movil.png' });

        // ── Y con el detalle abierto, que es donde aparece el tercer recorrido ─
        const verDetalle = page.getByText('Ver detalle', { exact: false }).first();
        if (await verDetalle.count()) {
            await verDetalle.click({ force: true }).catch(() => {});
            await page.waitForTimeout(2500);
            const conDetalle = await page.evaluate(() => {
                const raiz = document.querySelector('.z-bell-dropdown');
                const cadena = [];
                const visitar = (el, prof) => {
                    const cs = getComputedStyle(el);
                    if (/auto|scroll/.test(cs.overflowY)) {
                        cadena.push({
                            prof,
                            clase: ((el.className?.baseVal ?? el.className ?? '') + '').replace(/\s+/g, ' ').trim().slice(0, 56),
                            alto: Math.round(el.getBoundingClientRect().height),
                            desborda: el.scrollHeight - el.clientHeight,
                            overscrollY: cs.overscrollBehaviorY,
                        });
                    }
                    [...el.children].forEach(h => visitar(h, prof + 1));
                };
                visitar(raiz, 0);
                return { cadena, desbordanALaVez: cadena.filter(c => c.desborda > 0).length };
            });
            console.log('\n══ CON EL DETALLE ABIERTO ══');
            console.log(JSON.stringify(conDetalle, null, 2));
            await page.screenshot({ path: 'test-results/campana-movil-detalle.png' });
        }

        /* ── Tocar la tarjeta LLEVA a Solicitudes ────────────────────────────
         * Antes desplegaba el detalle en el sitio y no salía nunca de la
         * campana. Se toca el TÍTULO —o sea la cara de la tarjeta, no sus
         * controles— y se mira a dónde queda el navegador. */
        const antesDeTocar = page.url();
        await panel.getByText('Notificación de prueba 4', { exact: false })
            .first().click({ force: true });
        await page.waitForTimeout(2000);
        const trasTocar = page.url();
        console.log(`\n══ TOQUE EN LA TARJETA ══\n  ${antesDeTocar}\n  → ${trasTocar}`);
        expect(trasTocar, 'tocar la tarjeta no llevó a Solicitudes').toMatch(/\/requests/);

        await page.locator('button[aria-label="Notificaciones"]').first().click();
        await page.waitForTimeout(1200);

        /* ── La guarda: no se decide dos veces ───────────────────────────────
         * Las tarjetas 2 y 3 apuntan a una solicitud REAL y ya resuelta. La
         * campana es una fila aparte de la solicitud, así que puede seguir
         * ofreciendo los dos botones después de que otro la decidió: acá se
         * comprueba que el aviso lo diga y se apague, en vez de rebotar contra
         * la base sin explicar nada.
         *
         * El camino completo —diálogo de motivo, confirmación, escritura— se
         * prueba en `campana-decidir-movil.spec.js`, que corre contra el
         * entorno de pruebas porque aplica de verdad. */
        await panel.getByRole('button', { name: /^rechazar$/i })
            .first().click({ force: true });
        await expect(page.getByText(/ya estaba resuelta/i),
            'no avisó que la solicitud ya estaba decidida')
            .toBeVisible({ timeout: 20_000 });
        await page.screenshot({ path: 'test-results/campana-movil-guarda.png' });

        // Un solo recorrido vertical dentro del panel. Dos anidados que desbordan
        // a la vez es lo que deja el fondo fuera del alcance del dedo.
        expect(medida.desbordanALaVez,
            `${medida.desbordanALaVez} contenedores anidados desbordan a la vez dentro de la campana`)
            .toBeLessThanOrEqual(1);
        // Y con todo empujado al fondo, la última tarjeta tiene que entrar.
        expect(medida.ultimaAbajo.despues,
            'la última notificación queda fuera de la pantalla aun con todo el scroll al fondo')
            .toBeLessThanOrEqual(medida.vp.h);
    });
});
