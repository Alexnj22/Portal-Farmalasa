import { test, expect } from '@playwright/test';

/* La vista `/notificaciones`: el historial paginado y la papelera.
 *
 * Corre contra el ENTORNO DE PRUEBAS (`npm run dev:staging`), no contra
 * producción: la prueba borra y restaura avisos, y hacerlo sobre la campana de
 * alguien real le movería la bandeja. Con `E2E_BASE_URL` apuntando a otro sitio
 * se salta sola.
 *
 * Lo que verifica es justo lo que ningún gate puede ver: que la consulta
 * paginada CONTESTA —la sintaxis de PostgREST del `or()`, del `not(...is null)`
 * y del `count: 'exact'` no la valida ningún compilador—, que borrar mueve el
 * aviso a la papelera y que devolverlo lo trae de vuelta.
 */

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe('Historial de notificaciones', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test.beforeEach(async ({ page, context, baseURL }) => {
        /* El permiso de avisos, concedido de entrada. Sin él el portal levanta
           un diálogo a pantalla completa —«los avisos están bloqueados»— que no
           es un defecto de esta vista sino su explicación de por qué no llega
           el push, y que en una corrida automática tapa todo. */
        await context.grantPermissions(['notifications'], { origin: baseURL });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'),
            null, { timeout: 60_000 }).catch(() => {});
        expect(page.url()).not.toMatch(/\/login/);

    });

    test('pagina, filtra y devuelve lo borrado', async ({ page }) => {
        /* El portal levanta un diálogo a pantalla completa —«los avisos están
           bloqueados»— cuando el equipo no tiene el push habilitado. No es un
           defecto de esta vista: es su explicación de por qué no llega el
           aviso. Aparece DESPUÉS de que carga la pantalla y `grantPermissions`
           no lo evita (el portal mira la suscripción, no el permiso), así que
           se cierra tras cada navegación. */
        const abrir = async (url) => {
            await page.goto(url);
            await page.waitForLoadState('networkidle');
            const entendido = page.getByRole('button', { name: /^Entendido$/ });
            if (await entendido.count()) await entendido.first().click().catch(() => {});
            await page.waitForTimeout(300);
        };

        await abrir('/notificaciones');

        // ── 1. La lista carga y el total NO es el tope de la campana ─────────
        // Es la mitad del motivo por el que existe esta vista: con 140 avisos,
        // una pantalla que dijera 100 estaría repitiendo el defecto.
        const fichas = page.locator('[data-surface="card"]');
        await expect(fichas.first()).toBeVisible({ timeout: 20_000 });

        /* El contador de la VISTA, no el globo de la campana del encabezado, y
           el de la pestaña que se está mirando.
           Dos veces midió otra cosa antes de quedar así: un `.tabular-nums`
           a secas leía «9+» de la campana (que va antes en el DOM), y
           anclarlo al `text-h3` seguía devolviendo el número de la pestaña
           ANTERIOR porque `networkidle` volvía antes que la consulta. Se ancla
           al rótulo —que cambia con la pestaña— y se espera a que deje de
           decir «—», que es lo que muestra mientras carga. */
        const leerTotal = async (rotulo) => {
            // `:has(> span.text-h3…)` además del rótulo: sin eso el selector
            // también matchea la PESTAÑA del mismo nombre, que está oculta —la
            // barra rinde dos juegos, uno por ancho— y la espera moría ahí.
            const caja = page.locator(
                `span:has(> span.text-h3.tabular-nums):has(> span:text-is("${rotulo}"))`).first();
            await expect(caja).toBeVisible({ timeout: 20_000 });
            const numero = caja.locator('span.tabular-nums').first();
            await expect(numero).not.toHaveText('—', { timeout: 20_000 });
            return Number((await numero.innerText()).replace(/\D/g, ''));
        };

        const total = await leerTotal('Sin leer');
        expect(total, 'el contador de «sin leer» tiene que traer un número').toBeGreaterThan(0);

        // ── 2. La pestaña vive en la DIRECCIÓN ───────────────────────────────
        await page.getByRole('tab', { name: /^Todas$/ }).click();
        await expect(page).toHaveURL(/[?&]tab=activas/);
        await page.waitForLoadState('networkidle');
        const totalTodas = await leerTotal('En total');
        expect(totalTodas, '«Todas» tiene que ver MÁS que las 100 de la campana').toBeGreaterThan(100);

        // ── 3. La página también, y recargar no la pierde ────────────────────
        const irAlaDos = page.getByRole('button', { name: '2', exact: true });
        if (await irAlaDos.count()) {
            await irAlaDos.first().click();
            await expect(page).toHaveURL(/[?&]pag=2/);
            await page.reload();
            await page.waitForLoadState('networkidle');
            await expect(page).toHaveURL(/[?&]pag=2/);
            await expect(fichas.first()).toBeVisible({ timeout: 20_000 });
        }

        // ── 4. La búsqueda va al SERVIDOR y acota de verdad ──────────────────
        await abrir('/notificaciones?tab=activas');
        /* El buscador vive colapsado detrás de la lupa: `ViewTabBar` rinde el
           campo siempre pero lo tapa la fila de pestañas hasta que se abre. */
        await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
        const buscador = page.locator('input[placeholder*="Buscar en el texto"]').first();
        await buscador.fill('ALGODON');
        await page.waitForTimeout(1200);            // el freno de 350 ms + la ida
        await page.waitForLoadState('networkidle');
        const conFiltro = await leerTotal('En total');
        expect(conFiltro, 'buscar tiene que devolver menos que todo').toBeLessThan(totalTodas);
        expect(conFiltro, 'y no cero: «ALGODON» está en el cuerpo de los avisos sembrados').toBeGreaterThan(0);

        // ── 5. Borrar mueve a la papelera; devolver la trae de vuelta ────────
        await abrir('/notificaciones?tab=borradas');
        const antes = await leerTotal('Borradas');

        await abrir('/notificaciones?tab=activas');
        await page.locator('button[title="Mover a Borradas"]').first().click();
        await page.waitForTimeout(1500);

        await abrir('/notificaciones?tab=borradas');
        const despues = await leerTotal('Borradas');
        expect(despues, 'borrar tiene que SUMAR una a la papelera, no destruir la fila')
            .toBe(antes + 1);

        // Y se devuelve, que es la pregunta que originó todo esto.
        await page.getByRole('button', { name: /Devolver/ }).first().click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForLoadState('networkidle');
        const final = await leerTotal('Borradas');
        expect(final, 'devolver tiene que RESTARLA de la papelera').toBe(antes);
    });
});
