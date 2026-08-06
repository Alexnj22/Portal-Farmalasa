import { test, expect } from '@playwright/test';

// Verificación del material (PLAN-MATERIALES §1-§5, §11, §20) contra el BUNDLE,
// no contra el fuente: un token puede estar escrito y no llegar —pasó con el par
// `-webkit-backdrop-filter`, que Lightning CSS colapsaba— y una capa puede estar
// cableada y quedar inerte —pasó con `.modal-glass-layer`, que pintaba encima de
// `--surface-modal` y dejaba el 0.51 en ~0.76—. Las dos las encontró mirar el
// resultado, no el archivo.
const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const TEMAS = ['liquid', 'dark', 'solid', 'solid-dark'];

// Lo que cada tema TIENE que resolver. Los valores salen de index.css y de las
// decisiones confirmadas: §1.6.quater (el destello invierte), §3 (el filo del
// campo es fenómeno de tema claro), §5 (el velo sólo oscurece en Solid),
// §11 (la geometría del carril es del material).
const ESPERADO = {
// Ojo con el radio: una variable devuelve el TEXTO autorado —y minificado por
// Lightning CSS, que le come el cero de la izquierda—, no píxeles resueltos.
    liquid:       { glintContraSombra: 'oscuro', campoLuzinv: 0.90, veloAlfa: 0,     trackRadius: '2.5rem', pillRadius: '9999px' },
    dark:         { glintContraSombra: 'claro',  campoLuzinv: 0,    veloAlfa: 0,     trackRadius: '2.5rem', pillRadius: '9999px' },
    solid:        { glintContraSombra: 'plano',  campoLuzinv: 0,    veloAlfa: 0.169, trackRadius: '.75rem', pillRadius: '.5rem' },
    'solid-dark': { glintContraSombra: 'plano',  campoLuzinv: 0,    veloAlfa: 0.169, trackRadius: '.75rem', pillRadius: '.5rem' },
};

const leerTokens = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    // ⚠️ El valor NO viene como `rgba()`. Lightning CSS lo minifica a HEX CON
    // ALFA (`#030b1c2b`) y `getPropertyValue` devuelve el texto tal cual, sin
    // normalizar —no es un `getComputedStyle` de una propiedad de color, es una
    // variable—. Un parser que sólo entienda `rgba()` devuelve null y el test
    // falla por el instrumento, no por el material. Es la misma trampa que la
    // unidad de `--dur-*` (`220ms` → `.22s`).
    const canal = (c) => {
        c = c.trim();
        if (c.startsWith('#')) {
            let h = c.slice(1);
            if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
            const n = (i) => parseInt(h.slice(i, i + 2), 16);
            return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
        }
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
        return { r: p[0], g: p[1], b: p[2], a: p.length === 4 ? p[3] : 1 };
    };
    const alfa = (c) => canal(c)?.a ?? null;
    const luminancia = (c) => {
        const k = canal(c);
        return k ? 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b : null;
    };
    return {
        rimGlint:   v('--rim-glint'),
        rimSombra:  v('--rim-sombra'),
        rimGlintLum:  luminancia(v('--rim-glint')),
        rimSombraLum: luminancia(v('--rim-sombra')),
        campoLuzinv: parseFloat(v('--campo-luzinv')),
        campoHueco:  parseFloat(v('--campo-hueco')),
        velo:        v('--velo'),
        veloAlfa:    alfa(v('--velo')),
        trackRadius: v('--tab-track-radius'),
        pillRadius:  v('--tab-pill-radius'),
        surfaceInput: v('--surface-input'),
        surfaceCard:  v('--surface-card'),
        liftCard:     v('--lift-card'),
        // Los ocho que §6.1.bis borró: tienen que resolver a cadena vacía
        muertos: ['--glass-especular', '--glass-esp-radio', '--glass-rim',
                  '--btn-especular', '--btn-esp-radio', '--btn-esp-aro',
                  '--btn-rim', '--btn-barrido'].filter(n => v(n) !== ''),
    };
});

