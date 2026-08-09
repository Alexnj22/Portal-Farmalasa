// F4 de `docs/PLAN-SESIONES-SEGURAS-2026-08-08.md` — la vista de Conexiones.
//
// Acá va SÓLO lo propio de esta vista. Los desbordes y los blancos táctiles los
// mide el barrido oficial (`RUTAS=sesiones … -g "foco"`), y no se reimplementan
// acá a propósito: la primera versión de este archivo midió los blancos con
// `getBoundingClientRect()` y acusó al aspa del `LiquidSelect` compacto —un
// control que YA está resuelto, que se ve de 20px y se toca como uno de 44
// porque extiende su área con `.blanco-tactil`—. Es el error que
// `medicion-movil.js` tiene escrito en su encabezado desde antes: «acusaba al
// que hizo bien el trabajo». Dos instrumentos para la misma medida es uno de
// más, y el que sobra es el nuevo.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// Jerga que el usuario no tiene por qué conocer. `sesión` NO está en la lista:
// es palabra del negocio y la pantalla la usa a propósito.
const PROHIBIDAS = [
    'jwt', 'token', 'session_id', 'user agent', 'user_agent', 'refresh',
    'supabase', 'postgrest', 'rpc', 'auth.sessions', 'erp', 'sync',
];

test.describe('F4 · Conexiones', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('trae datos, tiene su control en el teléfono, y no nombra la tubería', async ({ page }) => {
        test.setTimeout(120_000);

        await page.goto('/');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });

        await page.goto('/sesiones');
        // El `<h2>` del encabezado está oculto en el teléfono a propósito (el
        // shell móvil pone el título aparte), así que se espera al AVISO, que sí
        // se pinta en los dos tamaños.
        await expect(page.getByText('Al cerrar una conexión')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(4_000);

        // El botón de cerrar hace de doble prueba: sólo existe si hay al menos
        // una conexión —o sea que la vista no abrió vacía y hay algo que medir—
        // y además es el CONTROL de la pantalla, que en la ficha móvil es
        // opt-in (`movil.acciones`). Sin esa prop la ficha se ve completa y no
        // lo está: fue exactamente lo que pasó en la primera versión.
        const cerrar = page.getByTitle('Cerrar esta conexión');
        await expect(cerrar.first()).toBeVisible({ timeout: 15_000 });
        expect(await cerrar.count(), 'la vista abrió sin ninguna conexión').toBeGreaterThan(0);

        // La pantalla habla del portal. Grepear el fuente NO alcanza: la mitad
        // de estos textos viven en `title`/`aria-label`/`placeholder`, así que
        // se barre el DOM pintado más esos tres atributos.
        //
        // Acotado a `<main>` y NO al `body` entero, por una razón medida: el
        // menú de la aplicación tiene un módulo rotulado «Salud de Syncs», así
        // que barrer todo el documento acusaba a esta vista de una palabra que
        // no escribe. (Ese rótulo del menú sí incumple la regla de CLAUDE.md
        // «la pantalla habla del portal, nunca del sistema de origen» — es
        // deuda previa, anotada, y no se arregla acá de contrabando.)
        const jerga = await page.evaluate((prohibidas) => {
            const raiz = document.querySelector('main') || document.body;
            const textos = [raiz.innerText];
            for (const el of raiz.querySelectorAll('[title],[aria-label],[placeholder]')) {
                textos.push(
                    el.getAttribute('title') || '',
                    el.getAttribute('aria-label') || '',
                    el.getAttribute('placeholder') || '',
                );
            }
            const todo = textos.join(' \n ').toLowerCase();
            return prohibidas.filter(p => todo.includes(p));
        }, PROHIBIDAS);
        expect(jerga, `la pantalla nombra la tubería: ${JSON.stringify(jerga)}`).toEqual([]);
    });
});
