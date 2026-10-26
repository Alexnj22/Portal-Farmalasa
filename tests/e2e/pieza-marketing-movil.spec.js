import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR, MEDIR_CUERPO } from './medicion-movil.js';

/**
 * La PIEZA de Marketing en el teléfono (2026-10-26).
 *
 * `dialogos-movil` abre diálogos apretando botones cuyo rótulo dice que abren
 * algo («Nuevo…», «Editar…», «Ver…»). Una pieza de Marketing no se abre así: se
 * abre tocando su ficha en el calendario o en el flujo, cuyo nombre es
 * «Abrir <título>», y además el barrido salta todo `data-surface="card"`. O sea
 * que `PiezaModal` —el diálogo más largo de Marketing, con flujo, archivos,
 * pauta y conversación— **nunca se había medido en un teléfono**.
 *
 * ── El freno ───────────────────────────────────────────────────────────────
 * Es el mismo que el del barrido de diálogos: abrir no puede escribir. Se toca
 * SÓLO la ficha (que navega a `?pieza=<id>` y no escribe nada), se mide, y se
 * cierra con Escape. Adentro de la pieza no se aprieta ningún botón — ahí viven
 * «Enviar», «Marcar publicada», «Liberar» y «Eliminar».
 *
 * ── Si no hay piezas ────────────────────────────────────────────────────────
 * Desde acá no se siembra (la escritura sería justamente lo que el freno
 * prohíbe): el mes y sus tres piezas los pone
 * `scripts/entorno-pruebas/siembra_marketing.sql`, que corre el mantenimiento
 * diario del entorno de pruebas para el mes en curso. Se recorren
 * los últimos `MESES_ATRAS` meses en la pestaña Flujo; si en ninguno hay una
 * ficha, la prueba se SALTA con el motivo escrito — no pasa en verde, porque
 * «no medí nada» no es «está bien».
 *
 * Correr: `E2E_BASE_URL=… E2E_USER=… E2E_PASSWORD=… [ORIENTACION=acostado]
 *   npx playwright test tests/e2e/pieza-marketing-movil.spec.js --project=webkit-movil`
 */

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const ACOSTADO = process.env.ORIENTACION === 'acostado';
const APARATO = ACOSTADO ? devices['iPhone 13 landscape'] : devices['iPhone 13'];
const MESES_ATRAS = Number(process.env.MESES_ATRAS || 6);
const TOPE_PIEZAS = Number(process.env.TOPE_PIEZAS || 3);
const SALIDA = 'barridos';
const INFORME = `${SALIDA}/informe-pieza-marketing${ACOSTADO ? '-acostado' : ''}.json`;

test.use({ ...APARATO });

const mesMenos = (n) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

test.describe('Marketing · la pieza en el teléfono', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('abrir una pieza y medirla', async ({ page }) => {
        test.setTimeout(Number(process.env.TIMEOUT_MS) || 300_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        const errores = [];
        page.on('pageerror', e => errores.push(e.message.slice(0, 200)));

        await page.goto('/login');
        // El formulario se re-monta mientras carga (ver `dialogos-movil`).
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1500);
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 60_000 }).catch(() => {});
        expect(page.url(), 'no se pudo iniciar sesión').not.toMatch(/\/login/);

        // Las fichas de pieza son `clickable(..., { label: 'Abrir <título>' })`
        // dentro del cuerpo de la vista (no del marco).
        const fichas = () => page.evaluate(() => [...document.querySelectorAll('[role="button"][aria-label^="Abrir "]')]
            .filter(el => !el.closest('nav, header, aside, [role="dialog"], [data-sidebar]'))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map(el => el.getAttribute('aria-label')));

        let mes = null, nombres = [];
        for (let i = 0; i <= MESES_ATRAS && !nombres.length; i++) {
            mes = mesMenos(i);
            await page.goto(`/marketing?tab=tablero&mes=${mes}`);
            await page.waitForTimeout(4000);
            nombres = [...new Set(await fichas())];
            console.log(`   ${mes}: ${nombres.length} pieza(s)`);
        }
        test.skip(!nombres.length,
            `El entorno no tiene piezas de Marketing en los últimos ${MESES_ATRAS + 1} meses: no hay nada que abrir. `
            + 'Correr scripts/entorno-pruebas/siembra_marketing.sql en el entorno de pruebas (no desde este spec: abrir no puede escribir).');

        const informe = [];
        for (const nombre of nombres.slice(0, TOPE_PIEZAS)) {
            errores.length = 0;
            const ficha = page.locator(`[role="button"][aria-label="${nombre.replace(/"/g, '\\"')}"]`).first();
            try {
                await ficha.click({ timeout: 4000 });
            } catch {
                await ficha.evaluate(el => el.click());
            }
            await page.waitForSelector('[role="dialog"]', { timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            const abierto = await page.locator('[role="dialog"]').count();
            if (!abierto) {
                console.log(`   – «${nombre}» no abrió un diálogo`);
                continue;
            }
            const m = await page.evaluate(MEDIR);
            const alto = await page.evaluate(MEDIR_CUERPO);
            informe.push({
                ruta: `marketing»${nombre.slice(0, 40)}`, mes, ...m.totales,
                desbordePagina: m.desbordePagina, grupos: m.grupos, imposibles: m.imposibles,
                alto, error: errores.length ? [...errores] : undefined,
            });
            console.log(`   ✓ «${nombre}» · desbP ${m.desbordePagina} · salen ${m.totales.desbordan} · dedo ${m.totales.chicos}`
                + ` · zoom ${m.totales.zoomIOS} · imposib ${m.totales.imposibles}`
                + (alto ? ` · cuerpo ${alto.cuerpo}/${alto.altoUtil}px (${alto.pct}%) pie ${alto.pie} cabecera ${alto.cabecera}` : ''));
            for (const g of m.grupos.chicos.slice(0, 4)) console.log(`       dedo ×${g.n}: ${g.clave.slice(0, 150)}`);
            for (const g of m.grupos.desbordan.slice(0, 4)) console.log(`       sale ×${g.n}: ${g.clave.slice(0, 150)}`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1200);
            if (await page.locator('[role="dialog"]').count()) {
                await page.goto(`/marketing?tab=tablero&mes=${mes}`);
                await page.waitForTimeout(3000);
            }
        }
        fs.writeFileSync(INFORME, JSON.stringify(informe, null, 1));
        expect(informe.length, 'había fichas pero ninguna abrió su pieza').toBeGreaterThan(0);
    });
});
