import { test, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR } from './medicion-movil.js';

// Barrido de TODAS las vistas del portal en el teléfono, no de las ocho de
// tienda. El objetivo ya no es encontrar la forma que falta —eso lo hizo el
// barrido de la fase 4— sino saber en cuáles se ve mal, y con qué.
//
// Agrega dos medidas que el instrumento de fases no tenía y que son las que
// deciden el trabajo de hoy:
//   · ¿la vista quedó en TABLA en el teléfono? (o sea, `DataTable` cayó a la
//     tabla y hay que ver por qué)
//   · ¿hay tablas que además desbordan FUERA de un carril?
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const SALIDA = 'test-results/barrido-total';

const RUTAS = [
    'overview', 'ventas', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'cotizaciones', 'conteo-inventario',
    'libro-compras-completo', 'libros-iva', 'resumen-fiscal', 'corte-z', 'ventas-perdidas',
    'staff', 'monitor', 'audit', 'schedules', 'payroll', 'requests', 'vacation-plan',
    'announcements', 'encuesta', 'metas', 'branches', 'laboratorios', 'roles',
    'permissions', 'sync-health', 'my-requests', 'my-documents', 'my-announcements',
    'profile', 'dashboard',
];

test.use({ ...devices['iPhone 13'] });

test.describe('Barrido total · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('todas las vistas', async ({ page }) => {
        test.setTimeout(900_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(6000);

        // Una vista que REVIENTA mide exactamente igual que una vista vacía:
        // cero fichas, cero tablas, cero desborde. Proveedores estuvo así y el
        // barrido la listaba con un punto al lado, como si estuviera bien.
        const errores = [];
        page.on('pageerror', e => errores.push(e.message.slice(0, 200)));

        const informe = [];
        for (const ruta of RUTAS) {
            errores.length = 0;
            await page.goto('/' + ruta).catch(() => {});
            // Esperar a que se vaya el esqueleto: medir durante la carga da
            // «cayó a la tabla» donde no es cierto (lección de v2.460.1).
            await page.waitForTimeout(6500);
            const m = await page.evaluate(MEDIR).catch(() => null);
            if (!m) { informe.push({ ruta, error: true }); continue; }
            const extra = await page.evaluate(() => {
                const vw = document.documentElement.clientWidth;
                const tablas = [...document.querySelectorAll('table')];
                const fichas = [...document.querySelectorAll('button[data-surface="card"], div[data-surface="card"]')]
                    .filter(e => e.firstElementChild?.classList?.contains('justify-between')).length;
                const anchas = tablas.filter(t => t.getBoundingClientRect().width > vw + 1).length;
                return { tablas: tablas.length, fichas, tablasAnchas: anchas,
                         reventó: /ALGO SALIÓ MAL/.test(document.body.innerText),
                         vacia: document.body.innerText.trim().length < 120 };
            });
            if (extra.reventó) extra.error = [...new Set(errores)].slice(0, 3);
            informe.push({ ruta, ...m.totales, desbordePagina: m.desbordePagina,
                           ...extra, grupos: m.grupos, muestraDesborde: m.desbordan.slice(0, 3) });
            // La foto entera, no el viewport: el desborde y la fila que lo causa
            // casi nunca están arriba de todo, y una foto cortada a 844px hace
            // que el hallazgo medido no se pueda ver.
            await page.screenshot({ path: `${SALIDA}/${ruta}.png`, fullPage: true });
        }
        fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify(informe, null, 1));

        const malas = informe.filter(v => v.error || v.reventó || v.desbordePagina > 0 || v.desbordan > 0 || v.tablas > 0 || v.zoomIOS > 0);
        console.log(`\n╔══ ${informe.length} vistas · con algo que corregir: ${malas.length} ══╗`);
        console.log('  ruta'.padEnd(26) + 'tablas fichas desbP salen táctil zoom');
        informe.forEach(v => {
            if (v.error) { console.log(`  ${v.ruta.padEnd(24)} (no cargó)`); return; }
            const mal = v.tablas > 0 || v.desbordePagina > 0 || v.desbordan > 0 || v.zoomIOS > 0;
            console.log(`  ${mal ? '✗' : '·'} ${v.ruta.padEnd(22)}`
                + String(v.tablas).padStart(6) + String(v.fichas).padStart(7)
                + String(v.desbordePagina).padStart(6) + String(v.desbordan).padStart(6)
                + String(v.chicos).padStart(7) + String(v.zoomIOS).padStart(5));
        });
        const rotas = informe.filter(v => v.reventó);
        console.log(`\n  REVENTADAS:               ${rotas.map(v => v.ruta).join(', ') || 'ninguna'}`);
        rotas.forEach(v => (v.error || []).forEach(e => console.log(`     ${v.ruta}: ${e}`)));
        console.log(`  con TABLA en el teléfono: ${informe.filter(v => v.tablas > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`  con desborde de página:   ${informe.filter(v => v.desbordePagina > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`  con inputs <16px:         ${informe.filter(v => v.zoomIOS > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`╚════════════════════════════════════════════╝`);
    });
});
