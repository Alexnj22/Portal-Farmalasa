import { test } from '@playwright/test';
import fs from 'node:fs';

// Barrido de horas: ¿alguna pantalla pinta una hora en 24 horas?
//
// Regla del usuario (23 y 24-sep): «en todo el portal se trabaja en 12 horas y
// no en 24». `npm run gate:hora` lee el fuente; esto lee lo PINTADO, que es lo
// único que no se puede discutir: una hora que llega cruda de la base, o que
// se arma con el idioma del navegador, no la ve un grep.
//
// El navegador va en `es-ES` A PROPÓSITO: es un idioma de 24 horas. Todo lo que
// todavía dependa del idioma del navegador (`toLocaleTimeString([])`,
// `toLocaleString()` sin idioma) sale acá en 24 horas y se caza; con el idioma
// del equipo de quien prueba («es-SV», 12 horas) pasaría en verde.
//
// Recorre las rutas y sus pestañas, barre el texto visible más `title`,
// `aria-label` y `placeholder`, y escribe `barridos/horas-12.json`.
//
// Uso:  E2E_USER=… E2E_PASSWORD=… npx playwright test tests/e2e/horas-12.spec.js --project=chromium
//       RUTAS=cortes,caja  para acotar.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map((r) => r.trim()) : [
    'inicio', 'ventas', 'cortes', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'cotizaciones', 'conteo-inventario',
    'libro-compras-completo', 'libros-iva', 'resumen-fiscal', 'corte-z', 'ventas-perdidas',
    'personal', 'monitor', 'auditoria-de-tiempos', 'horarios', 'nomina', 'solicitudes',
    'vacaciones', 'avisos', 'encuesta', 'metas', 'sucursales', 'laboratorios', 'cargos',
    'permisos', 'actualizacion-de-datos', 'solicitudes-personales', 'mis-documentos',
    'mis-avisos', 'mi-perfil', 'bitacoras', 'cargar-compra', 'carnes-del-dia',
    'cierre-periodo', 'cuentas-por-pagar', 'encuesta-admin', 'facturas-sala',
    'gestion-stock', 'impresion', 'inventario', 'mantenimiento', 'objetos-huerfanos',
    'sesiones', 'traslados', 'auditoria-del-sistema', 'solicitudes-datos', 'bolsas',
    'caja', 'mis-puntos', 'notificaciones',
];

// Lo que se busca: H:MM o HH:MM (con segundos o no) que NO lleve a. m./p. m.
// detrás. Se corre en el navegador, así que va como texto.
const BUSCAR = String.raw`(^|[^\d:.,$])((?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)(?![\d:])(?!\s*(?:[ap]\.?\s?m\b|[ap]\.\s?m\.|[AP]\.?\s?M\b))`;

test.use({ locale: 'es-ES', timezoneId: 'America/El_Salvador' });

test('ninguna hora en 24 horas', async ({ page }) => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');
    test.setTimeout(Number(process.env.TIMEOUT_MS) || 2_400_000);

    await page.goto('/login');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // Sin sesión se mediría el login N veces y saldría todo en cero.
    if (/\/login/.test(page.url())) throw new Error('No se pudo iniciar sesión.');

    const medir = () => page.evaluate((fuente) => {
        const re = new RegExp(fuente, 'g');
        const out = [];
        const mirar = (texto, donde) => {
            for (const m of String(texto || '').matchAll(re)) {
                const i = m.index + m[1].length;
                out.push({ hora: m[2], donde, contexto: texto.slice(Math.max(0, i - 40), i + 30).replace(/\s+/g, ' ') });
            }
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        // Texto por elemento (no por nodo suelto): «13» y «:06» pueden venir en
        // dos nodos del mismo renglón.
        const vistos = new Set();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || vistos.has(el) || el.closest('script,style,input,textarea')) continue;
            vistos.add(el);
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            mirar(el.textContent, el.tagName.toLowerCase());
        }
        for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
            for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) mirar(el.getAttribute(a), `@${a}`);
        }
        return out;
    }, BUSCAR);

    const hallazgos = [];
    const anotar = (ruta, pestana, lista) => {
        const unicos = new Map();
        for (const h of lista) unicos.set(h.contexto, h);
        for (const h of unicos.values()) hallazgos.push({ ruta, pestana, ...h });
    };

    for (const ruta of RUTAS) {
        try {
            await page.goto(`/${ruta}`);
            await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
            await page.waitForTimeout(2500);
            anotar(ruta, null, await medir());
            const pestanas = page.locator('[role="tab"]');
            const n = Math.min(await pestanas.count(), 12);
            for (let i = 1; i < n; i++) {
                const t = pestanas.nth(i);
                const nombre = (await t.innerText().catch(() => '')).trim().slice(0, 40);
                await t.click({ timeout: 5000 }).catch(() => {});
                await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(1500);
                anotar(ruta, nombre || i, await medir());
            }
        } catch (e) {
            hallazgos.push({ ruta, error: String(e?.message || e).slice(0, 200) });
        }
    }

    fs.mkdirSync('barridos', { recursive: true });
    fs.writeFileSync('barridos/horas-12.json', JSON.stringify({ rutas: RUTAS.length, hallazgos }, null, 2));
    console.log(`horas-12: ${hallazgos.length} hallazgo(s) en ${RUTAS.length} rutas → barridos/horas-12.json`);
});