test.describe('Material', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await expect(page.getByText('Inicio').first()).toBeVisible({ timeout: 15_000 });
    });

    for (const tema of TEMAS) {
        test(`tokens resueltos en ${tema}`, async ({ page }) => {
            await page.evaluate((t) => {
                document.documentElement.setAttribute('data-theme', t);
            }, tema === 'liquid' ? '' : tema);
            await page.waitForTimeout(300);

            const t = await leerTokens(page);
            const esp = ESPERADO[tema];
            console.log(`\n── ${tema} ──`);
            console.log(`  --rim-glint      ${t.rimGlint}   (lum ${t.rimGlintLum?.toFixed(0)})`);
            console.log(`  --rim-sombra     ${t.rimSombra}  (lum ${t.rimSombraLum?.toFixed(0)})`);
            console.log(`  --campo-luzinv   ${t.campoLuzinv}      --campo-hueco ${t.campoHueco}`);
            console.log(`  --velo           ${t.velo}   (alfa ${t.veloAlfa})`);
            console.log(`  carril           track ${t.trackRadius} · pill ${t.pillRadius}`);
            console.log(`  --lift-card      ${t.liftCard}`);
            console.log(`  --surface-input  ${t.surfaceInput}`);
            console.log(`  --surface-card   ${t.surfaceCard}`);

            // §6.1.bis · los ocho tokens del especular NO existen
            expect(t.muertos, 'tokens del especular que deberían estar borrados').toEqual([]);

            // §1.6.quater · el destello CONTRASTA con su flanco, y la dirección
            // la manda el tema. En Solid no hay canto que corra: los dos iguales.
            if (esp.glintContraSombra === 'oscuro') {
                expect(t.rimGlintLum, 'en claro el destello es OSCURO sobre flanco blanco').toBeLessThan(t.rimSombraLum - 100);
            } else if (esp.glintContraSombra === 'claro') {
                expect(t.rimGlintLum, 'en oscuro el destello es CLARO sobre flanco oscuro').toBeGreaterThan(t.rimSombraLum + 100);
            } else {
                expect(t.rimGlintLum, 'en Solid el anillo es plano').toBeCloseTo(t.rimSombraLum, 0);
            }

            // §3 · el filo claro del campo es un fenómeno de tema claro
            expect(t.campoLuzinv, '--campo-luzinv').toBeCloseTo(esp.campoLuzinv, 2);
            expect(t.campoHueco, '--campo-hueco').toBeCloseTo(0.18, 2);

            // §5 · el velo sólo oscurece en Solid
            expect(t.veloAlfa, 'alfa del velo').toBeCloseTo(esp.veloAlfa, 2);

            // §11 · la geometría del carril es del material
            expect(t.trackRadius, '--tab-track-radius').toBe(esp.trackRadius);
            expect(t.pillRadius, '--tab-pill-radius').toBe(esp.pillRadius);

            // §3 · el campo NO puede ser el mismo color que su contenedor
            expect(t.surfaceInput, 'campo vs tarjeta').not.toBe(t.surfaceCard);
        });
    }

    test('§1.5 · una tarjeta anidada pierde el backdrop-filter (incluido Firefox)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const ext = document.createElement('div');
            ext.setAttribute('data-surface', 'card');
            const int = document.createElement('div');
            int.setAttribute('data-surface', 'card');
            ext.appendChild(int);
            document.body.appendChild(ext);
            const cs = getComputedStyle(int);
            const out = {
                backdrop: cs.getPropertyValue('backdrop-filter'),
                webkit: cs.getPropertyValue('-webkit-backdrop-filter'),
            };
            ext.remove();
            return out;
        });
        console.log(`\n  anidada · backdrop-filter: ${r.backdrop} · -webkit-: ${r.webkit}`);
        // La estándar TIENE que estar: escribir el par a mano la borraba del build
        expect(r.backdrop, 'backdrop-filter estándar en la anidada').toBe('none');
    });
});

