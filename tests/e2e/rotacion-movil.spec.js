// El remontaje al girar — sus DOS brazos. F9 de
// `docs/planes-cerrados/PLAN-CIERRE-MOVIL-2026-08-08.md`.
//
// ── Qué se supo después de escribir la primera versión de esta prueba ─────────
// El remontaje (v2.526.0) se agregó leyendo el síntoma como «al rotar el
// contenido queda pintado al ancho anterior y sólo vuelve al recargar o abrir
// otra vista». El usuario lo probó en su iPhone y lo describió mejor: «media
// pantalla se adapta bien, rápido; cuando pasa a ocupar toda la pantalla se
// traba y se ve raro, son segundos». El ancho correcto **llega solo**: no hay
// reparto que forzar, y remontar sólo agrega trabajo en el peor momento.
//
// Así que en v2.526.3 el remontaje quedó **apagado por defecto**, detrás del
// interruptor `portal_remontar_al_girar` que se enciende desde `/ios-test`. No
// se borró porque sigue siendo una de las tres explicaciones vivas del trabón, y
// descartarla exige girar con y sin él en el mismo teléfono.
//
// ── Lo que esta prueba SÍ demuestra y lo que NO ──────────────────────────────
// SÍ: que el interruptor manda de verdad en los dos sentidos — apagado el nodo
//     de la vista **sobrevive** al giro, encendido **sale del DOM y entra otro**
//     y la vista queda viva y con contenido.
// NO: que ninguna de las dos posiciones arregle el defecto del iPhone. **El
//     defecto no se reproduce acá**: Playwright re-mide el viewport
//     correctamente, así que no hay nada roto que observar. Eso lo dice el
//     teléfono, no la máquina.
//
// Se verifica con un `MutationObserver` y no comparando el atributo: el atributo
// sigue la orientación en las DOS posiciones del interruptor —es por donde la
// sonda de rotación encuentra la vista— así que mirarlo no distingue un
// remontaje de un simple re-render. Es justamente el error que dejó pasar la
// versión anterior de esta idea.

import { test, expect, devices } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const MARCA = '[data-vista-montada]';

// Instala el observador ANTES de girar: anota si el nodo concreto que estaba
// montado desaparece de la lista de hijos, y si entra otro en su lugar.
const observar = (page) => page.evaluate((sel) => {
    const nodo = document.querySelector(sel);
    window.__rot = { quitado: false, agregado: false };
    new MutationObserver((muts) => {
        for (const m of muts) {
            if ([...m.removedNodes].includes(nodo)) window.__rot.quitado = true;
            for (const n of m.addedNodes) {
                if (n.nodeType === 1 && n !== nodo && n.matches?.(sel)) window.__rot.agregado = true;
            }
        }
    }).observe(nodo.parentElement, { childList: true });
}, MARCA);

test.use({ ...devices['iPhone 13'] });

test.describe('Rotación · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('rotacion · el interruptor del remontaje manda en los dos sentidos', async ({ page }) => {
        test.setTimeout(240_000);

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
        await expect(page.locator(MARCA)).toHaveCount(1);
        expect(await page.getAttribute(MARCA, 'data-vista-montada')).toBe('movil');

        // ── Brazo 1: apagado (el default) ────────────────────────────────────
        // Es el control. Sin él, la corrida con remontaje no tendría contra qué
        // compararse y «el nodo cambió» no probaría que lo hizo el interruptor.
        await observar(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(2500);

        const apagado = await page.evaluate(() => window.__rot);
        expect(apagado.quitado, 'apagado, el nodo de la vista NO puede salir del DOM').toBe(false);
        // Y el atributo tampoco se mueve: apagado, el shell ni siquiera se
        // suscribe a la orientación, así que girar no produce un solo re-render.
        // La marca queda para que la sonda encuentre la vista, nada más.
        expect(await page.getAttribute(MARCA, 'data-vista-montada')).toBe('movil');

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(1500);

        // ── Brazo 2: encendido ───────────────────────────────────────────────
        // El interruptor se lee UNA vez al montar `AppLayout` — por eso la
        // pantalla de `/ios-test` recarga al cambiarlo, y por eso acá también.
        await page.evaluate(() => localStorage.setItem('portal_remontar_al_girar', '1'));
        await page.reload();
        await page.waitForTimeout(7000);
        await expect(page.locator(MARCA)).toHaveCount(1);

        await observar(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(2500);

        const encendido = await page.evaluate(() => window.__rot);
        expect(encendido.quitado, 'encendido, el nodo de la vista tiene que SALIR del DOM').toBe(true);
        expect(encendido.agregado, 'y tiene que entrar uno nuevo en su lugar').toBe(true);
        expect(await page.getAttribute(MARCA, 'data-vista-montada')).toBe('h');

        // Lo que más importa: la vista quedó VIVA. Un remontaje que deja la
        // pantalla vacía sería peor que el defecto que intenta arreglar.
        const vivo = await page.evaluate((sel) => {
            const n = document.querySelector(sel);
            return { hijos: n.children.length, texto: (n.textContent || '').trim().length };
        }, MARCA);
        expect(vivo.hijos, 'la vista remontada no puede quedar vacía').toBeGreaterThan(0);
        expect(vivo.texto, 'y tiene que tener contenido').toBeGreaterThan(50);

        // De vuelta a vertical: el remontaje va en los dos sentidos.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(2500);
        expect(await page.getAttribute(MARCA, 'data-vista-montada')).toBe('v');
    });
});
