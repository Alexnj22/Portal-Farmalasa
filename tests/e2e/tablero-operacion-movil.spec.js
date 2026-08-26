import { test, expect, devices } from '@playwright/test';

// Reportado el 2026-08-07: «¿por qué en móvil no me salen todos los widget de
// operación? sólo me sale Consulta de inventario y modificar facturación».
//
// La causa: `buildWidgetList` recorre las claves de `activeLayout`, o sea que
// **lo que se pinta sale del acomodo guardado, no del catálogo de la pestaña**.
// Ese acomodo se congela la primera vez que alguien mueve un widget. El del
// usuario, leído de `user_dashboard_prefs`:
//
//     escritorio: annulment_req, inv_movement, inv_search, minmax_req,
//                 srs_inv, traslados
//     móvil:      annulment_req, inv_search, srs_inv
//
// y `srs_inv` es un widget RETIRADO. De las tres claves móviles sólo dos
// existen hoy — exactamente las dos que veía. En escritorio salían las seis, y
// por eso el defecto parecía «del móvil»: no lo era, era que ese acomodo se
// guardó antes y por separado.
//
// ⚠️ EL ACOMODO NO VIVE SÓLO EN localStorage. La primera versión de esta prueba
// lo sembraba ahí y no reprodujo nada: `user_dashboard_prefs` se carga después
// y lo pisa. Por eso acá se intercepta la RESPUESTA del servidor y se fabrica
// la fila — reproduce el caso exacto sin escribir en producción.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const CATALOGO_OPERACION = ['inv_search', 'annulment_req', 'minmax_req', 'inv_movement', 'traslados'];
// El acomodo del usuario, tal cual estaba guardado.
const MOVIL_CONGELADO = { annulment_req: { col: 1, row: 1 }, inv_search: { col: 2, row: 1 }, srs_inv: { col: 1, row: 2 } };
const ESCRITORIO = {
    annulment_req: { col: 1, row: 1 }, inv_movement: { col: 2, row: 1 }, inv_search: { col: 3, row: 1 },
    minmax_req: { col: 4, row: 1 }, srs_inv: { col: 1, row: 2 }, traslados: { col: 2, row: 2 },
};

// `serviceWorkers: 'block'` — el portal es PWA, y con el service worker activo
// la petición de preferencias sale de ÉL, no de la página: `page.route` no la
// ve y la interceptación no ocurre. La primera versión de esta prueba pasó dos
// veces con **cero** intercepciones, midiendo el estado real y no el sembrado.
test.use({ ...devices['iPhone 13'], serviceWorkers: 'block' });

test.describe('Tablero · pestaña Operación · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('un acomodo guardado viejo no esconde widgets nuevos', async ({ page }) => {
        test.setTimeout(120_000);

        // Sólo el GET de preferencias: el upsert tiene que seguir su camino, o
        // la prueba estaría midiendo también una escritura rota.
        let interceptadas = 0;
        await page.route('**/rest/v1/user_dashboard_prefs*', async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            interceptadas++;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    layout: { operacion: ESCRITORIO },
                    sizes: {},
                    widgets: [],
                    mobile_layout: { operacion: MOVIL_CONGELADO },
                    mobile_sizes: {},
                }),
            });
        });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(6000);
        if (/\/login/.test(page.url())) throw new Error('No se pudo iniciar sesión.');

        // El tablero de widgets vive en /inicio. `/personal` es Gestión de
        // Personal — se perdió un rato acá antes de notarlo.
        await page.goto('/inicio');
        await page.waitForFunction(
            () => document.body.innerText.includes('Personalizar'), null, { timeout: 30_000 },
        ).catch(() => {});

        const uid = await page.evaluate(() => {
            const k = Object.keys(localStorage).find(x => /^portal_dash(board|_layout|_tab)_/.test(x));
            return k ? k.replace(/^portal_dash(board|_layout|_tab)_/, '').replace(/_[a-z]+$/, '') : 'guest';
        });
        await page.evaluate((uid) => localStorage.setItem(`portal_dash_tab_${uid}`, 'operacion'), uid);
        await page.reload();
        await page.waitForFunction(
            () => document.body.innerText.includes('Personalizar'), null, { timeout: 30_000 },
        ).catch(() => {});
        await page.waitForTimeout(4000);

        const pintados = await page.evaluate(() =>
            [...document.querySelectorAll('[data-widget-id]')].map(e => e.dataset.widgetId));
        // «Personalizar» y el acomodo son las dos explicaciones que compiten, y
        // separarlas es todo el trabajo: lo que está encendido y no se pinta, lo
        // esconde el permiso del cargo, que es otra cosa y no se arregla acá.
        const encendidos = await page.evaluate(({ uid, ids }) => {
            let cfg = []; try { cfg = JSON.parse(localStorage.getItem(`portal_dashboard_${uid}`) || '[]'); } catch { /* corrupto */ }
            return ids.map(id => {
                const w = Array.isArray(cfg) ? cfg.find(x => x.id === id) : null;
                return `${id}=${w ? (w.enabled ? 'ON' : 'OFF') : 'ON(sin entrada)'}`;
            });
        }, { uid, ids: CATALOGO_OPERACION });

        // Sin esta cuenta, una prueba que no intercepta nada mide el estado real
        // y pasa por el motivo equivocado. Ya pasó con la versión que sembraba
        // localStorage.
        console.log(`\n  respuestas de prefs interceptadas: ${interceptadas}`);
        expect(interceptadas, 'no se interceptó la carga de preferencias: la prueba no está reproduciendo nada').toBeGreaterThan(0);
        console.log(`  acomodo móvil congelado: ${Object.keys(MOVIL_CONGELADO).join(', ')}  (srs_inv ya no existe)`);
        console.log(`  «Personalizar»:          ${encendidos.join(' | ')}`);
        console.log(`  pintados:                ${pintados.join(', ') || '(ninguno)'}`);
        console.log(`  encendidos y NO pintados (los esconde el permiso): `
            + `${CATALOGO_OPERACION.filter(id => !pintados.includes(id)).join(', ') || 'ninguno'}`);

        expect(pintados, 'un widget retirado no debe sobrevivir en el acomodo móvil').not.toContain('srs_inv');
        // La garantía: al menos uno de los que NO estaban en el acomodo tiene que
        // aparecer. No se exigen los cinco — un permiso puede esconder alguno
        // legítimamente, y ése es otro camino.
        const nuevos = CATALOGO_OPERACION.filter(id => !(id in MOVIL_CONGELADO));
        const aparecio = nuevos.filter(id => pintados.includes(id));
        expect(aparecio.length, 'el acomodo guardado sigue congelando el conjunto de widgets').toBeGreaterThan(0);
    });
});
