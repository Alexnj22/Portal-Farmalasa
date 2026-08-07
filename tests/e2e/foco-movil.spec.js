import { test, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR } from './medicion-movil.js';

// El barrido de las 37 vistas tarda 4.5 minutos, y arreglar una vista sola
// significa correrlo entero para ver si quedó bien. Esto mira LAS QUE SE LE
// PIDAN, con el mismo instrumento, para poder iterar en veinte segundos:
//
//   RUTAS=overview,minmax npx playwright test --project=webkit-movil -g foco
//
// La foto sale del viewport y no de la página completa a propósito: acá se
// mira, y una página de 14.000px reducida a 2.000 no deja ver de qué se habla.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const SALIDA = 'test-results/foco-movil';
const RUTAS = (process.env.RUTAS || 'overview').split(',').map(r => r.trim()).filter(Boolean);

test.use({ ...devices['iPhone 13'] });

test.describe('Foco · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('foco en las rutas pedidas', async ({ page }) => {
        test.setTimeout(60_000 + RUTAS.length * 30_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        // La consola, porque una vista que revienta se ve igual que una vista
        // vacía: las dos miden cero fichas y cero tablas. Proveedores llevaba
        // rota sin que el barrido lo dijera.
        const errores = [];
        page.on('pageerror', e => errores.push(`[pageerror] ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') errores.push(`[console] ${m.text().slice(0, 300)}`); });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(6000);
        // Sin sesión se mide la pantalla de login, que está bien hecha: sale
        // todo en cero y se lee como «perfecto». Ver la nota del barrido.
        if (/\/login/.test(page.url())) {
            throw new Error('No se pudo iniciar sesión: se estaría midiendo la pantalla de login.');
        }

        for (const ruta of RUTAS) {
            errores.length = 0;
            await page.goto('/' + ruta).catch(() => {});
            await page.waitForTimeout(6500);
            // `CLIC=texto` toca algo antes de medir: hay pantallas cuyo contenido
            // sólo existe después de entrar a un elemento de su lista.
            if (process.env.CLIC) {
                await page.getByText(process.env.CLIC, { exact: false }).first()
                    .click({ timeout: 5000 }).catch(() => console.log(`   (no se pudo tocar «${process.env.CLIC}»)`));
                await page.waitForTimeout(2500);
            }
            const m = await page.evaluate(MEDIR).catch(() => null);
            console.log(`\n── /${ruta} ` + '─'.repeat(40));
            const reventó = await page.locator('text=ALGO SALIÓ MAL').count().catch(() => 0);
            if (reventó) console.log('   ⚠️  LA VISTA REVENTÓ');
            [...new Set(errores)].slice(0, 6).forEach(e => console.log('   ' + e));
            if (!m) { console.log('   (no cargó)'); continue; }
            console.log('   ' + JSON.stringify(m.totales));
            (m.grupos?.chicos || []).forEach(g =>
                console.log(`   [${g.n}] chico  ${g.muestra.sel}  ${g.muestra.tam}  «${g.muestra.texto}»`));
            (m.grupos?.desbordan || []).forEach(g =>
                console.log(`   [${g.n}] sale ${g.muestra.sobra}px  ${g.muestra.sel}  «${(g.muestra.texto || '').slice(0, 40)}»`
                    + `\n        recorta: ${g.muestra.recorte}`));
            if (process.env.REJILLA) {
                const w = await page.evaluate(() => [...document.querySelectorAll('[data-widget-id]')].map(e => {
                    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
                    return { id: e.dataset.widgetId, col: cs.gridColumnStart, row: cs.gridRowStart,
                             span: cs.gridColumnEnd + '/' + cs.gridRowEnd, alto: Math.round(r.height) };
                }));
                w.forEach(x => console.log(`   ${x.id.padEnd(16)} col ${String(x.col).padStart(2)} fila ${String(x.row).padStart(2)}  ${x.span.padEnd(16)} alto ${x.alto}`));
            }
            const pantallas = Number(process.env.PANTALLAS || 3);
            for (let i = 0; i < pantallas; i++) {
                await page.screenshot({ path: `${SALIDA}/${ruta}-${i}.png` });
                await page.evaluate(() => window.scrollBy(0, window.innerHeight - 60));
                await page.waitForTimeout(400);
            }
        }
    });
});
