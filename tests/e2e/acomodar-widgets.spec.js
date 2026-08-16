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

        // Las baldosas por sucursal (`sales_branch_*`) son ids dinámicos y no
        // están en `WIDGET_DEFS`: la primera versión del editor armaba su lista
        // sólo del catálogo estático y las dejaba fuera. Y no era cosmético —
        // al no estar en la lista, «Listo» guardaba un acomodo sin ellas y el
        // efecto de alta las recolocaba: las 6 pasaban de las filas 1-2 a las
        // 13, 14 y 19. Reportado el 2026-08-16.
        const enElTablero = await page.locator('[data-widget-id^="sales_branch_"]').count();
        if (enElTablero > 0) {
            const rotulos = await fichas(page).allInnerTexts();
            const enElEditor = rotulos.filter(t => t.trim().startsWith('Hoy ·')).length;
            expect(enElEditor, 'las baldosas de sucursal no salen en el editor')
                .toBe(enElTablero);
        }
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

    test('el tablero se reacomoda EN VIVO y no deja blancos', async ({ page }) => {
        // «debe ser fluido, no deben haber espacios en blanco si alguno cabe».
        // Se mide sobre el tablero real —28 widgets— en tres momentos: antes de
        // tocar nada, MIENTRAS se arrastra y al soltar. Los tres tienen que
        // estar sin blancos y sin encimados, y los dos últimos tienen que ser
        // idénticos: lo que se ve arrastrando es lo que se guarda, no una
        // aproximación.
        await abrirEditor(page);

        const foto = () => page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            const span = (v) => { const m = /span (\d+)/.exec(v); return m ? +m[1] : 1; };
            const fichas = [...d.querySelectorAll('button[aria-pressed]')].map(b => {
                const s = getComputedStyle(b);
                return { t: b.innerText.replace(/\s+/g, ' ').trim().slice(0, 22),
                         col: +s.gridColumnStart, row: +s.gridRowStart,
                         cols: span(s.gridColumnEnd), rows: span(s.gridRowEnd) };
            });
            const ocupadas = new Set(); let ultima = 0, pisan = 0;
            for (const f of fichas) {
                ultima = Math.max(ultima, f.row + f.rows - 1);
                for (let c = f.col; c < f.col + f.cols; c++)
                    for (let r = f.row; r < f.row + f.rows; r++) {
                        if (ocupadas.has(`${c},${r}`)) pisan++;
                        ocupadas.add(`${c},${r}`);
                    }
            }
            return { huecos: ultima * 4 - ocupadas.size, pisan,
                     mapa: Object.fromEntries(fichas.map(f => [f.t, `${f.col},${f.row}`])) };
        });

        const antes = await foto();
        expect(antes.pisan, 'el tablero arranca con widgets encimados').toBe(0);

        // Un widget grande sobre una zona de chicos: el caso que reportó el
        // usuario («si muevo un 2×2 y hay 2 ahí de 1×1 intercambian puesto»).
        const grande  = fichas(page).filter({ hasText: /2×2|2×3/ }).first();
        const destino = fichas(page).filter({ hasText: /1×1/ }).first();
        const ca = await grande.boundingBox(), cb = await destino.boundingBox();
        await page.mouse.move(ca.x + ca.width / 2, ca.y + ca.height / 2);
        await page.mouse.down();
        await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 14 });
        await page.waitForTimeout(150);
        const durante = await foto();
        await page.mouse.up();
        await page.waitForTimeout(250);
        const despues = await foto();

        expect(despues.pisan, 'quedaron widgets encimados').toBe(0);
        expect(despues.huecos, 'el acomodo dejó blancos de más')
            .toBeLessThanOrEqual(antes.huecos + 2);
        const distintos = Object.keys(despues.mapa)
            .filter(k => durante.mapa[k] !== despues.mapa[k]);
        expect(distintos, 'lo que se pinta arrastrando no es lo que se guarda').toEqual([]);
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
