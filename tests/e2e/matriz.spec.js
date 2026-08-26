import { test, webkit, chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR } from './medicion-movil.js';

// ── Matriz de verificación final · PLAN-MOBILE-2026-07 fase 5 ─────────────
//
// Cinco perfiles × siete escenarios, con el MISMO instrumento que el barrido de
// vistas (`medicion-movil.js`). Ese "mismo" es el punto: el barrido responde
// «¿está bien esta vista en un iPhone?» y la matriz «¿está bien el portal en
// los aparatos con los que se entra?», y si cada uno midiera a su manera los
// dos números no se podrían comparar.
//
// Lanza los navegadores a mano en vez de usar `projects`: un `project` fija UN
// dispositivo para todo el archivo, y acá el archivo ES la comparación entre
// dispositivos. Por eso el nombre no lleva `movil` — así el project
// `webkit-movil` (testMatch /movil\.spec\.js/) no lo toma también.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const BASE = process.env.E2E_BASE_URL || 'http://localhost:4174';
const SALIDA = 'test-results/matriz-movil';

// iPad Mini vertical entra a propósito: mide 768px, o sea que cae del lado
// MÓVIL del corte de este portal (`lg` = 1024px) aunque sea una tablet. Es el
// aparato donde un layout pensado "para teléfono o para escritorio" se rompe.
const PERFILES = [
    { id: 'iphone13-vertical',   motor: webkit,   ctx: { ...devices['iPhone 13'] } },
    { id: 'iphone13-horizontal', motor: webkit,   ctx: { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } } },
    { id: 'ipad-mini',           motor: webkit,   ctx: { ...devices['iPad Mini'] } },
    { id: 'android-412',         motor: chromium, ctx: { ...devices['Pixel 5'], viewport: { width: 412, height: 915 } } },
    { id: 'escritorio-1440',     motor: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
];

const abrirMenu = async (page, esMovil) => {
    if (!esMovil) return 'el menú lateral está siempre a la vista';
    // Por el gancho del shell y no por el `aria-label` del ícono: el nombre
    // accesible lo pone un mapa del componente `Button` y cambiar ese mapa no
    // debería romper esta matriz.
    const b = page.locator('[data-shell="header-movil-fila"] button').first();
    if (!(await b.count())) return 'no hay hamburguesa';
    await b.click();
    await page.waitForTimeout(900);
    return 'cajón abierto';
};

const abrirModal = async (page) => {
    // ⌘K / Ctrl+K abre el buscador del menú, que es el único modal que se
    // alcanza igual en los cinco perfiles sin depender del contenido de una
    // vista.
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(900);
    if (await page.locator('[role="dialog"]').count()) return 'con ⌘K';
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(900);
    return await page.locator('[role="dialog"]').count() ? 'con Ctrl+K' : 'NO ABRIÓ';
};

const ESCENARIOS = [
    { id: 'login',       url: '/login', sinSesion: true },
    { id: 'tablero',     url: '/inicio' },
    { id: 'ventas',      url: '/ventas' },
    { id: 'solicitudes', url: '/solicitudes-personales' },
    { id: 'pedidos',     url: '/pedidos' },
    { id: 'menu',        url: '/inicio', accion: abrirMenu },
    { id: 'modal',       url: '/inicio', accion: abrirModal },
];

