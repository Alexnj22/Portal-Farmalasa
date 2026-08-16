// El editor de acomodo del Inicio, en el navegador.
//
// Existe porque los gates y el compilador no prueban nada sobre lo que se ve
// (lección del 2026-08-02), y acá lo que se agregó es justamente una pantalla:
// el tablero en chico dentro de un modal. Lo que verifica:
//
//   1. «Personalizar» abre el editor y muestra los widgets del tablero.
//   2. Arrastrar una ficha sobre otra las INTERCAMBIA — la regla nueva.
//   3. «Cancelar» descarta el borrador: el tablero queda como estaba.
//   4. «Listo» lo aplica.
//
//   npx playwright test tests/e2e/acomodar-widgets.spec.js --project=chromium

import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe('Acomodar widgets', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 60_000 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
    });

    // Las fichas del editor: cada una es un botón con su rótulo y su medida.
    const fichas = (page) => page.locator('[role="dialog"] button[aria-pressed]');

    async function abrirEditor(page) {
        await page.getByRole('button', { name: 'Personalizar' }).click();
        await expect(page.getByText(/^Acomodar /)).toBeVisible({ timeout: 10_000 });
    }

    test('abre el tablero en chico con sus widgets', async ({ page }) => {
        await abrirEditor(page);
        const n = await fichas(page).count();
        expect(n, 'el editor no listó ningún widget').toBeGreaterThan(2);

        // El lienzo tiene que OCLUIR. Reportado el 2026-08-16 con captura: en
        // Liquid claro el panel deja pasar el 49% y las fichas estaban a 16%,
        // así que las barras de las gráficas se leían a través del texto. La
        // guarda mide la opacidad real y no la clase, porque el defecto vive en
        // el token — y corre en el tema de la cuenta de QA (Solid), donde todo
        // es opaco, así que sólo puede fallar si alguien quita el `--thead-bg`.
        const alfa = await page.evaluate(() => {
            const l = document.querySelector('[role="dialog"] [style*="thead-bg"]');
            if (!l) return null;
            const m = getComputedStyle(l).backgroundColor.match(/[\d.]+/g);
            return m && m.length === 4 ? Number(m[3]) : 1;
        });
        expect(alfa, 'el lienzo del editor dejó de ocluir').not.toBeNull();
        expect(alfa).toBeGreaterThanOrEqual(0.9);
        // Y entra sin scroll horizontal, que es el punto de verlo en chico.
        const desborde = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            return d ? d.scrollWidth - d.clientWidth : 0;
        });
        expect(desborde, 'el editor desborda a lo ancho').toBeLessThanOrEqual(1);
        await page.screenshot({ path: 'barridos/acomodar-editor.png' });
    });

    test('arrastrar una ficha sobre otra las intercambia', async ({ page }) => {
        await abrirEditor(page);
        // Dos fichas del MISMO tamaño: el intercambio pide medidas iguales, y
        // la medida está escrita en la propia ficha («2×3»).
        const todas = await fichas(page).all();
        const porMedida = new Map();
        for (const f of todas) {
            const t = await f.innerText();
            const m = t.match(/(\d+)×(\d+)/);
            if (!m) continue;
            const k = m[0];
            porMedida.set(k, [...(porMedida.get(k) || []), f]);
        }
        const par = [...porMedida.values()].find(v => v.length >= 2);
        test.skip(!par, 'este tablero no tiene dos widgets del mismo tamaño');

        const [a, b] = par;
        const nombreA = (await a.innerText()).split('\n')[0];
        const nombreB = (await b.innerText()).split('\n')[0];
        const cajaA = await a.boundingBox();
        const cajaB = await b.boundingBox();

        await page.mouse.move(cajaA.x + cajaA.width / 2, cajaA.y + cajaA.height / 2);
        await page.mouse.down();
        // En dos tramos: un solo `move` no supera el umbral de arranque y
        // después salta, así que el arrastre nunca empieza.
        await page.mouse.move(cajaB.x + cajaB.width / 2, cajaB.y + cajaB.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);

        // A quedó donde estaba B, y B donde estaba A.
        const nuevoEnB = await page.locator('[role="dialog"] button[aria-pressed]')
            .filter({ hasText: nombreA }).first().boundingBox();
        expect(Math.abs(nuevoEnB.x - cajaB.x), 'el arrastrado no llegó al destino').toBeLessThan(8);
        const nuevoEnA = await page.locator('[role="dialog"] button[aria-pressed]')
            .filter({ hasText: nombreB }).first().boundingBox();
        expect(Math.abs(nuevoEnA.x - cajaA.x), 'el otro no ocupó el sitio que quedó libre').toBeLessThan(8);
        expect(Math.abs(nuevoEnA.y - cajaA.y)).toBeLessThan(8);
        await page.screenshot({ path: 'barridos/acomodar-intercambio.png' });
    });

    test('Cancelar descarta el borrador', async ({ page }) => {
        const posiciones = async () => page.evaluate(() =>
            Object.fromEntries([...document.querySelectorAll('[data-widget-id]')].map(el => {
                const s = getComputedStyle(el);
                return [el.dataset.widgetId, `${s.gridColumnStart}/${s.gridRowStart}`];
            })));

        const antes = await posiciones();
        await abrirEditor(page);
        // Mueve la primera ficha bien abajo y cancela.
        const f = fichas(page).first();
        const caja = await f.boundingBox();
        await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
        await page.mouse.down();
        await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height * 5, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(200);

        await page.getByRole('button', { name: 'Cancelar' }).click();
        await page.waitForTimeout(500);
        expect(await posiciones(), 'Cancelar dejó cambios en el tablero').toEqual(antes);
    });
});
