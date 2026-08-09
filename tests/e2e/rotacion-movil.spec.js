// ¿Al girar el teléfono se REMONTA la vista? — F9 de
// `docs/PLAN-CIERRE-MOVIL-2026-08-08.md`.
//
// El defecto: al rotar, iOS deja el contenido repartido al ancho de la
// orientación anterior y la otra mitad sale en blanco. Se arregla solo al
// recargar o al abrir otra vista, así que el ancho correcto existe — lo que no
// vuelve a ocurrir es el reparto. Remontar el árbol es lo que hace «abrir otra
// vista», y es el remedio que quedaba por probar después de que fallaran los dos
// que atacaban el documento (v2.524.7 y v2.524.8, revertidos).
//
// ── Lo que esta prueba SÍ demuestra y lo que NO ──────────────────────────────
// SÍ: que al cambiar la orientación el nodo de la vista se **retira del DOM y
//     entra otro** — o sea que el remontaje ocurre de verdad, y que la vista
//     queda viva y con contenido después.
// NO: que eso arregle el defecto en un iPhone. **El defecto no se reproduce
//     acá**: Playwright re-mide el viewport correctamente al cambiarlo, así que
//     no hay nada roto que observar. Eso lo dice el teléfono, no la máquina.
//
// Se verifica con un `MutationObserver` y no comparando un atributo: el atributo
// cambiaría igual si React sólo re-renderizara el mismo nodo, que es justamente
// lo que ya pasaba y no alcanzaba.

import { test, expect, devices } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.use({ ...devices['iPhone 13'] });

test.describe('Rotación · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('rotacion · girar remonta la vista, y la vista sobrevive', async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(3000);
        // Sin sesión esto mediría la pantalla de login y saldría verde por vacío,
        // que es el mismo agujero que el barrido ya conoce.
        expect(page.url(), 'no se pudo iniciar sesión').not.toMatch(/\/login/);

        await page.goto('/ventas');
        await page.waitForTimeout(7000);

        const marca = '[data-vista-montada]';
        await expect(page.locator(marca)).toHaveCount(1);
        expect(await page.getAttribute(marca, 'data-vista-montada')).toBe('v');

        // El observador se instala ANTES de rotar y anota si el nodo concreto que
        // estaba montado desaparece de la lista de hijos.
        await page.evaluate((sel) => {
            const nodo = document.querySelector(sel);
            window.__rot = { quitado: false, agregado: false };
            const padre = nodo.parentElement;
            new MutationObserver((muts) => {
                for (const m of muts) {
                    if ([...m.removedNodes].includes(nodo)) window.__rot.quitado = true;
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1 && n !== nodo && n.matches?.(sel)) window.__rot.agregado = true;
                    }
                }
            }).observe(padre, { childList: true });
        }, marca);

        // Girar: `matchMedia('(orientation: portrait)')` cambia con el viewport.
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(2500);

        const r = await page.evaluate(() => window.__rot);
        expect(r.quitado, 'el nodo de la vista tiene que SALIR del DOM al girar').toBe(true);
        expect(r.agregado, 'y tiene que entrar uno nuevo en su lugar').toBe(true);

        // La marca sigue la orientación nueva.
        expect(await page.getAttribute(marca, 'data-vista-montada')).toBe('h');

        // Y lo que más importa: la vista quedó VIVA. Un remontaje que deja la
        // pantalla vacía sería peor que el defecto que intenta arreglar.
        const vivo = await page.evaluate((sel) => {
            const n = document.querySelector(sel);
            return { hijos: n.children.length, texto: (n.textContent || '').trim().length };
        }, marca);
        expect(vivo.hijos, 'la vista remontada no puede quedar vacía').toBeGreaterThan(0);
        expect(vivo.texto, 'y tiene que tener contenido').toBeGreaterThan(50);

        // De vuelta a vertical: el remontaje va en los dos sentidos.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(2500);
        expect(await page.getAttribute(marca, 'data-vista-montada')).toBe('v');
    });
});