test.describe('§17.0 · carril y píldora', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    // Los dos que el ratchet deja abiertos. Se mide a los dos anchos que §17.0
    // exige: angostar la tarjeta a 148px destapa truncamientos.
    const VISTAS = [
        { nombre: 'AttendanceAudit', url: '/audit' },
        { nombre: 'TabInventario',   url: '/productos', tab: 'Inventario' },
    ];

    for (const v of VISTAS) {
        for (const ancho of [1280, 1600]) {
            test(`${v.nombre} @ ${ancho}`, async ({ page }) => {
                await page.setViewportSize({ width: ancho, height: 900 });
                await page.goto('/login');
                await page.locator('#username').fill(E2E_USER);
                await page.locator('#password').fill(E2E_PASSWORD);
                await page.locator('button[type="submit"]').first().click();
                await expect(page.getByText('Inicio').first()).toBeVisible({ timeout: 15_000 });

                await page.goto(v.url);
                await page.waitForTimeout(3000);
                if (v.tab) {
                    await page.getByRole('button', { name: v.tab, exact: true }).first().click();
                    await page.waitForTimeout(3000);
                }

                const m = await page.evaluate(() => {
                    const carril = document.querySelector('[role="group"]');
                    if (!carril) return { hayCarril: false };
                    const rc = carril.getBoundingClientRect();
                    const pil = document.querySelector('[data-pildora]');
                    const rp = pil?.getBoundingClientRect();
                    const tarjetas = [...carril.children].map(c => Math.round(c.getBoundingClientRect().width));
                    // ¿Comparten renglón? Por CENTRO vertical, no por solapamiento
                    // de bandas: dos elementos apilados con márgenes negativos se
                    // solapan unos píxeles y un test de bandas los da por vecinos.
                    const cy = (r) => r.top + r.height / 2;
                    const mismaFila = rp
                        ? Math.abs(cy(rc) - cy(rp)) < Math.min(rc.height, rp.height) / 2
                        : null;
                    // El ancho que de verdad hay: el del contenedor que los aloja.
                    const fila = carril.parentElement?.parentElement;
                    const disponible = fila ? Math.round(fila.clientWidth) : null;
                    const minCarril = tarjetasMin(carril);
                    function tarjetasMin(c) {
                        const hijos = [...c.children];
                        if (!hijos.length) return 0;
                        const gap = parseFloat(getComputedStyle(c).gap) || 0;
                        return Math.round(hijos.reduce((s, h) => s + h.getBoundingClientRect().width, 0)
                            + gap * (hijos.length - 1));
                    }
                    // Truncamiento real: scrollWidth > clientWidth en cualquier nodo de la tarjeta
                    const truncados = [...carril.querySelectorAll('*')]
                        .filter(e => !e.children.length && e.scrollWidth > e.clientWidth + 1)
                        .map(e => (e.textContent || '').trim().slice(0, 40));
                    return {
                        hayCarril: true,
                        carril: `${Math.round(rc.width)}x${Math.round(rc.height)} @y${Math.round(rc.top)}`,
                        pildora: rp ? `${Math.round(rp.width)}x${Math.round(rp.height)} @y${Math.round(rp.top)}` : 'no encontrada',
                        tarjetas, mismaFila, truncados, disponible, minCarril,
                        anchoPildora: rp ? Math.round(rp.width) : null,
                        anchoCarrilScroll: carril.scrollWidth, anchoCarrilClient: carril.clientWidth,
                    };
                });

                console.log(`\n── ${v.nombre} @ ${ancho} ──`);
                if (!m.hayCarril) { console.log('  (sin [role="group"] en esta pantalla)'); return; }
                console.log(`  carril   ${m.carril}   tarjetas: ${m.tarjetas.join(', ')}`);
                console.log(`  píldora  ${m.pildora}`);
                console.log(`  ¿misma fila? ${m.mismaFila}`);
                const necesita = m.minCarril + (m.anchoPildora || 0) + 12;
                console.log(`  ¿entrarían juntos? ${necesita} necesarios vs ${m.disponible} disponibles → ${necesita <= m.disponible ? 'SÍ' : 'NO'}`);
                console.log(`  carril desborda: ${m.anchoCarrilScroll > m.anchoCarrilClient} (${m.anchoCarrilScroll} vs ${m.anchoCarrilClient})`);
                console.log(`  textos truncados: ${m.truncados.length ? m.truncados.join(' | ') : 'ninguno'}`);
            });
        }
    }
});
