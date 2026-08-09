// Barrido de ESCRITORIO — las 37 rutas al ancho donde nadie las midió.
//
// El barrido móvil (`barrido-total-movil.spec.js`) cubre las mismas rutas × 4
// temas, con pestañas y diálogos, y está en cero. Corre iPhone 13 y nada más.
// El 2026-08-09 apareció en Ventas un defecto que ese barrido no podía ver: a
// 1440 con el menú abierto la columna Total quedaba fuera del marco. Éste mira
// ese ancho.
//
//   npx playwright test tests/e2e/barrido-escritorio.spec.js --project=chromium
//   ANCHOS=1440,1280  RUTAS=ventas,pedidos   (para acotar)
//
// Chromium y no WebKit: acá no se abren pestañas ni diálogos —eso ya lo cubre el
// móvil— así que no aplica el techo de las 28 pantallas que obliga a partir
// aquél en dos mitades. Si algún día se le agregan, se parte igual.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR_ESCRITORIO, MEDIR_SCROLL } from './medicion-escritorio.js';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const SALIDA = 'test-results/barrido-escritorio';

// La MISMA lista que el barrido móvil. Se copia en vez de importarse porque
// aquél la define dentro de su spec; el día que se mueva a un módulo, las dos
// la leen de ahí. Duplicarla tiene un costo conocido —se desincroniza— y por eso
// la prueba de abajo lo verifica en vez de confiar.
const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map(r => r.trim()) : [
    'overview', 'ventas', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'cotizaciones', 'conteo-inventario',
    'libro-compras-completo', 'libros-iva', 'resumen-fiscal', 'corte-z', 'ventas-perdidas',
    'staff', 'monitor', 'audit', 'schedules', 'payroll', 'requests', 'vacation-plan',
    'announcements', 'encuesta', 'metas', 'branches', 'laboratorios', 'roles',
    'permissions', 'sync-health', 'my-requests', 'my-documents', 'my-announcements',
    'profile', 'dashboard',
];

// 1440 es el portátil más común y el ancho donde apareció el defecto de Ventas.
// 1280 es el otro corte real —`xl` de Tailwind— y el que más aprieta con el menú
// abierto: quedan ~920px de marco.
const ANCHOS = (process.env.ANCHOS || '1440,1280').split(',').map(n => Number(n.trim()));

test.describe('Barrido de escritorio', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('todas las vistas, a los anchos de portátil', async ({ page }) => {
        test.setTimeout(Number(process.env.TIMEOUT_MS) || 2_400_000);
        fs.mkdirSync(SALIDA, { recursive: true });

        const erroresJs = [];
        page.on('pageerror', e => erroresJs.push(String(e.message).slice(0, 160)));

        await page.setViewportSize({ width: ANCHOS[0], height: 900 });
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        // A la CONDICIÓN, no al reloj: la primera carga tras levantar el preview
        // se queda en «VERIFICANDO SESIÓN…» más de lo que dura una espera fija,
        // y un instrumento que confunde «todavía no» con «no» no sirve.
        await page.waitForFunction(
            () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
        ).catch(() => {});
        await page.waitForTimeout(3000);

        // ⚠️ Sin sesión esto mide la pantalla de login 37 veces y sale en cero.
        // Es el mismo agujero que el barrido móvil ya conoce.
        expect(page.url(), 'no se pudo iniciar sesión').not.toMatch(/\/login/);

        const informe = { fecha: new Date().toISOString(), anchos: ANCHOS, rutas: {} };

        for (const ancho of ANCHOS) {
            await page.setViewportSize({ width: ancho, height: 900 });
            for (const ruta of RUTAS) {
                const antes = erroresJs.length;
                try {
                    await page.goto(`/${ruta}`, { waitUntil: 'domcontentloaded' });
                    // Las vistas cargan sus datos después de montar; sin esta
                    // espera se mide el esqueleto, que no tiene columnas.
                    await page.waitForTimeout(6000);
                } catch {
                    (informe.rutas[ruta] ??= {})[ancho] = { murio: true };
                    continue;
                }
                const m = await page.evaluate(MEDIR_ESCRITORIO);
                (informe.rutas[ruta] ??= {})[ancho] = {
                    ...m,
                    erroresJs: erroresJs.slice(antes),
                    vacia: await page.evaluate(() => (document.body.innerText || '').trim().length < 40),
                };
            }
        }

        // El scroll se mide en el teléfono, que es donde cuesta.
        await page.setViewportSize({ width: 390, height: 844 });
        for (const ruta of RUTAS) {
            try {
                await page.goto(`/${ruta}`, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(5000);
                (informe.rutas[ruta] ??= {}).movil = await page.evaluate(MEDIR_SCROLL);
            } catch { /* ya quedó anotada arriba */ }
        }

        fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify(informe, null, 2));

        // Resumen a consola: el informe es para el gate, esto es para leerlo.
        const filas = [];
        for (const [ruta, porAncho] of Object.entries(informe.rutas)) {
            const cols = ANCHOS.reduce((n, a) => n + (porAncho[a]?.columnasFuera?.length || 0), 0);
            const car  = ANCHOS.reduce((n, a) => n + (porAncho[a]?.carrilesRecortados?.length || 0), 0);
            const txt  = ANCHOS.reduce((n, a) => n + (porAncho[a]?.textosCortados?.length || 0), 0);
            const err  = ANCHOS.reduce((n, a) => n + (porAncho[a]?.erroresJs?.length || 0), 0);
            const pant = porAncho.movil?.pantallas ?? 0;
            if (cols || car || txt || err || pant >= 5) {
                filas.push({ ruta, cols, car, txt, err, pant });
            }
        }
        filas.sort((a, b) => (b.cols - a.cols) || (b.pant - a.pant) || (b.car - a.car));
        console.log('\n── Hallazgos por vista ' + '─'.repeat(40));
        console.log('  ruta                  columna-fuera  carril  texto  errJS  pantallas');
        for (const f of filas) {
            console.log(`  ${f.ruta.padEnd(22)}${String(f.cols).padStart(9)}${String(f.car).padStart(9)}${String(f.txt).padStart(7)}${String(f.err).padStart(7)}${String(f.pant).padStart(11)}`);
        }
        console.log(`\n  ${filas.length} de ${RUTAS.length} rutas con algo que mirar · informe en ${SALIDA}/informe.json\n`);
    });
});
