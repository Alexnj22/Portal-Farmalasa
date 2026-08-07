import { test, expect, devices } from '@playwright/test';

// Reportado el 2026-08-07: «¿por qué en móvil no me salen todos los widget de
// operación? sólo me sale Consulta de inventario y modificar facturación».
//
// La primera hipótesis fue que el ACOMODO GUARDADO congelaba el conjunto:
// `buildWidgetList` recorre las claves de `activeLayout`, ese acomodo se
// escribe en localStorage la primera vez que alguien mueve un widget, y los
// tres de Operación que se agregaron en agosto no estarían en él. Encajaba
// perfecto con el síntoma —los dos que el usuario ve son justo los viejos— y
// **es falsa**: esta prueba la sembró a propósito y el tablero pintó cuatro
// widgets igual, no dos.
//
// Queda como prueba de regresión de esa garantía: un acomodo guardado viejo no
// puede esconder un widget nuevo. Y queda escrito el método, que es la parte que
// vale: la hipótesis encajaba con todo lo observado y se cayó en cuanto se
// sembró el estado que supuestamente la causaba.
//
// El widget que sí falta en la cuenta de prueba es `inv_movement`, y no es por
// el acomodo ni por el teléfono: está encendido en «Personalizar», así que lo
// que falta es el permiso `dash_inv_movement` del rol. Ese camino es idéntico
// en escritorio.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// Los cinco de la pestaña, según `TAB_WIDGETS.operacion`.
const ESPERADOS = ['inv_search', 'annulment_req', 'minmax_req', 'inv_movement', 'traslados'];
// Los dos que ya existían cuando se guardó el acomodo del usuario.
const VIEJOS = ['inv_search', 'annulment_req'];

test.use({ ...devices['iPhone 13'] });

test.describe('Tablero · pestaña Operación · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('un acomodo guardado viejo no esconde widgets nuevos', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(6000);
        if (/\/login/.test(page.url())) throw new Error('No se pudo iniciar sesión.');

        // El tablero de widgets vive en /overview. `/dashboard` es Gestión de
        // Personal — se perdió un rato acá antes de notarlo.
        await page.goto('/overview');
        await page.waitForTimeout(6000);

        // El id de usuario sale de las claves que el tablero ya escribió; no se
        // adivina. Si no hay ninguna, el tablero usa 'guest'.
        const uid = await page.evaluate(() => {
            const k = Object.keys(localStorage).find(x => /^portal_dash(board|_layout|_tab)_/.test(x));
            return k ? k.replace(/^portal_dash(board|_layout|_tab)_/, '').replace(/_[a-z]+$/, '') : 'guest';
        });

        await page.evaluate(({ uid, viejos }) => {
            const acomodo = {};
            viejos.forEach((id, i) => { acomodo[id] = { col: i + 1, row: 1 }; });
            localStorage.setItem(`portal_dash_mobile_layout_${uid}_operacion`, JSON.stringify(acomodo));
            localStorage.setItem(`portal_dash_tab_${uid}`, 'operacion');
        }, { uid, viejos: VIEJOS });

        // Un `reload` completo tarda mucho más que una navegación del SPA: se
        // espera a que el tablero monte de verdad, no un número fijo.
        await page.reload();
        await page.waitForFunction(
            () => document.body.innerText.includes('Personalizar'), null, { timeout: 30_000 },
        ).catch(() => {});
        await page.waitForTimeout(4000);

        const pintados = await page.evaluate(() =>
            [...document.querySelectorAll('[data-widget-id]')].map(e => e.dataset.widgetId));
        // «Personalizar» y el acomodo se imprimen juntos porque son las dos
        // explicaciones que compiten, y separarlas es todo el trabajo: lo que
        // está encendido y no se pinta, lo esconde el PERMISO.
        const encendidos = await page.evaluate(({ uid, esperados }) => {
            let cfg = []; try { cfg = JSON.parse(localStorage.getItem(`portal_dashboard_${uid}`) || '[]'); } catch { /* corrupto */ }
            return esperados.map(id => {
                const w = Array.isArray(cfg) ? cfg.find(x => x.id === id) : null;
                return `${id}=${w ? (w.enabled ? 'ON' : 'OFF') : 'sin-entrada'}`;
            });
        }, { uid, esperados: ESPERADOS });

        console.log(`\n  acomodo sembrado: ${VIEJOS.join(', ')}`);
        console.log(`  «Personalizar»:   ${encendidos.join(' | ')}`);
        console.log(`  pintados:         ${pintados.join(', ') || '(ninguno)'}`);
        const ocultos = ESPERADOS.filter(id => !pintados.includes(id));
        console.log(`  encendidos y NO pintados (los esconde el permiso): ${ocultos.join(', ') || 'ninguno'}`);

        // La garantía: al menos uno de los que NO estaban en el acomodo sembrado
        // tiene que aparecer. No se exige que estén los cinco — un permiso puede
        // esconder alguno legítimamente, y eso es otra cosa.
        const nuevos = ESPERADOS.filter(id => !VIEJOS.includes(id));
        const aparecio = nuevos.filter(id => pintados.includes(id));
        expect(aparecio.length, 'el acomodo guardado estaría congelando el conjunto de widgets').toBeGreaterThan(0);
    });
});
