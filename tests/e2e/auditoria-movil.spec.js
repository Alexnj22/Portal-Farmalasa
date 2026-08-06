import { test, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR } from './medicion-movil.js';

// Auditoría móvil (PLAN-MOBILE-2026-07 fases 3-5). MIDE, no opina.
//
// Corre en **WebKit iPhone 13** porque el reporte original vino de ahí y porque
// los bugs de layout móvil de este proyecto han sido WebKit-only más de una vez
// (memoria `feedback_webkit_only_bugs_need_webkit`). Chromium móvil emula el
// tamaño, no el motor.
//
// Agrupa por PATRÓN y no por vista, a propósito: el objetivo no es parchear
// pantallas sino encontrar qué formas hay que volver canónicas para que se
// arreglen todas de una vez. Una vista con desborde es un bug; catorce vistas
// con el mismo desborde es una forma que falta.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const SALIDA = 'test-results/auditoria-movil';

// Las que el personal usa en tienda primero, que es el orden que pide la fase 4.
const VISTAS = [
    { id: 'inicio',      url: '/' },
    { id: 'solicitudes', url: '/my-requests' },
    { id: 'monitor',     url: '/monitor' },
    { id: 'pedidos',     url: '/pedidos' },
    { id: 'productos',   url: '/productos' },
    { id: 'ventas',      url: '/ventas' },
    { id: 'personal',    url: '/staff' },
    { id: 'asistencia',  url: '/audit' },
];

test.use({ ...devices['iPhone 13'] });

const entrar = async (page) => {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
};

// Todo lo que se mide, en una sola pasada por el DOM pintado.
// El instrumento vive en `medicion-movil.js`: lo comparte con la matriz de la
// fase 5 (`matriz.spec.js`). Dos medidores separados que se van desincronizando
// es el modo de fallar que este proyecto ya conoce.

// ── Las áreas seguras, medidas de verdad ──────────────────────────────────
// Un emulador no tiene notch: `env(safe-area-inset-*)` resuelve a 0 en
// Playwright, así que `px-4` y `pl-[max(1rem,var(--sa-left))]` se ven
// IDÉNTICOS en toda captura y en todo `getComputedStyle`. Por eso este punto
// del plan llevaba un año sin poder verificarse: no había forma de distinguir
// el shell que respeta el notch del que lo ignora.
//
// Desde que los cuatro insets pasan por un token (`--sa-*`, index.css), sí la
// hay: se pisa el token en `:root` con el inset real de un iPhone 13 acostado
// y se mide si el chrome se corrió. Lo que no responde, no respeta el notch.
const INSETS = { top: 47, right: 47, bottom: 34, left: 47 };

const SONDAS = [
    { id: 'header · barra',    sel: '[data-shell="header-movil"]',      props: ['paddingTop'] },
    { id: 'header · fila',     sel: '[data-shell="header-movil-fila"]', props: ['paddingLeft', 'paddingRight'] },
    { id: 'tabs inferiores',   sel: '[data-shell="tabs-movil"]',        props: ['paddingLeft', 'paddingRight', 'paddingBottom'] },
    { id: 'contenido',         sel: '#main-scroll',                     props: ['paddingLeft', 'paddingRight', 'paddingBottom'] },
    { id: 'menú lateral',      sel: 'aside',                            props: ['left', 'marginTop', 'marginBottom'] },
];

const MEDIR_SONDAS = (sondas) => sondas.map(s => {
    const el = document.querySelector(s.sel);
    if (!el) return { id: s.id, ausente: true };
    const cs = getComputedStyle(el);
    const v = {};
    s.props.forEach(p => { v[p] = cs[p]; });
    return { id: s.id, v };
});

