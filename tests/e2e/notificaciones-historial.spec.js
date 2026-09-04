import { test, expect } from '@playwright/test';

/* La vista `/notificaciones`: el listado y lo que se sacó de la campana.
 *
 * Corre contra el ENTORNO DE PRUEBAS (`npm run dev:staging`), no contra
 * producción: la prueba devuelve avisos a la campana de alguien, y hacerlo sobre
 * una bandeja real la movería. Con `E2E_BASE_URL` apuntando a otro sitio se
 * salta sola.
 *
 * Lo que verifica es justo lo que ningún gate puede ver:
 *
 *   · que la consulta paginada CONTESTA — la sintaxis de PostgREST del `or()`,
 *     del `not(...is null)` y del `count: 'exact'` no la valida ningún
 *     compilador;
 *   · que **lo que se quita de la campana SIGUE en el listado** (2026-09-04:
 *     «que no se borren, que siempre se vean en el listado»), que es una regla
 *     que se rompe con un filtro de más y no da ningún error;
 *   · y que el corte de 60 días recorta de verdad.
 */

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe('Listado de notificaciones', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'),
            null, { timeout: 60_000 }).catch(() => {});
        expect(page.url()).not.toMatch(/\/login/);
    });

    test('lo que sale de la campana sigue en el listado, y el corte de 60 días recorta', async ({ page }) => {
        /* El portal levanta un diálogo a pantalla completa —«los avisos están
           bloqueados»— cuando el equipo no tiene el push habilitado. No es un
           defecto de esta vista: es su explicación de por qué no llega el aviso.
           Se vuelve a montar en cada ruta y `grantPermissions` no lo evita (el
           portal mira la suscripción, no el permiso), así que se oculta por
           estilo DESPUÉS de cada navegación — que es una navegación real y borra
           lo inyectado antes. */
        const taparElAviso = () => page.addStyleTag({
            content: '[role="dialog"][aria-label*="bloquead"]{display:none!important}',
        });
        const abrir = async (url) => {
            await page.goto(url);
            await page.waitForLoadState('networkidle');
            await taparElAviso();
            await page.waitForTimeout(400);
        };

        /* El contador de la VISTA, no el globo de la campana, y el de la pestaña
           que se está mirando. Dos veces midió otra cosa antes de quedar así: un
           `.tabular-nums` a secas leía «9+» de la campana (que va antes en el
           DOM), y anclarlo al `text-h3` seguía devolviendo el número de la
           pestaña ANTERIOR porque `networkidle` volvía antes que la consulta. Se
           ancla al rótulo —que cambia con la pestaña— y se espera a que deje de
           decir «—», que es lo que muestra mientras carga. */
        const leerTotal = async (rotulo) => {
            const caja = page.locator(
                `div:has(> span.text-h3.tabular-nums):has(> span:text-is("${rotulo}"))`).first();
            await expect(caja).toBeVisible({ timeout: 20_000 });
            const numero = caja.locator('span.tabular-nums').first();
            await expect(numero).not.toHaveText('—', { timeout: 20_000 });
            return Number((await numero.innerText()).replace(/\D/g, ''));
        };

        await abrir('/notificaciones');
        const fichas = page.locator('[data-surface="card"]');
        await expect(fichas.first()).toBeVisible({ timeout: 20_000 });

        // ── 1. «Todas» ve MÁS que las 100 de la campana ──────────────────────
        // Es la mitad del motivo por el que existe esta vista.
        const todas = await leerTotal('En total');
        expect(todas, '«Todas» tiene que ver más de las 100 que carga la campana')
            .toBeGreaterThan(100);

        // ── 2. Y MENOS que todo lo que hay: el corte de 60 días recorta ──────
        // Los avisos sembrados llegan hasta los 70 días. Sin el corte, este
        // número sería el total entero y nadie lo notaría.
        expect(todas, 'el corte de 60 días tiene que dejar avisos afuera')
            .toBeLessThan(160);

        // ── 3. La pestaña vive en la DIRECCIÓN ───────────────────────────────
        await page.getByRole('tab', { name: /Fuera de la campana/ }).click();
        await expect(page).toHaveURL(/[?&]tab=fuera/);
        await page.waitForLoadState('networkidle');
        const fuera = await leerTotal('Fuera de la campana');
        expect(fuera, 'tiene que haber avisos quitados de la campana').toBeGreaterThan(0);

        // ── 4. LA REGLA: lo quitado de la campana SIGUE en «Todas» ───────────
        // Se comprueba por el TÍTULO de uno concreto y no por el conteo: un
        // conteo mayor podría cuadrar por casualidad, y lo que se pidió es que
        // ese aviso no desaparezca.
        const titulo = (await fichas.first().locator('p').first().innerText()).trim();
        expect(titulo.length, 'hace falta un aviso quitado para poder buscarlo').toBeGreaterThan(3);

        await abrir('/notificaciones?tab=todas');
        await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
        await page.locator('input[placeholder*="Buscar en el texto"]').first().fill(titulo.slice(0, 24));
        await page.waitForTimeout(1200);            // el freno de 350 ms + la ida
        await page.waitForLoadState('networkidle');
        const conFiltro = await leerTotal('En total');
        expect(conFiltro, 'un aviso quitado de la campana tiene que seguir apareciendo en «Todas»')
            .toBeGreaterThan(0);
        expect(conFiltro, 'y la búsqueda tiene que acotar de verdad').toBeLessThan(todas);

        // ── 5. La hora si es de hoy, la fecha y la hora si es de antes ──────
        // Y de paso: entrar con `?pag=N` tiene que RESPETAR esa página. Las dos
        // cosas se miden juntas porque la segunda es la que hace visible a la
        // primera —la página 3 es donde caen los avisos de ayer— y porque el
        // mismo bug rompía las dos: un guard de «primera vez» con `useRef` que
        // `StrictMode` consumía en su primera corrida, así que la segunda
        // borraba el `pag` de la dirección. Sólo pasaba en desarrollo.
        const horasDe = () => page.evaluate(() =>
            [...document.querySelectorAll('[data-surface="card"] span.tabular-nums')]
                .map(x => x.textContent.trim()).filter(t => /\d/.test(t)));

        await abrir('/notificaciones?tab=todas&pag=1');
        expect(page.url(), 'la página pedida tiene que sobrevivir a la entrada').toMatch(/pag=1/);
        const deHoy = await horasDe();
        expect(deHoy.length, 'la página 1 tiene avisos').toBeGreaterThan(0);
        expect(deHoy.some(t => /^\d{1,2}:\d{2}/.test(t)),
            'un aviso de hoy muestra SÓLO la hora').toBe(true);

        await abrir('/notificaciones?tab=todas&pag=3');
        expect(page.url(), 'la página 3 tampoco se pierde').toMatch(/pag=3/);
        const deAntes = await horasDe();
        expect(deAntes.some(t => /^\d{1,2} \p{L}+, \d{1,2}:\d{2}/u.test(t)),
            'un aviso de ayer para atrás muestra la fecha Y la hora').toBe(true);

        // ── 6. En el listado NO se borra ─────────────────────────────────────
        // «que solo se borren de ahí [la campana]». El único control de fila que
        // puede existir acá es «Devolver».
        await abrir('/notificaciones?tab=todas');
        expect(await page.locator('button[title="Mover a Borradas"]').count(),
            'el listado no puede ofrecer borrar').toBe(0);

        // ── 7. Devolver a la campana funciona y RESTA de su pestaña ──────────
        await abrir('/notificaciones?tab=fuera');
        const antes = await leerTotal('Fuera de la campana');
        await page.getByRole('button', { name: /Devolver/ }).first().click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForLoadState('networkidle');
        await taparElAviso();
        const despues = await leerTotal('Fuera de la campana');
        expect(despues, 'devolver tiene que restarla de «Fuera de la campana»').toBe(antes - 1);
    });
});
