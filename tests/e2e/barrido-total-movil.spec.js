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

// `RUTAS=productos,pedidos` acota el barrido. No es para uso normal —el barrido
// es «todas»— sino para poder probar el propio instrumento en treinta segundos
// en vez de una hora: las dos primeras versiones del recorrido de pestañas se
// descubrieron rotas después de 20 minutos de corrida.
const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map(r => r.trim()) : [
    'overview', 'ventas', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'cotizaciones', 'conteo-inventario',
    'libro-compras-completo', 'libros-iva', 'resumen-fiscal', 'corte-z', 'ventas-perdidas',
    'staff', 'monitor', 'audit', 'schedules', 'payroll', 'requests', 'vacation-plan',
    'announcements', 'encuesta', 'metas', 'branches', 'laboratorios', 'roles',
    'permissions', 'sync-health', 'my-requests', 'my-documents', 'my-announcements',
    'profile', 'dashboard',
];

// `TEMA=dark|solid|solid-dark|liquid` — todo lo medido hasta el 2026-08-07 fue
// en el tema por defecto, y el portal tiene cuatro. Se estampa en localStorage
// antes de que monte React (`ThemeContext` lo lee de ahí) y además en el
// atributo, que es lo que pinta el CSS.
// `PESTANAS=1` recorre además las pestañas internas de cada vista. Ver la nota
// en el bucle: casi duplican la cuenta de pantallas y el barrido pasa de 4½
// minutos a ~55.
const PESTANAS = Boolean(process.env.PESTANAS);
const TEMA = process.env.TEMA || '';
const ATRIBUTO_TEMA = { liquid: null, dark: 'dark', solid: 'solid', 'solid-dark': 'solid-dark' };

test.use({ ...devices['iPhone 13'] });

