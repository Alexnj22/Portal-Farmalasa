// F4 de `docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md` — la vista de Conexiones.
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
        await expect(page.getByText('se abre una conexión nueva')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(4_000);

        // Una tarjeta por persona. Si no hay ninguna, la vista abrió vacía y
        // todo lo que se mida abajo pasaría por no tener nada que medir.
        const tarjetas = page.locator('button[data-surface="card"]');
        expect(await tarjetas.count(), 'la vista abrió sin ninguna persona').toBeGreaterThan(0);

        // El control de la pantalla vive en el detalle: se abre y se comprueba
        // que esté. Es el que se olvida — la versión anterior de esta vista lo
        // perdía entero en el teléfono sin que nada lo dijera.
        await tarjetas.first().click();
        await expect(page.getByText('conexiones abiertas').or(page.getByText('conexión abierta')))
            .toBeVisible({ timeout: 15_000 });
        await expect(page.getByTitle('Cerrar esta conexión').first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Cerrar todas' })).toBeVisible();

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

    // `page.route` NO ve las peticiones que pasan por un service worker, y el
    // portal registra uno (`public/sw.js`). No importa que ese worker deje pasar
    // la API de Supabase directo a la red sin tocarla: con el worker registrado,
    // la intercepción del test nunca se aplica. Se bloquea sólo para esta prueba.
    //
    // Costó una vuelta encontrarlo porque `page.on('request')` SÍ mostraba el
    // POST a `list_sessions`: la petición existía y el route no la agarraba. El
    // control de «¿se interceptó algo?» fue lo que lo destrabó — sin él, el test
    // habría acusado a la vista de no mostrar el aviso.
    test.use({ serviceWorkers: 'block' });

    // El bug que el usuario reportó como «me sale la vista vacía».
    //
    // La RPC lo rechazaba con 42501 —su cargo no tenía el módulo otorgado— y la
    // vista se tragaba el error con un `console.error` y pintaba el estado
    // vacío. Un fallo y una lista sin filas se veían IGUAL, así que lo único que
    // la persona podía reportar era «está vacía»: la pantalla contestaba una
    // pregunta que nadie hizo, y encima con cara de normalidad.
    test('un rechazo del servidor NO se ve como una lista vacía', async ({ page }) => {
        test.setTimeout(120_000);

        await page.goto('/');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });

        // Se finge exactamente lo que devuelve la RPC cuando falta el permiso.
        let interceptada = 0;
        const vistas = [];
        page.on('request', (r) => { if (r.url().includes('/rpc/')) vistas.push(`${r.method()} ${r.url()}`); });
        await page.route('**/rpc/list_sessions**', (route) => {
            interceptada += 1;
            return route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ code: '42501', message: 'sin permiso para ver las conexiones' }),
            });
        });

        await page.goto('/sesiones');
        await expect(page.getByText('se abre una conexión nueva')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3_000);

        // El control va PRIMERO: si la llamada nunca se interceptó, lo de abajo
        // fallaría por el motivo equivocado y mandaría a arreglar la vista
        // cuando el roto sería el test.
        expect(interceptada, `la llamada nunca se interceptó. Peticiones a /rpc/ vistas:\n${vistas.join('\n') || '(ninguna)'}`).toBeGreaterThan(0);

        const texto = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
        expect(texto, `la vista no avisó del rechazo. Lo que se ve:\n${texto.slice(0, 600)}`)
            .toContain('Tu cargo todavía no tiene acceso');

        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
});