test.describe('Auditoría móvil · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('barrido de las ocho vistas de tienda', async ({ page }) => {
        test.setTimeout(300_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        await entrar(page);

        const informe = [];
        for (const v of VISTAS) {
            await page.goto(v.url);
            await page.waitForTimeout(3500);
            const m = await page.evaluate(MEDIR);
            informe.push({ vista: v.id, ...m });
            await page.screenshot({ path: `${SALIDA}/${v.id}.png` });

            console.log(`\n══ ${v.id}  (viewport ${m.vw}px) ══`);
            console.log(`   scroll horizontal de la PÁGINA: ${m.desbordePagina}px ${m.desbordePagina > 0 ? '← BUG' : 'ok'}`);
            console.log(`   overscroll-behavior de #main-scroll: ${m.overscroll}`);
            console.log(`   elementos que se salen: ${m.totales.desbordan}`);
            m.desbordan.forEach(d => console.log(`      +${d.sobra}px  ${d.sel}   recorta: ${d.recorte}`));
            console.log(`   blancos táctiles <44pt: ${m.totales.chicos}`);
            m.chicos.slice(0, 6).forEach(c => console.log(`      ${c.tam}  ${c.sel}  «${c.texto}»`));
            console.log(`   inputs que hacen zoom en iOS (<16px): ${m.totales.zoomIOS}`);
            m.zoomIOS.slice(0, 4).forEach(z => console.log(`      ${z.fontSize}px  ${z.sel}`));
            console.log(`   tocables sin estado active: ${m.totales.sinAcuse}   (destello: ${m.sinAcuse[0]?.destello ?? '—'})`);
            m.sinAcuse.slice(0, 4).forEach(a => console.log(`      ${a.sel}  «${a.texto}»`));
            if (m.totales.encadenan) console.log(`   scroll encadenado en diálogos: ${m.encadenan.map(e => e.sel).join(', ')}`);
            if (m.tablas.length) console.log(`   tablas sin carril: ${m.tablas.map(t => `${t.sel} (${t.ancho}px)`).join(', ')}`);
        }

        fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify(informe, null, 1));

        // ── El resumen que decide qué canónicos hacen falta ──────────────────
        const suma = (k) => informe.reduce((s, v) => s + v.totales[k], 0);
        console.log(`\n\n╔══ RESUMEN — qué forma falta, no qué vista ══╗`);
        console.log(`  vistas con scroll horizontal de página: ${informe.filter(v => v.desbordePagina > 0).map(v => v.vista).join(', ') || 'ninguna'}`);
        console.log(`  elementos desbordados (total):          ${suma('desbordan')}`);
        console.log(`  blancos táctiles <44pt (total):         ${suma('chicos')}`);
        console.log(`  inputs con zoom de iOS (total):         ${suma('zoomIOS')}`);
        console.log(`  tablas sin carril:                      ${informe.reduce((s, v) => s + v.tablas.length, 0)}`);

        // Los repetidos: si el mismo selector aparece en varias vistas, es una FORMA
        const porSel = {};
        informe.forEach(v => v.chicos.forEach(c => {
            (porSel[c.sel] ||= new Set()).add(v.vista);
        }));
        const formas = Object.entries(porSel).filter(([, s]) => s.size > 1)
            .sort((a, b) => b[1].size - a[1].size);
        console.log(`\n  Blancos chicos que se repiten en VARIAS vistas → son una forma, no un bug suelto:`);
        formas.slice(0, 10).forEach(([s, v]) => console.log(`     ${v.size} vistas · ${s}`));
        console.log(`╚════════════════════════════════════════════╝`);
    });

    test('áreas seguras · el shell frente a un notch simulado', async ({ page }) => {
        test.setTimeout(120_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        await entrar(page);
        await page.goto('/');
        await page.waitForTimeout(3500);

        // Sin notch: es el estado que ve cualquier captura, y el que NO debe
        // cambiar con este trabajo (un teléfono sin isla no gana relleno).
        const antes = await page.evaluate(MEDIR_SONDAS, SONDAS);
        const desbordeAntes = await page.evaluate(() => Math.max(
            document.documentElement.scrollWidth - document.documentElement.clientWidth, 0));

        await page.evaluate((ins) => {
            const r = document.documentElement.style;
            r.setProperty('--sa-top', `${ins.top}px`);
            r.setProperty('--sa-right', `${ins.right}px`);
            r.setProperty('--sa-bottom', `${ins.bottom}px`);
            r.setProperty('--sa-left', `${ins.left}px`);
        }, INSETS);
        await page.waitForTimeout(400);

        const despues = await page.evaluate(MEDIR_SONDAS, SONDAS);
        const desbordeDespues = await page.evaluate(() => Math.max(
            document.documentElement.scrollWidth - document.documentElement.clientWidth, 0));
        await page.screenshot({ path: `${SALIDA}/areas-seguras-notch.png` });

        console.log(`\n╔══ ÁREAS SEGURAS — insets simulados ${JSON.stringify(INSETS)} ══╗`);
        antes.forEach((a, i) => {
            const d = despues[i];
            if (a.ausente) { console.log(`  ${a.id.padEnd(18)} (no está en esta vista)`); return; }
            const partes = Object.keys(a.v).map(p => {
                const responde = a.v[p] !== d.v[p];
                return `${p}: ${a.v[p]} → ${d.v[p]} ${responde ? '✓' : '← NO RESPONDE'}`;
            });
            console.log(`  ${a.id.padEnd(18)} ${partes.join('   ')}`);
        });
        console.log(`  scroll horizontal de la página: ${desbordeAntes}px → ${desbordeDespues}px ${desbordeDespues > 0 ? '← el relleno del notch DESBORDA' : 'ok'}`);
        console.log(`╚════════════════════════════════════════════╝`);

        fs.writeFileSync(`${SALIDA}/areas-seguras.json`,
            JSON.stringify({ insets: INSETS, antes, despues, desbordeAntes, desbordeDespues }, null, 1));
    });

    // ── Fase 4.3 · la búsqueda con el teclado arriba ──────────────────────
    //
    // El punto del plan decía «verificar que el modo búsqueda DESLIZANTE de
    // `ViewTabBar` funciona con el teclado móvil abierto». Al medirlo resultó
    // que en el teléfono **ese modo no se ofrece**: `ViewTabBar` calcula
    // `mostrarLupa = showSearch && !hayBarraFlotante`, o sea que cuando la
    // vista dibuja la barra flotante táctil le **cede** la búsqueda y esconde
    // su propia lupa. En un iPhone 13 la lupa del encabezado no existe; la que
    // se toca está en la barra de abajo, que es donde está el pulgar.
    //
    // Entonces se verifican las dos, cada una donde vive: la de la barra en el
    // teléfono, y la deslizante a ancho de escritorio.
    //
    // ⚠️ El teclado NO se puede emular de verdad. En iOS no achica el viewport
    // de LAYOUT: encoge el VISUAL y desplaza, y Playwright no expone el visual
    // por separado. Achicar el de layout —lo que hace este test— modela el
    // comportamiento de Android (`resizes-content`), no el de iOS. Sirve para
    // la pregunta concreta —¿el campo queda dentro de lo que se ve, o lo tapa
    // algo fijo?— y no para más. Queda escrito para que nadie lea este test
    // como una prueba de iOS.
    const ALTO_TECLADO = 336;

    const VISTAS_CON_BUSCADOR = [
        { id: 'monitor',    url: '/monitor' },
        { id: 'personal',   url: '/staff' },
        { id: 'asistencia', url: '/audit' },
    ];

    // Qué se mide del campo activo, sea cual sea la pieza que lo dibuja.
    const MEDIR_CAMPO = () => {
        const vw = document.documentElement.clientWidth;
        const caja = (el) => { const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top),
                     w: Math.round(r.width), h: Math.round(r.height) }; };
        // El campo ACTIVO, no «el primer input del documento»: las dos piezas
        // dejan su campo montado y colapsado, así que buscar por selector
        // devolvía uno de 0×0 y la medición salía toda en cero.
        const campo = document.activeElement?.tagName === 'INPUT' ? document.activeElement : null;
        if (!campo) return { campo: null };
        const r = campo.getBoundingClientRect();
        // ¿Algo FIJO se le superpone? Es lo que tapa un campo cuando el teclado
        // sube y un elemento pegado al borde inferior se queda donde estaba.
        //
        // Solaparse NO es tapar: un velo `fixed inset-0` decorativo cubre la
        // pantalla entera por definición y con `pointer-events: none` no
        // estorba a nadie. La primera versión los contaba igual y reportaba dos
        // «tapan el campo» en las tres vistas — el mismo error de siempre, medir
        // la geometría en vez del efecto. El juez es `elementFromPoint` sobre el
        // centro del campo: si lo que hay ahí es el campo, nada lo tapa.
        const tapan = [];
        document.querySelectorAll('*').forEach(el => {
            if (el === campo || el.contains(campo)) return;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
            if (cs.visibility === 'hidden' || cs.opacity === '0') return;
            if (cs.pointerEvents === 'none') return;
            const q = el.getBoundingClientRect();
            if (!q.width || !q.height) return;
            if (q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) {
                tapan.push(`${el.tagName.toLowerCase()}.${(el.className?.toString?.()||'').split(/\s+/).slice(0,2).join('.')}`);
            }
        });
        const enElCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const alcanzable = !!enElCentro && (enElCentro === campo || campo.contains(enElCentro) || enElCentro.contains(campo));
        const aspa = document.querySelector('button[aria-label="Cerrar el buscador"], button[aria-label="Borrar la búsqueda"]');
        return {
            vw, vh: window.innerHeight,
            campo: { ...caja(campo), fuente: parseFloat(getComputedStyle(campo).fontSize),
                     valor: campo.value,
                     dentro: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1 },
            aspa: aspa && aspa.getBoundingClientRect().width ? caja(aspa) : null,
            tapan: [...new Set(tapan)].slice(0, 4),
            alcanzable,
            enElCentro: enElCentro ? `${enElCentro.tagName.toLowerCase()}.${(enElCentro.className?.toString?.()||'').split(/\s+/).slice(0,2).join('.')}` : null,
        };
    };

    test('la búsqueda del teléfono, abierta y con el teclado', async ({ page }) => {
        test.setTimeout(240_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        await entrar(page);

        const informe = [];
        for (const v of VISTAS_CON_BUSCADOR) {
            await page.goto(v.url);
            await page.waitForTimeout(3500);

            // ¿Ofrece el encabezado su lupa deslizante en el teléfono?
            const lupaEncabezado = await page.evaluate(() => {
                const b = [...document.querySelectorAll('button[aria-label="Buscar"]')]
                    .find(el => el.getBoundingClientRect().top < 200);
                return !!b;
            });

            const lupa = page.locator('button[aria-label="Buscar"]').first();
            if (!(await lupa.count())) { informe.push({ vista: v.id, sinBuscador: true }); continue; }
            await lupa.click();
            await page.waitForTimeout(800);
            await page.keyboard.type('lop');
            await page.waitForTimeout(700);

            const m = await page.evaluate(MEDIR_CAMPO);

            // El teclado, aproximado (ver la nota de arriba)
            await page.setViewportSize({ width: 390, height: 844 - ALTO_TECLADO });
            await page.waitForTimeout(700);
            const conTeclado = await page.evaluate(MEDIR_CAMPO);
            await page.screenshot({ path: `${SALIDA}/buscador-${v.id}.png` });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForTimeout(400);

            informe.push({ vista: v.id, lupaEncabezado, ...m, conTeclado });

            console.log(`\n══ búsqueda · ${v.id} ══`);
            console.log(`   lupa deslizante en el encabezado: ${lupaEncabezado ? 'sí' : 'NO — la cede a la barra flotante'}`);
            if (!m.campo) { console.log('   ningún campo tomó el foco ← REVISAR'); continue; }
            console.log(`   campo ${m.campo.w}×${m.campo.h} en (${m.campo.x},${m.campo.y}) · fuente ${m.campo.fuente}px`
                      + ` ${m.campo.fuente >= 16 ? '(sin zoom de iOS)' : '← iOS HACE ZOOM'}`);
            console.log(`   escribió «${m.campo.valor}» · dentro del viewport: ${m.campo.dentro ? 'sí' : 'NO'}`);
            if (m.aspa) console.log(`   aspa ${m.aspa.w}×${m.aspa.h} ${m.aspa.w >= 44 && m.aspa.h >= 44 ? 'ok' : '← bajo 44pt'}`);
            console.log(`   con el teclado (alto útil ${conTeclado.vh}px): el campo ${conTeclado.campo?.dentro ? 'queda a la vista' : 'QUEDA FUERA'}`
                      + (conTeclado.campo ? ` (y=${conTeclado.campo.y})` : ' — perdió el foco'));
            console.log(`   el dedo cae sobre: ${m.enElCentro} ${m.alcanzable ? '→ el campo, alcanzable' : '← ALGO LO TAPA'}`);
            console.log(`   fijos que capturan el puntero y se le superponen: ${m.tapan.length ? m.tapan.join(', ') : 'ninguno'}`);
        }

        fs.writeFileSync(`${SALIDA}/buscador.json`, JSON.stringify(informe, null, 1));
    });

    test('el deslizante del encabezado, donde SÍ se usa (ancho de escritorio)', async ({ page }) => {
        test.setTimeout(120_000);
        await entrar(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/monitor');
        await page.waitForTimeout(4000);

        const lupa = page.locator('button[aria-label="Buscar"]').first();
        const hay = await lupa.count();
        console.log(`\n══ deslizante · escritorio 1440 ══`);
        console.log(`   lupa del encabezado: ${hay ? 'sí' : 'NO'}`);
        if (!hay) return;
        await lupa.click();
        await page.waitForTimeout(700);
        await page.keyboard.type('lop');
        await page.waitForTimeout(600);
        const m = await page.evaluate(MEDIR_CAMPO);
        console.log(`   campo ${m.campo?.w}×${m.campo?.h} en (${m.campo?.x},${m.campo?.y}) · escribió «${m.campo?.valor}»`);
        console.log(`   dentro del viewport: ${m.campo?.dentro ? 'sí' : 'NO'} · aspa ${m.aspa ? `${m.aspa.w}×${m.aspa.h}` : 'ausente'}`);
        await page.screenshot({ path: `${SALIDA}/deslizante-escritorio.png` });
        await page.setViewportSize({ width: 390, height: 844 });
    });
});
