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
    const desbordan = [];
    document.querySelectorAll('*').forEach(el => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width <= vw * 3) {
            const cs = getComputedStyle(el);
            // No cuenta lo que desborda DENTRO de su propio scroll horizontal:
            // eso es el patrón correcto (una tabla en su carril).
            let enCarril = false;
            for (let p = el.parentElement; p; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (s.overflowX === 'auto' || s.overflowX === 'scroll') { enCarril = true; break; }
            }
            if (!enCarril) desbordan.push({ sel: sel(el), sobra: Math.round(r.right - vw), overflowX: cs.overflowX });
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

    return { vw, desbordePagina, desbordan: desbordan.slice(0, 12), chicos: chicos.slice(0, 12),
             zoomIOS: zoomIOS.slice(0, 8), tablas, overscroll,
             totales: { desbordan: desbordan.length, chicos: chicos.length, zoomIOS: zoomIOS.length } };
};

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
            m.desbordan.forEach(d => console.log(`      +${d.sobra}px  ${d.sel}`));
            console.log(`   blancos táctiles <44pt: ${m.totales.chicos}`);
            m.chicos.slice(0, 6).forEach(c => console.log(`      ${c.tam}  ${c.sel}  «${c.texto}»`));
            console.log(`   inputs que hacen zoom en iOS (<16px): ${m.totales.zoomIOS}`);
            m.zoomIOS.slice(0, 4).forEach(z => console.log(`      ${z.fontSize}px  ${z.sel}`));
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
});
