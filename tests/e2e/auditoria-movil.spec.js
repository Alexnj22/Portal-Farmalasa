import { test, devices } from '@playwright/test';
import fs from 'node:fs';

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
const MEDIR = () => {
    const vw = document.documentElement.clientWidth;
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const sel = (el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = (el.className?.toString?.() || '').trim().split(/\s+/).slice(0, 3).join('.');
        return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}`;
    };

    // 1 · ¿La PÁGINA scrollea de lado? Es el síntoma que originó el plan.
    const desbordePagina = Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
    );

    // 2 · Qué elementos se salen del viewport (los culpables del desborde)
    //
    // Salirse del viewport y HACER SCROLLEAR LA PÁGINA son cosas distintas, y
    // la primera versión de este bloque las mezclaba: reportaba 28 elementos en
    // ocho vistas donde el scroll horizontal de la página medía 0 en todas.
    // Un elemento se sale sin arrastrar a la página cuando algo lo RECORTA, y
    // ahí hay dos casos que no se parecen en nada:
    //
    //   · recortado a propósito — el buscador deslizante del encabezado espera
    //     fuera de cuadro hasta que se lo abre. Está bien.
    //   · recortado sin querer — contenido que existe, no se ve y no se alcanza.
    //
    // Sin nombrar al ancestro que recorta no se puede distinguir uno del otro,
    // así que se anota. Y el recorrido arranca en el propio elemento: un carril
    // con `overflow-x:auto` ES la solución, no el problema — contarlo era
    // acusar otra vez a quien hizo bien el trabajo.
    const desbordan = [];
    document.querySelectorAll('*').forEach(el => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width <= vw * 3) {
            let enCarril = false, recorte = null;
            for (let p = el; p; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (p !== el && !recorte && (s.overflowX === 'hidden' || s.overflowX === 'clip')) recorte = sel(p);
                if (s.overflowX === 'auto' || s.overflowX === 'scroll') { enCarril = true; break; }
            }
            if (!enCarril) desbordan.push({ sel: sel(el), sobra: Math.round(r.right - vw),
                                            recorte: recorte || '(nada lo recorta)' });
        }
    });

    // 3 · Blancos táctiles < 44pt (fase 3.2)
    //
    // ⚠️ Se mide el ÁREA DE IMPACTO, no la caja. Un control puede verse de 20px
    // y tocarse como uno de 44 si extiende su área con un pseudo-elemento
    // (`.blanco-tactil`), que es el patrón del portal para los controles cuyo
    // tamaño ES el diseño — la flecha del carril, el aspa del select compacto.
    // La primera versión de esta auditoría leía sólo `getBoundingClientRect()`
    // y daba por chicos a controles que ya estaban resueltos: acusaba al que
    // hizo bien el trabajo. Mismo error que el detector de `pointermove` que
    // miraba la referencia en vez del cuerpo.
    const areaEfectiva = (el) => {
        const r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        for (const p of ['::before', '::after']) {
            const cs = getComputedStyle(el, p);
            if (cs.content === 'none' || cs.position === 'static') continue;
            const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
            if (Number.isFinite(pw)) w = Math.max(w, pw);
            if (Number.isFinite(ph)) h = Math.max(h, ph);
        }
        return { w, h, caja: `${Math.round(r.width)}x${Math.round(r.height)}` };
    };
    const chicos = [];
    document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')
        .forEach(el => {
            if (!visible(el)) return;
            // Un elemento DECORATIVO no es un blanco táctil. El chevron de las
            // filas de asistencia es `aria-hidden` + `tabIndex={-1}` a
            // propósito: el control real es la fila entera, y el chevron sólo
            // dibuja el estado. Contarlo daba 49 «hallazgos» en una vista donde
            // no hay nada que tocar mal — el mismo error de medir la referencia
            // en vez del cuerpo, por tercera vez en este proyecto.
            if (el.getAttribute('aria-hidden') === 'true') return;
            // Las columnas de un gráfico tampoco son un blanco suelto: son
            // segmentos ADYACENTES que se reparten el ancho. Siete días en
            // 390px dan 40px cada uno y no pueden dar 44 sin desbordar, y
            // ampliarles el área con un pseudo las haría solaparse entre sí.
            // Se anotan como restricción medida, no como deuda.
            if (/^Día: /.test((el.getAttribute('aria-label') || '').trim())) return;
            if (el.tabIndex < 0 && !el.hasAttribute('href')) return;
            const a = areaEfectiva(el);
            if (a.w < 44 || a.h < 44) {
                chicos.push({ sel: sel(el),
                              tam: `${Math.round(a.w)}x${Math.round(a.h)} (caja ${a.caja})`,
                              texto: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) });
            }
        });

    // 4 · Inputs con fuente < 16px → iOS hace ZOOM al enfocarlos (fase 3.3)
    const zoomIOS = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
        if (!visible(el)) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) zoomIOS.push({ sel: sel(el), fontSize: fs });
    });

    // 5 · Tablas que desbordan sin carril propio (fase 4.1)
    const tablas = [];
    document.querySelectorAll('table').forEach(el => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        let enCarril = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX === 'auto' || s.overflowX === 'scroll') { enCarril = true; break; }
        }
        if (r.width > vw + 1 && !enCarril) tablas.push({ sel: sel(el), ancho: Math.round(r.width) });
    });

    // 6 · overscroll-behavior en el scroll principal (fase 3.4)
    const main = document.querySelector('#main-scroll');
    const overscroll = main ? getComputedStyle(main).overscrollBehavior : '(sin #main-scroll)';

    // 7 · El acuse de recibo del toque (fase 3.4)
    //
    // En un teléfono, `hover:` no existe: si un control no declara un estado
    // `active:`, lo único que confirma el toque es el destello que pinta el
    // navegador — gris ajeno al material del portal, y que el plan pedía
    // apagar. Apagarlo SIN acuse propio deja el control mudo, así que lo que
    // hay que medir es cuántos dependen todavía de él.
    //
    // Se lee el atributo `class` literal y no una regla CSS: Tailwind escapa
    // los dos puntos al generar la clase, pero el atributo conserva el texto
    // (misma propiedad que usa la regla de `group-hover` de index.css).
    const sinAcuse = [];
    document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
        if (!visible(el)) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        const clases = el.className?.toString?.() || '';
        if (/active:/.test(clases)) return;
        sinAcuse.push({ sel: sel(el),
                        destello: getComputedStyle(el).webkitTapHighlightColor || '(no expuesto)',
                        texto: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) });
    });

    // 8 · Scroll-chaining dentro de hojas y modales (fase 3.4)
    // Un contenedor scrolleable dentro de un diálogo que llega a su tope
    // arrastra a la página de atrás. Es lo único que quedó vigente del punto
    // 3.4 sobre `overscroll-behavior`: en `#main-scroll` el token es `auto` a
    // propósito desde que el móvil scrollea el DOCUMENTO (v2.447.0).
    const encadenan = [];
    document.querySelectorAll('[role="dialog"] *, [data-hoja] *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return;
        if (el.scrollHeight <= el.clientHeight) return;
        if (cs.overscrollBehaviorY === 'auto') encadenan.push({ sel: sel(el) });
    });

    return { vw, desbordePagina, desbordan: desbordan.slice(0, 12), chicos: chicos.slice(0, 12),
             zoomIOS: zoomIOS.slice(0, 8), tablas, overscroll,
             sinAcuse: sinAcuse.slice(0, 8), encadenan,
             totales: { desbordan: desbordan.length, chicos: chicos.length, zoomIOS: zoomIOS.length,
                        sinAcuse: sinAcuse.length, encadenan: encadenan.length } };
};

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
});
