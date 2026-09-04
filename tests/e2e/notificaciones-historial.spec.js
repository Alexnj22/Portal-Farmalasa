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
        await page.getByRole('tab', { name: /^Sin leer$/ }).click();
        await expect(page).toHaveURL(/[?&]tab=sin_leer/);
        await page.waitForLoadState('networkidle');
        expect(await leerTotal('Sin leer'), 'tiene que haber avisos sin leer').toBeGreaterThan(0);

        // ── 4. LA REGLA: lo que se quita de la CAMPANA sigue en el listado ──
        //
        // Se hace el recorrido entero —quitar en la campana, buscarlo en el
        // listado— en vez de mirar los avisos ya quitados que trae la siembra.
        // La primera versión hacía eso último y **sólo pasaba una vez**: había
        // exactamente uno en la página 1, el paso final lo devolvía, y la
        // segunda corrida encontraba cero. Un test que se gasta a sí mismo da
        // verde el día que se escribe y rojo el día que alguien lo hereda.
        await abrir('/inicio');
        await page.locator('button[aria-label="Notificaciones"]:visible').first().click();
        await page.waitForTimeout(1200);
        /* Dentro del PANEL, no en toda la página: el tablero que queda detrás
           también usa `[data-surface="card"]` para sus widgets, así que un
           selector suelto contaba 48 tarjetas donde la campana tenía 20 y
           acusaba al portal de mostrar las leídas. El instrumento midiendo otra
           cosa, otra vez. */
        const enLaCampana = page.locator('[data-surface="dropdown"] [data-surface="card"]');
        await expect(enLaCampana.first()).toBeVisible({ timeout: 15_000 });
        const elegido = (await enLaCampana.first().locator('p').first().innerText()).trim();
        expect(elegido.length, 'hace falta un aviso en la campana').toBeGreaterThan(3);

        await enLaCampana.first().locator('button[title="Borrar"]').click();
        await page.waitForTimeout(4000);   // pasada la ventana de deshacer (3 s)

        // Y ahí está, en el listado completo, con su marca y su «Devolver».
        await abrir('/notificaciones?tab=todas');
        await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
        await page.locator('input[placeholder*="Buscar en el texto"]').first().fill(elegido.slice(0, 24));
        await page.waitForTimeout(1200);            // el freno de 350 ms + la ida
        await page.waitForLoadState('networkidle');
        expect(await leerTotal('En total'),
            'lo que se quita de la campana tiene que seguir en el listado').toBeGreaterThan(0);

        const devolver = page.getByRole('button', { name: /Devolver/ });
        expect(await devolver.count(), 'y ofrecer devolverlo').toBeGreaterThan(0);
        // Su marca dice «fuera de la campana», no «borrada»: no se borró nada.
        const marca = page.getByText(/Fuera de la campana desde las/);
        const marcasAntes = await marca.count();
        expect(marcasAntes, 'la marca de «fuera de la campana» tiene que estar').toBeGreaterThan(0);

        /* Devolverlo lo saca de esa condición SIN sacarlo del listado.
           Se mide la RESTA y no un cero: la búsqueda es por título y los avisos
           sembrados repiten el suyo, así que después de devolver uno quedan los
           demás marcados. Esperar cero acusaba al portal de no haber devuelto
           nada cuando sí lo había hecho. */
        const totalAntes = await leerTotal('En total');
        await devolver.first().click();
        await page.waitForTimeout(1500);
        await expect(marca).toHaveCount(marcasAntes - 1, { timeout: 10_000 });
        expect(await leerTotal('En total'),
            'devolver NO lo saca del listado: el total no se mueve').toBe(totalAntes);

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

    });

    test('leer en la campana la quita de ahí y la deja en el listado', async ({ page }) => {
        const taparElAviso = () => page.addStyleTag({
            content: '[role="dialog"][aria-label*="bloquead"]{display:none!important}',
        });

        await page.goto('/inicio');
        await page.waitForLoadState('networkidle');
        await taparElAviso();
        await page.waitForTimeout(1500);
        await page.locator('button[aria-label="Notificaciones"]:visible').first().click();
        await page.waitForTimeout(1500);

        /* Dentro del PANEL, no en toda la página: el tablero que queda detrás
           también usa `[data-surface="card"]` para sus widgets, así que un
           selector suelto contaba 48 tarjetas donde la campana tenía 20 y
           acusaba al portal de mostrar las leídas. El instrumento midiendo otra
           cosa, otra vez. */
        const enLaCampana = page.locator('[data-surface="dropdown"] [data-surface="card"]');
        await expect(enLaCampana.first()).toBeVisible({ timeout: 15_000 });

        /* La campana trae SÓLO lo no leído. Se comprueba con el número, no de
           vista: la siembra deja 40 leídas contra 20 sin leer, así que una
           campana que trajera las leídas se notaría de inmediato. */
        const antes = await enLaCampana.count();
        expect(antes,
            'la campana tiene que tener al menos un aviso sin leer — si da 0, resembrar el entorno de pruebas')
            .toBeGreaterThan(0);
        /* Y NO trae las leídas: la siembra deja 160 avisos de los cuales sólo 12
           están sin leer, así que una campana que trajera las leídas mostraría
           decenas. El número exacto no se fija —la prueba anterior puede haber
           leído alguna— pero el orden de magnitud es la prueba. */
        expect(antes, 'la campana trae SÓLO lo no leído, no las 160').toBeLessThanOrEqual(20);

        /* Leerla la saca de la campana, en el acto.
         *
         * Se lee UNA tocándola —que es como se lee de verdad: la tarjeta no
         * tiene botón de «marcar leída», el toque marca y navega— y no con
         * «Leídas», que las marca todas. No es un detalle de estilo: marcar
         * todas dejaba la campana vacía y la corrida siguiente fallaba en la
         * primera aserción. Es el mismo defecto que ya tenía la otra prueba de
         * este archivo — un test que se gasta a sí mismo da verde el día que se
         * escribe y rojo el día que alguien lo hereda. Así consume un aviso por
         * corrida en vez de todos.
         *
         * Lo que la prueba NO puede fabricar es un aviso sin leer: eso no existe
         * como acción de pantalla. Por eso el mensaje dice qué hacer. */
        const elegido = (await enLaCampana.first().locator('p').first().innerText()).trim();
        // `data-filo="ceder"` es la CARA de la tarjeta: el botón grande cuyo
        // `onClick` marca leída y navega. Uno solo — la primera versión daba dos
        // clics y el segundo caía después de navegar, con la página ya cambiada.
        await enLaCampana.first().locator('button[data-filo="ceder"]').first().click();
        await page.waitForTimeout(2500);

        // Al volver a abrirla, ese aviso ya no está.
        await page.goto('/inicio');
        await page.waitForLoadState('networkidle');
        await taparElAviso();
        await page.waitForTimeout(1500);
        await page.locator('button[aria-label="Notificaciones"]:visible').first().click();
        await page.waitForTimeout(1800);
        /* Se mide el CONTEO, no «ese título ya no está»: la siembra repite los
           títulos, así que buscar el suyo encuentra a sus hermanos y la
           aserción acusaba al portal de no haber leído nada cuando el conteo ya
           demostraba que sí. Es la tercera vez en este archivo que un selector
           por título se cruza con la siembra — el conteo no tiene ese problema. */
        expect(await enLaCampana.count(), 'leerla la saca de la campana').toBe(antes - 1);

        // Y sigue en el listado, que es el registro completo.
        await page.goto('/notificaciones?tab=todas');
        await page.waitForLoadState('networkidle');
        await taparElAviso();
        await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
        await page.locator('input[placeholder*="Buscar en el texto"]').first().fill(elegido.slice(0, 28));
        await page.waitForTimeout(1200);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText(elegido, { exact: false }).first())
            .toBeVisible({ timeout: 15_000 });
    });
});