test.describe('Matriz de verificación final · fase 5', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('cinco perfiles × siete escenarios', async () => {
        test.setTimeout(900_000);
        fs.mkdirSync(SALIDA, { recursive: true });

        const filas = [];
        for (const perfil of PERFILES) {
            const navegador = await perfil.motor.launch();
            const contexto = await navegador.newContext(perfil.ctx);
            const page = await contexto.newPage();
            const ancho = perfil.ctx.viewport.width;
            const esMovil = ancho < 1024;

            await page.goto(`${BASE}/login`);
            await page.locator('#username').fill(E2E_USER);
            await page.locator('#password').fill(E2E_PASSWORD);
            await page.locator('button[type="submit"]').first().click();
            await page.waitForTimeout(5000);

            console.log(`\n╔══ ${perfil.id}  (${perfil.ctx.viewport.width}×${perfil.ctx.viewport.height}, ${esMovil ? 'móvil' : 'escritorio'}) ══╗`);

            for (const esc of ESCENARIOS) {
                if (esc.sinSesion) {
                    // Un contexto NUEVO, no una pestaña más: con la sesión viva
                    // `/login` redirige a la app y lo que se medía era el
                    // tablero otra vez. Se notaba en que la fila «login» daba
                    // exactamente los mismos números que «tablero» en los dos
                    // perfiles de teléfono — una coincidencia que no era tal.
                    const ctx2 = await navegador.newContext(perfil.ctx);
                    const p2 = await ctx2.newPage();
                    await p2.goto(`${BASE}/login`);
                    await p2.waitForTimeout(3000);
                    const m = await p2.evaluate(MEDIR);
                    await p2.screenshot({ path: `${SALIDA}/${perfil.id}--${esc.id}.png` });
                    await ctx2.close();
                    filas.push({ perfil: perfil.id, escenario: esc.id, tactil: m.tactil,
                                 ...m.totales, desbordePagina: m.desbordePagina,
                                 detalleChicos: m.chicos, detalleZoom: m.zoomIOS });
                    console.log(`  ${esc.id.padEnd(12)} desbordePágina ${String(m.desbordePagina).padStart(3)}px · se salen ${String(m.totales.desbordan).padStart(2)} · táctil<44 ${String(m.totales.chicos).padStart(2)} · zoom iOS ${m.totales.zoomIOS}`);
                    continue;
                }
                await page.goto(BASE + esc.url);
                await page.waitForTimeout(3800);
                let nota = '';
                if (esc.accion) nota = await esc.accion(page, esMovil);

                const m = await page.evaluate(MEDIR);
                await page.screenshot({ path: `${SALIDA}/${perfil.id}--${esc.id}.png` });
                filas.push({ perfil: perfil.id, escenario: esc.id, nota, tactil: m.tactil,
                             ...m.totales, desbordePagina: m.desbordePagina,
                             detalleChicos: m.chicos, detalleZoom: m.zoomIOS, detalleEncadenan: m.encadenan });
                console.log(`  ${esc.id.padEnd(12)} desbordePágina ${String(m.desbordePagina).padStart(3)}px · se salen ${String(m.totales.desbordan).padStart(2)}`
                          + ` · táctil<44 ${String(m.totales.chicos).padStart(2)} · zoom iOS ${m.totales.zoomIOS}`
                          + ` · encadenan ${m.totales.encadenan}${nota ? `  (${nota})` : ''}`);
                if (m.totales.desbordan) m.desbordan.slice(0, 3).forEach(d => console.log(`        +${d.sobra}px ${d.sel} · recorta ${d.recorte}`));
                if (m.totales.chicos)    m.chicos.slice(0, 3).forEach(c => console.log(`        ${c.tam} ${c.sel} «${c.texto}»`));

                // El modal se cierra para no arrastrarlo al escenario siguiente.
                if (esc.id === 'modal' || esc.id === 'menu') {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                }
            }
            await navegador.close();
        }

        fs.writeFileSync(`${SALIDA}/matriz.json`, JSON.stringify(filas, null, 1));

        // ── El veredicto, en una tabla ────────────────────────────────────
        console.log(`\n\n╔══ MATRIZ — desbordePágina / se salen / táctil<44 / zoom iOS ══╗`);
        const anchoCol = 14;
        console.log('  ' + 'escenario'.padEnd(anchoCol) + PERFILES.map(p => p.id.slice(0, 16).padEnd(18)).join(''));
        for (const esc of ESCENARIOS) {
            const celdas = PERFILES.map(p => {
                const f = filas.find(x => x.perfil === p.id && x.escenario === esc.id);
                return (f ? `${f.desbordePagina}/${f.desbordan}/${f.chicos}/${f.zoomIOS}` : '—').padEnd(18);
            });
            console.log('  ' + esc.id.padEnd(anchoCol) + celdas.join(''));
        }
        // Un blanco <44pt sólo es deuda con el DEDO: en escritorio `--tap-min`
        // vale 0 a propósito, así que ahí no se cuenta.
        const malas = filas.filter(f => f.desbordePagina > 0 || f.desbordan > 0 || f.zoomIOS > 0
                                     || f.encadenan > 0 || (f.tactil && f.chicos > 0));
        console.log(`\n  celdas con hallazgo: ${malas.length} de ${filas.length}`
                  + `   (los <44pt de escritorio NO cuentan: puntero fino, --tap-min = 0)`);
        malas.forEach(f => console.log(`     ${f.perfil} · ${f.escenario} → página ${f.desbordePagina}px · se salen ${f.desbordan}`
                                     + ` · táctil<44 ${f.tactil ? f.chicos : 'n/a'} · zoom ${f.zoomIOS} · encadenan ${f.encadenan}`));

        // Lo que hay que arreglar, agrupado por FORMA y no por celda: si el
        // mismo control aparece en varios perfiles es uno solo, no cinco.
        const porForma = {};
        filas.filter(f => f.tactil).forEach(f => (f.detalleChicos || []).forEach(c => {
            (porForma[`${c.sel} «${c.texto}» ${c.tam}`] ||= new Set()).add(`${f.perfil}/${f.escenario}`);
        }));
        console.log(`\n  Blancos <44pt en perfiles táctiles, por forma:`);
        Object.entries(porForma).sort((a, b) => b[1].size - a[1].size)
            .forEach(([k, v]) => console.log(`     ${String(v.size).padStart(2)} celdas · ${k}`));

        const zoom = {};
        filas.forEach(f => (f.detalleZoom || []).forEach(z => {
            (zoom[`${z.sel} (${z.fontSize}px)`] ||= new Set()).add(`${f.perfil}/${f.escenario}`);
        }));
        if (Object.keys(zoom).length) {
            console.log(`\n  Inputs que hacen zoom en iOS (<16px):`);
            Object.entries(zoom).forEach(([k, v]) => console.log(`     ${v.size} celdas · ${k}`));
        }

        const enc = {};
        filas.forEach(f => (f.detalleEncadenan || []).forEach(e => {
            (enc[e.sel] ||= new Set()).add(`${f.perfil}/${f.escenario}`);
        }));
        if (Object.keys(enc).length) {
            console.log(`\n  Scroll encadenado dentro de diálogos (sin overscroll-contain):`);
            Object.entries(enc).forEach(([k, v]) => console.log(`     ${v.size} celdas · ${k}`));
        }
        console.log(`╚═══════════════════════════════════════════════════════════════╝`);
    });
});
