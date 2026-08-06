import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Banco de §6 repetido sobre la IMPLEMENTACIÓN REAL, que es lo que §9 pide.
// El original se corrió sobre el mockup y dio 16.6-16.7ms de mediana con cero
// cuadros sobre 33ms, con la CPU estrangulada ×6 y 60 tarjetas. Acá se mide lo
// mismo contra el portal compilado.
//
// La primera medición de §6 dio 23.8ms y la causa NO era el efecto sino el JS:
// un `pointermove` que llamaba `getBoundingClientRect()` sobre todas las
// tarjetas. Por eso el número que importa no es «se ve bien», es este.
//
// ⚠️ ESTE BANCO SE CORRE **HEADED**, SIEMPRE:
//
//     npx playwright test banco-material --grep 60fps --headed
//
// En headless no hay compositor con GPU, así que el `backdrop-filter` cae a CPU
// y el número deja de significar nada. Medido el 2026-08-06 en la misma máquina,
// misma CPU ×6, mismo recorrido:
//
//     tema            headless      headed
//     liquid          133.2ms       16.7ms
//     liquid-oscuro   133.1ms       16.7ms
//     solid            16.7ms       16.7ms
//     solid-oscuro     16.7ms       16.7ms
//
// O sea que headless reporta Liquid **ocho veces más lento** de lo que es, y a
// Solid no lo toca —porque Solid no tiene `backdrop-filter` que componer—. Un
// banco corrido en headless diría «el vidrio va a 7fps» y mandaría a alguien a
// destruir el material por un problema que no existe.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const TEMAS = [
    { id: '',            nombre: 'liquid' },
    { id: 'dark',        nombre: 'liquid-oscuro' },
    { id: 'solid',       nombre: 'solid' },
    { id: 'solid-dark',  nombre: 'solid-oscuro' },
];

const SALIDA = 'test-results/capturas-material';

const entrar = async (page) => {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByText('Inicio').first()).toBeVisible({ timeout: 15_000 });
};

const ponerTema = (page, id) => page.evaluate((t) => {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
}, id);

test.describe('§6 · banco sobre la implementación real', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    for (const tema of TEMAS) {
        test(`60fps con CPU ×6 · ${tema.nombre}`, async ({ page, browserName }, testInfo) => {
            // Se niega a medir en headless en vez de devolver un número falso:
            // un banco que miente es peor que un banco que no corre.
            const headless = testInfo.project.use.headless !== false
                && !process.argv.includes('--headed');
            test.skip(headless,
                'El banco de §6 sólo vale headed: sin GPU el backdrop-filter cae a CPU '
                + 'y Liquid mide 8× más lento de lo que es. Correr con --headed.');
            await entrar(page);
            await page.goto('/staff');
            await page.waitForTimeout(3500);
            await ponerTema(page, tema.id);
            await page.waitForTimeout(400);

            const cds = await page.context().newCDPSession(page);
            await cds.send('Emulation.setCPUThrottlingRate', { rate: 6 });

            // Muestreo por cuadro mientras el puntero barre las tarjetas: es el
            // gesto que dispara el canto (`filo-corre`) y el lift.
            await page.evaluate(() => {
                window.__cuadros = [];
                let ultimo = performance.now();
                const tic = (t) => {
                    window.__cuadros.push(t - ultimo);
                    ultimo = t;
                    if (window.__midiendo) requestAnimationFrame(tic);
                };
                window.__midiendo = true;
                requestAnimationFrame(tic);
            });

            const caja = page.viewportSize();
            for (let i = 0; i < 26; i++) {
                await page.mouse.move(
                    120 + (i * 47) % (caja.width - 240),
                    200 + (i * 63) % Math.max(120, caja.height - 320),
                );
                await page.waitForTimeout(60);
            }

            const r = await page.evaluate(() => {
                window.__midiendo = false;
                // El primer cuadro mide desde que arrancó el rAF, no un cuadro real
                const c = window.__cuadros.slice(2).sort((a, b) => a - b);
                const p = (q) => c[Math.min(c.length - 1, Math.floor(c.length * q))];
                return {
                    n: c.length,
                    mediana: p(0.5),
                    p95: p(0.95),
                    max: c[c.length - 1],
                    sobre33: c.filter(x => x > 33).length,
                };
            });
            await cds.send('Emulation.setCPUThrottlingRate', { rate: 1 });

            console.log(`\n── ${tema.nombre} · CPU ×6 · ${r.n} cuadros ──`);
            console.log(`   mediana ${r.mediana.toFixed(1)}ms · p95 ${r.p95.toFixed(1)}ms · máx ${r.max.toFixed(1)}ms`);
            console.log(`   cuadros sobre 33ms: ${r.sobre33}`);

            expect(r.n, 'muestras suficientes').toBeGreaterThan(30);
            // §6 pide 60fps sostenidos. Se deja aire sobre los 16.7 teóricos
            // porque acá hay un portal entero corriendo, no un mockup.
            expect(r.mediana, 'mediana del cuadro').toBeLessThan(24);
        });
    }
});

test.describe('§9 · capturas en los cuatro temas', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('captura de cada elemento en los cuatro temas y con reduced-motion', async ({ page }) => {
        // 16 capturas × (navegar + asentar) no entran en los 30s por defecto.
        test.setTimeout(240_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        await entrar(page);

        const PANTALLAS = [
            { id: 'tarjetas-y-carril', url: '/staff' },
            { id: 'tabla-y-pildora',   url: '/productos' },
            { id: 'tablero',           url: '/' },
        ];

        for (const tema of TEMAS) {
            for (const p of PANTALLAS) {
                await page.goto(p.url);
                await page.waitForTimeout(3000);
                await ponerTema(page, tema.id);
                await page.waitForTimeout(600);
                await page.screenshot({ path: `${SALIDA}/${p.id}__${tema.nombre}.png`, fullPage: false });
            }
        }

        // Y con `prefers-reduced-motion`: §9 lo pide aparte porque el reloj y el
        // canto se apagan ahí, y lo que se apaga hay que verlo apagado.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const tema of TEMAS) {
            await page.goto('/staff');
            await page.waitForTimeout(2500);
            await ponerTema(page, tema.id);
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SALIDA}/reduced-motion__${tema.nombre}.png` });
        }

        const hechas = fs.readdirSync(SALIDA).filter(f => f.endsWith('.png'));
        console.log(`\n  ${hechas.length} capturas en ${SALIDA}`);
        hechas.sort().forEach(f => console.log(`    · ${f}`));
        expect(hechas.length).toBe(TEMAS.length * (PANTALLAS.length + 1));
    });
});
