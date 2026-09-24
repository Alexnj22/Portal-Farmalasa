// En el teléfono el Inicio tiene UN solo scroll: el de la página.
//
// 2026-09-24, reporte del usuario: «el scroll es raro y no funciona bien». Con
// gestos táctiles medidos había dos causas, y las dos se leían igual desde la
// mano:
//
//   1. Un segundo scroller envolviendo la vista entera: `GlassViewLayout`
//      llevaba `overflow-x-hidden` sin prefijo, y `overflow-x: hidden` obliga
//      al eje Y a `auto`. Le sobraban 34px, y según dónde empezara el dedo el
//      gesto movía la página o ese contenedor — desde la franja de arriba, 0px.
//   2. Baldosas de alto fijo que cortaban su contenido y lo ofrecían por una
//      ranura con scroll propio: «Bolsas de efectivo» mostraba 16px de su lista
//      con 117px escondidos, el monto incluido.
//
// Lo que se afirma acá es la propiedad, no el síntoma: ningún contenedor de la
// vista scrollea, ninguna baldosa esconde contenido y ninguna tiene scroll
// propio. Si alguien vuelve a poner `overflow-x-hidden` sin `lg:` o a fijar el
// alto de la fila en el teléfono, esto falla.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function entrar(page) {
    await page.goto('/login');
    await page.waitForTimeout(2000);
    for (let intento = 0; intento < 4; intento++) {
        await page.locator('#username').fill('');
        await page.locator('#username').fill(E2E_USER);
        await page.waitForTimeout(400);
        await page.locator('#password').fill('');
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.waitForTimeout(400);
        if (await page.locator('#username').inputValue() === E2E_USER
            && await page.locator('#password').inputValue() === E2E_PASSWORD) break;
    }
    await page.locator('#password').press('Enter');
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 6_000 }).catch(() => {});
}

test('el Inicio del teléfono tiene un solo scroll y ninguna tarjeta cortada', async ({ page }) => {
    // Corre en el proyecto WebKit iPhone; en el de escritorio la baldosa SÍ
    // tiene alto fijo y scroll propio a propósito, y el contenedor SÍ scrollea.
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'sólo aplica al teléfono');
    await entrar(page);
    await page.goto('/');
    await page.waitForSelector('[data-rejilla-widgets] [data-widget-id]', { timeout: 20_000 });
    await page.waitForTimeout(4_000);   // que los widgets terminen de poblar

    const r = await page.evaluate(() => {
        const rejilla = document.querySelector('[data-rejilla-widgets]');
        // Scrollers verticales que ENVUELVEN a la rejilla: en el teléfono no
        // tiene que haber ninguno — la que scrollea es la página.
        const envolventes = [];
        for (let e = rejilla.parentElement; e && e !== document.body; e = e.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(e).overflowY)) envolventes.push(e.className.toString().slice(0, 80));
        }
        const baldosas = [...rejilla.querySelectorAll('[data-widget-id]')].filter(b => b.getBoundingClientRect().height > 0);
        const cortadas = [];
        const conScroll = [];
        for (const b of baldosas) {
            for (const e of b.querySelectorAll('*')) {
                const cs = getComputedStyle(e);
                const sobra = e.scrollHeight - e.clientHeight;
                if (sobra <= 4) continue;
                if (/(auto|scroll)/.test(cs.overflowY)) conScroll.push(`${b.dataset.widgetId} (${sobra}px)`);
                else if (/(hidden|clip)/.test(cs.overflowY)) cortadas.push(`${b.dataset.widgetId} (${sobra}px)`);
            }
        }
        return { envolventes, cortadas: [...new Set(cortadas)], conScroll: [...new Set(conScroll)], baldosas: baldosas.length };
    });

    expect(r.baldosas, 'no se pintó ninguna baldosa: la prueba no probaría nada').toBeGreaterThan(0);
    expect(r.envolventes, 'hay un scroller envolviendo la vista: el gesto se reparte entre dos').toEqual([]);
    expect(r.conScroll, 'baldosas con scroll propio dentro de la página').toEqual([]);
    expect(r.cortadas, 'baldosas que esconden contenido').toEqual([]);
});