test.describe('Barrido total · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('todas las vistas', async ({ page }) => {
        // 45 minutos. Con las pestañas internas el barrido pasó de 4½ a ~16, y
        // el techo de 15 lo cortaba a mitad de camino — el informe quedaba sin
        // escribir y la corrida entera se perdía. Es el precio de cubrir las
        // pestañas: son casi tantas pantallas como rutas.
        test.setTimeout(2_700_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        if (TEMA) {
            await page.addInitScript(({ tema, attr }) => {
                try { localStorage.setItem('portal-theme', tema); } catch { /* sin localStorage */ }
                if (attr) document.documentElement.setAttribute('data-theme', attr);
                else document.documentElement.removeAttribute('data-theme');
            }, { tema: TEMA, attr: ATRIBUTO_TEMA[TEMA] ?? null });
        }
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        // Esperar a la CONDICIÓN, no al reloj. Con 6 segundos fijos el cerrojo
        // de abajo daba falso positivo: la primera carga tras levantar el
        // preview se queda en «VERIFICANDO SESIÓN…» más de eso, y el barrido
        // moría diciendo «no se pudo iniciar sesión» cuando estaba entrando.
        // Un instrumento que confunde «todavía no» con «no» es tan inútil como
        // uno que confunde «no encontré nada» con «no había nada».
        await page.waitForFunction(
            () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
        ).catch(() => {});
        await page.waitForTimeout(3000);

        // ⚠️ SIN SESIÓN, EL BARRIDO MIDE EL LOGIN 37 VECES — y el login está
        // bien hecho, así que sale todo en cero y el informe dice «0 vistas con
        // algo que corregir». Pasó de verdad: una corrida entera se leyó como
        // «las 37 perfectas» cuando lo único que había pasado es que el ingreso
        // falló. Es el mismo agujero que el de las vistas reventadas: la
        // ausencia de datos y la ausencia de defectos se ven idénticas.
        //
        // Se corta acá y con ruido, no se reporta.
        if (/\/login/.test(page.url())) {
            throw new Error('No se pudo iniciar sesión: el barrido habría medido la pantalla de login 37 veces.');
        }

        // Una vista que REVIENTA mide exactamente igual que una vista vacía:
        // cero fichas, cero tablas, cero desborde. Proveedores estuvo así y el
        // barrido la listaba con un punto al lado, como si estuviera bien.
        const errores = [];
        page.on('pageerror', e => errores.push(e.message.slice(0, 200)));

        // Esperar a que se vayan los ESQUELETOS, no un número de segundos.
        //
        // `DataTable` con `loading` pinta su esqueleto **como tabla** —el modo
        // ficha exige `!loading`—, así que medir durante la carga reporta «cayó
        // a la tabla» de una vista que no cayó. Con 6.5s fijos pasaba igual:
        // `productos#sinventa` salió con `tablas: 1` en el primer barrido con
        // pestañas y la captura mostraba la pantalla entera en esqueleto.
        //
        // Y de paso es más RÁPIDO: una vista que carga en 800ms deja de costar
        // 6.5 segundos, que con ~67 pantallas era la mitad del barrido.
        // ⚠️ «No hay esqueleto» es cierto DOS VECES: antes de que aparezca y
        // después de que se va. La primera versión preguntaba en el mismo
        // instante de navegar —cuando la vista ni había montado— y seguía de
        // largo: midió `ventas`, `compras`, `productos`, `clientes` y `minmax`
        // como «cayó a la tabla», que es exactamente el falso positivo que este
        // helper venía a arreglar. Un arreglo que reintroduce el defecto que
        // corrige, por mirar sólo un lado de la condición.
        //
        // El colchón inicial le da tiempo a montar y pintar su esqueleto; recién
        // ahí tiene sentido esperar a que se vaya.
        const esperarDatos = async (tope = 20_000) => {
            await page.waitForTimeout(1500);  // que monte y pinte su esqueleto
            await page.waitForFunction(
                () => !document.querySelector('.skeleton'), null, { timeout: tope },
            ).catch(() => {});
            await page.waitForTimeout(900);   // asentar el layout tras el último dato
        };

        const informe = [];

        // Medir la pantalla que está abierta AHORA. `etiqueta` es la ruta, o
        // `ruta#pestaña` cuando se está recorriendo una pestaña interna: el
        // informe tiene que poder decir cuál de las dos falló, no promediarlas.
        const medirPantalla = async (etiqueta) => {
            // El motivo se IMPRIME. Con `.catch(() => null)` a secas, una
            // medición que falla sale en el informe como «(no cargó)» —igual que
            // una ruta que de verdad no cargó— y no hay forma de saber cuál de
            // las dos fue. Costó una corrida entera de pestañas.
            const m = await page.evaluate(MEDIR).catch(e => {
                console.log(`   ⚠️  ${etiqueta}: MEDIR falló — ${String(e.message).slice(0, 140)}`);
                return null;
            });
            if (!m) { informe.push({ ruta: etiqueta, error: true }); return; }
            // Una sesión que se cae a mitad del barrido devuelve al login sólo a
            // partir de ahí, y esas rutas también saldrían en cero.
            if (/\/login/.test(page.url())) {
                throw new Error(`La sesión se perdió en ${etiqueta}: de acá en adelante se estaría midiendo el login.`);
            }
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
            informe.push({ ruta: etiqueta, ...m.totales, desbordePagina: m.desbordePagina,
                           ...extra, grupos: m.grupos, muestraDesborde: m.desbordan.slice(0, 3) });
            // La foto entera para la vista; el viewport para sus pestañas. Una
            // captura `fullPage` de una lista de 200 fichas tarda varios
            // segundos, y con las pestañas internas eso pasó a ser la mitad del
            // costo del barrido: 8 rutas en 10 minutos, contra 37 en 4½ antes.
            // La pestaña se mide igual —los números salen del DOM, no de la
            // foto—; lo que se pierde es poder mirarla entera, y para eso está
            // el spec de foco.
            const esPestana = etiqueta.includes('#');
            await page.screenshot({
                path: `${SALIDA}/${etiqueta.replace(/[#/]/g, '_')}.png`,
                fullPage: !esPestana,
            });

            // El informe se escribe DESPUÉS DE CADA PANTALLA, no al final. Dos
            // corridas se cortaron por timeout con todo medido y el archivo sin
            // escribir: 25 minutos de medición perdidos porque el resultado
            // vivía en memoria hasta la última línea.
            fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify(informe, null, 1));
        };

        for (const ruta of RUTAS) {
            errores.length = 0;
            await page.goto('/' + ruta).catch(() => {});
            await esperarDatos();
            await medirPantalla(ruta);

            // ── Las pestañas internas ────────────────────────────────────────
            // Era el hueco de cobertura más grande: 37 archivos de vista
            // declaran pestañas propias y el barrido medía sólo la que abre por
            // defecto. La pestaña activa NO va en la URL —la maneja cada vista
            // por prop—, así que el único asidero es `data-pestanas`, que
            // `ViewTabBar` estampa con la lista de claves.
            //
            // Todo el bloque es defensivo: una pestaña que no se deja abrir se
            // anota y se sigue. Perder una pestaña es un hueco; perder el
            // barrido entero por una pestaña es peor.
            // Detrás de `PESTANAS=1` porque **cuestan**: medido el 2026-08-07,
            // cada pantalla tarda ~50s y las pestañas casi duplican la cuenta —
            // el barrido pasa de 4½ minutos a ~55. Un barrido que tarda una hora
            // no se corre mientras se trabaja, y uno que no se corre no mide
            // nada. Sin la bandera queda el de siempre, para iterar; con ella,
            // el completo, para cerrar una vista o para CI.
            const claves = PESTANAS
                ? await page.getAttribute('[data-pestanas]', 'data-pestanas').catch(() => null)
                : null;
            const lista = claves ? claves.split(',').filter(Boolean) : [];
            for (let i = 1; i < lista.length; i++) {
                try {
                    // El disparador de `LiquidSelect` es un `<div
                    // role="combobox">`, NO un `<button>` — está escrito en su
                    // propio código y dice por qué. Buscar `button` no
                    // encontraba nada y las 15 pestañas de la primera corrida
                    // salieron «no se abrió»: descubiertas y sin medir, que en
                    // el informe se ve casi igual que medidas.
                    // `:visible` — `GlassViewLayout` renderiza `filtersContent`
                    // DOS VECES (una para el carril de escritorio, otra para el
                    // cuerpo), así que hay dos `data-pestanas` en el DOM y uno
                    // está oculto. Sin el filtro, `.first()` agarraba el oculto
                    // y el clic moría por timeout sin decir por qué.
                    await page.locator('[data-pestanas] [role="combobox"]:visible').first().click({ timeout: 4000 });
                    await page.waitForTimeout(500);
                    await page.locator('[role="option"]').nth(i).click({ timeout: 4000 });
                    await esperarDatos();
                    await medirPantalla(`${ruta}#${lista[i]}`);
                } catch (e) {
                    // Con el catch mudo, «no se pudo abrir la pestaña» y «la
                    // pestaña no cargó» salían idénticos en el informe, y las
                    // dos primeras versiones del recorrido se depuraron a
                    // ciegas. El motivo se imprime.
                    console.log(`   ⚠️  ${ruta}#${lista[i]}: no se pudo abrir — ${String(e.message).split('\n')[0].slice(0, 140)}`);
                    informe.push({ ruta: `${ruta}#${lista[i]}`, error: true, noSeAbrio: true });
                    await page.keyboard.press('Escape').catch(() => {});
                }
            }
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
