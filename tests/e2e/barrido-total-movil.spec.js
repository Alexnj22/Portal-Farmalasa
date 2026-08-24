import { test, expect, devices } from '@playwright/test';
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

// El informe lleva en el NOMBRE lo que lo distingue, y no es cosmética: la
// corrida de referencia son ocho —dos mitades × cuatro temas— y un
// `informe.json` fijo las hace pisarse una a otra, así que sólo sobrevive la
// última y no hay nada contra qué comparar. El nombre sale solo del ambiente
// que se pidió; `ETIQUETA=lo-que-sea` lo fuerza para las dos mitades.
const ETIQUETA = process.env.ETIQUETA
    || [process.env.TEMA || 'liquid',
        process.env.ORIENTACION === 'acostado' ? 'acostado' : null,
        process.env.PESTANAS ? 'pest' : null,
        process.env.MODALES ? 'mod' : null].filter(Boolean).join('-');
// ⚠️ Y el informe NO puede vivir bajo `test-results/`: ése es el `outputDir` de
// Playwright, **que se limpia entero al arrancar cada corrida**. O sea que la
// segunda corrida borraba el informe de la primera y sólo sobrevivía la última
// — invisible mientras se miraba una sola, y fatal justo para la corrida de
// referencia, que compara ocho. Medido el 2026-08-08: el informe de `dark`
// desapareció al lanzar `liquid`. Las capturas sí se quedan ahí (son pesadas y
// efímeras); el informe es el dato.
const SALIDA_INFORMES = 'barridos';

// ── Un barrido incompleto NO puede parecer completo (2026-08-20) ────────────
//
// El informe se escribe pantalla por pantalla —bien, porque una corrida cortada
// no pierde 25 minutos de medición—, pero se escribía SIEMPRE con el nombre
// final. O sea que una corrida que murió a las 7 rutas de 38 dejaba un
// `informe-liquid.json` idéntico en forma a uno de 38, y quien lo abría leía
// «cero hallazgos» sin ninguna señal de que faltaban 31 vistas.
//
// Pasó de verdad el 2026-08-20: 18.5 minutos, 7 rutas, WebKit se llevó la
// página, y el archivo resultante era indistinguible de un barrido limpio.
//
// **Un barrido que no termina no dice «está todo bien»: dice que no se midió.**
// Es la misma regla que este archivo ya aplica al login —«sin sesión, el
// barrido mide el login 37 veces y sale todo en cero», y por eso corta con
// ruido— sólo que aplicada al final del recorrido en vez de al principio.
//
// Mientras corre, el informe vive en `.parcial.json`. Sólo al medir TODAS las
// pantallas previstas se renombra al nombre final. Así la incompletitud viaja
// en el nombre —que es donde este archivo ya pone lo que distingue una corrida
// de otra— y no hace falta que nadie se acuerde de mirar un campo adentro.
const INFORME = `${SALIDA_INFORMES}/informe-${ETIQUETA}.json`;
const INFORME_PARCIAL = `${SALIDA_INFORMES}/informe-${ETIQUETA}.parcial.json`;

// `RUTAS=productos,pedidos` acota el barrido. No es para uso normal —el barrido
// es «todas»— sino para poder probar el propio instrumento en treinta segundos
// en vez de una hora: las dos primeras versiones del recorrido de pestañas se
// descubrieron rotas después de 20 minutos de corrida.
const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map(r => r.trim()) : [
    'overview', 'ventas', 'cortes', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'cotizaciones', 'conteo-inventario',
    'libro-compras-completo', 'libros-iva', 'resumen-fiscal', 'corte-z', 'ventas-perdidas',
    'staff', 'monitor', 'audit', 'schedules', 'payroll', 'requests', 'vacation-plan',
    'announcements', 'encuesta', 'metas', 'branches', 'laboratorios', 'roles',
    'permissions', 'sync-health', 'requests-personales', 'my-documents', 'my-announcements',
    'profile', 'dashboard',
    // ── Las 16 que faltaban (F4, 2026-08-21) ────────────────────────────────
    // La lista tenía 38 rutas y `App.jsx` declara **65**. Descontando comodines,
    // login, el kiosco pre-sesión, las de prueba y las que llevan `:id`,
    // quedaban **16 rutas reales que el barrido no visitaba nunca** — o sea que
    // su «cero hallazgos» hablaba de dos tercios del portal.
    //
    // Y no era una lista de vistas menores: `inventario`, `traslados`,
    // `cuentas-por-pagar` y `gestion-stock` son de las más usadas. La de
    // Traslados salió con un blanco de dedo de 40px la primera vez que se la
    // midió.
    //
    // Las que siguen afuera y por qué: `/login` y `/kiosk` no tienen sesión
    // —el barrido las mediría como la pantalla de ingreso, que es el agujero
    // que este archivo ya conoce—; `ios-test` y `raw-test` son andamios; y las
    // de `:id` necesitan un registro concreto, que es trabajo aparte.
    'bitacoras', 'cargar-compra', 'carnes-del-dia', 'cierre-periodo',
    'cuentas-por-pagar', 'encuesta-admin', 'facturas-sala', 'gestion-stock',
    'impresion', 'inventario', 'mantenimiento', 'my-requests',
    'orphan-objects', 'sesiones', 'traslados', 'auditview',
];

// `TEMA=dark|solid|solid-dark|liquid` — todo lo medido hasta el 2026-08-07 fue
// en el tema por defecto, y el portal tiene cuatro. Se estampa en localStorage
// antes de que monte React (`ThemeContext` lo lee de ahí) y además en el
// atributo, que es lo que pinta el CSS.
// ⚠️ CON `PESTANAS=1 MODALES=1` HAY QUE CORRERLO EN DOS MITADES.
//
// Seis corridas seguidas murieron con «Target page, context or browser has been
// closed» alrededor de la pantalla 28. Tres cosas subieron el techo sin
// levantarlo —acotar la captura de página completa (23→29), pasar por
// `about:blank` entre rutas (28), reciclar la página cada 8 (28)—, y la ruta
// donde muere, medida sola, siempre anda bien. Es el proceso de contenido de
// WebKit acumulando 37 vistas con sus pestañas y sus diálogos.
//
// La salida honesta es partirlo, no seguir parcheándolo:
//
//   RUTAS=overview,ventas,compras,productos,pedidos,minmax,clientes,proveedores,\
//   facturacion,facturas-compra,cotizaciones,conteo-inventario,libro-compras-completo,\
//   libros-iva,resumen-fiscal,corte-z,ventas-perdidas,staff PESTANAS=1 MODALES=1 …
//
//   RUTAS=monitor,audit,schedules,payroll,requests,vacation-plan,announcements,\
//   encuesta,metas,branches,laboratorios,roles,permissions,sync-health,requests-personales,\
//   my-documents,my-announcements,profile,dashboard PESTANAS=1 MODALES=1 …
//
// Sin banderas (el barrido de rutas a secas) entra de una sola vez y es el que
// se corre mientras se trabaja.
//
// `PESTANAS=1` recorre además las pestañas internas de cada vista. Ver la nota
// en el bucle: casi duplican la cuenta de pantallas y el barrido pasa de 4½
// minutos a ~55.
const PESTANAS = Boolean(process.env.PESTANAS);
// `MODALES=1` abre además lo que la vista despliega: la hoja de detalle de la
// primera ficha y el panel de la acción principal. Era el último hueco del
// alcance —19 archivos de vista declaran diálogos y el barrido nunca abrió
// ninguno—, y es donde el canon móvil tiene más piezas propias (`HojaMovil`,
// `AsaHoja`, `ExpedienteMovil`): justo lo que menos se había mirado.
const MODALES = Boolean(process.env.MODALES);
const TEMA = process.env.TEMA || '';
const ATRIBUTO_TEMA = { liquid: null, dark: 'dark', solid: 'solid', 'solid-dark': 'solid-dark' };

// ── De pie o acostado (F5, 2026-08-21) ──────────────────────────────────────
// Todo lo medido hasta hoy fue DE PIE, y acostado no es la misma pantalla: el
// alto pasa a ser el recurso escaso. `useLayoutCompacto` ya lo tiene escrito y
// medido —un iPhone 13 acostado es 844×390, y ahí una hoja inferior gasta el
// 63% del alto para mostrar dos controles—, y por eso existe `usePanelLateral`.
// Lo que faltaba era una corrida que lo comprobara.
//
// El descriptor sale de la base de Playwright y no de números escritos a mano:
// emular el aparato es más defendible que inventarle un viewport.
const ACOSTADO = process.env.ORIENTACION === 'acostado';
const APARATO = ACOSTADO ? devices['iPhone 13 landscape'] : devices['iPhone 13'];

test.use({ ...APARATO });

test.describe('Barrido total · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('todas las vistas', async ({ page }) => {
        // 45 minutos. Con las pestañas internas el barrido pasó de 4½ a ~16, y
        // el techo de 15 lo cortaba a mitad de camino — el informe quedaba sin
        // escribir y la corrida entera se perdía. Es el precio de cubrir las
        // pestañas: son casi tantas pantallas como rutas.
        // `TIMEOUT_MS=180000` para correr RUTA POR RUTA. Con el techo de 45
        // minutos, una ruta que se cuelga se lleva la corrida entera y no dice
        // cuál fue: pasó el 2026-08-08 —34 minutos sin escribir una línea,
        // colgado en `cotizaciones` al abrir su diálogo—, y un cuelgue no da
        // error, así que sólo se ve midiendo el progreso desde afuera.
        // Bajando el techo, la ruta culpable muere sola y el bucle sigue.
        // `--timeout` del CLI no sirve acá: `test.setTimeout` le gana.
        test.setTimeout(Number(process.env.TIMEOUT_MS) || 2_700_000);
        fs.mkdirSync(SALIDA, { recursive: true });
        fs.mkdirSync(SALIDA_INFORMES, { recursive: true });
        if (TEMA) {
            await page.context().addInitScript(({ tema, attr }) => {
                try { localStorage.setItem('portal-theme', tema); } catch { /* sin localStorage */ }
                if (attr) document.documentElement.setAttribute('data-theme', attr);
                else document.documentElement.removeAttribute('data-theme');
            }, { tema: TEMA, attr: ATRIBUTO_TEMA[TEMA] ?? null });
        }
        // `pg` y no `page`: el barrido RECICLA la página cada pocas rutas (ver
        // `reciclar`), así que la referencia tiene que poder cambiar.
        let pg = page;

        // El ingreso, como FUNCIÓN: se vuelve a usar cada vez que se recicla el
        // contexto (ver `reciclar`), porque un contexto nuevo nace sin sesión.
        const ingresar = async (p) => {
            await p.goto('/login');
            await p.locator('#username').fill(E2E_USER);
            await p.locator('#password').fill(E2E_PASSWORD);
            await p.locator('button[type="submit"]').first().click();
            await p.waitForFunction(
                () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
            ).catch(() => {});
            await p.waitForTimeout(3000);
            return !/\/login/.test(p.url());
        };

        await pg.goto('/login');
        await pg.locator('#username').fill(E2E_USER);
        await pg.locator('#password').fill(E2E_PASSWORD);
        await pg.locator('button[type="submit"]').first().click();
        // Esperar a la CONDICIÓN, no al reloj. Con 6 segundos fijos el cerrojo
        // de abajo daba falso positivo: la primera carga tras levantar el
        // preview se queda en «VERIFICANDO SESIÓN…» más de eso, y el barrido
        // moría diciendo «no se pudo iniciar sesión» cuando estaba entrando.
        // Un instrumento que confunde «todavía no» con «no» es tan inútil como
        // uno que confunde «no encontré nada» con «no había nada».
        await pg.waitForFunction(
            () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
        ).catch(() => {});
        await pg.waitForTimeout(3000);

        // ⚠️ SIN SESIÓN, EL BARRIDO MIDE EL LOGIN 37 VECES — y el login está
        // bien hecho, así que sale todo en cero y el informe dice «0 vistas con
        // algo que corregir». Pasó de verdad: una corrida entera se leyó como
        // «las 37 perfectas» cuando lo único que había pasado es que el ingreso
        // falló. Es el mismo agujero que el de las vistas reventadas: la
        // ausencia de datos y la ausencia de defectos se ven idénticas.
        //
        // Se corta acá y con ruido, no se reporta.
        if (/\/login/.test(pg.url())) {
            throw new Error('No se pudo iniciar sesión: el barrido habría medido la pantalla de login 37 veces.');
        }

        // Una vista que REVIENTA mide exactamente igual que una vista vacía:
        // cero fichas, cero tablas, cero desborde. Proveedores estuvo así y el
        // barrido la listaba con un punto al lado, como si estuviera bien.
        const errores = [];
        pg.on('pageerror', e => errores.push(e.message.slice(0, 200)));

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
            await pg.waitForTimeout(1500);  // que monte y pinte su esqueleto
            await pg.waitForFunction(
                () => !document.querySelector('.skeleton'), null, { timeout: tope },
            ).catch(() => {});
            await pg.waitForTimeout(900);   // asentar el layout tras el último dato
        };

        // ── Reciclar la página ───────────────────────────────────────────────
        // CINCO corridas murieron a mitad de camino con «Target page, context or
        // browser has been closed», y cada vez parecía culpa de la ruta
        // siguiente — medida sola, ninguna lo era. Era el proceso de contenido
        // de WebKit acumulando 37 vistas, varias con 200 fichas.
        //
        // Los dos parches previos sólo corrieron el límite: acotar la captura de
        // página completa lo llevó de 23 a 29 pantallas, y pasar por
        // `about:blank` entre rutas, a 28. Mover un techo no es levantarlo.
        //
        // Cerrar la página y abrir otra del MISMO contexto libera ese proceso y
        // conserva la sesión, que vive en el contexto (cookies y localStorage).
        // Lo único que hay que rearmar es el escucha de errores, que sí es por
        // página.
        //
        // ── Y cerrar la página NO alcanzó (2026-08-20) ───────────────────────
        // La corrida de ese día murió en la ruta **7**, o sea ANTES del primer
        // reciclado. Reciclar la página libera su DOM, pero WebKit reparte
        // varias páginas del MISMO contexto en un solo proceso de contenido, y
        // ese proceso es el que se pasa de su techo (`per-process-limit`, 2,227
        // MB medidos en el iPhone del usuario). Cerrar una página adentro no lo
        // suelta.
        //
        // Un CONTEXTO nuevo sí: es un proceso nuevo. El precio es que nace sin
        // sesión —las cookies y el `localStorage` viven en el contexto—, así que
        // hay que volver a entrar. Son ~5 segundos cada `RECICLAR_CTX` rutas
        // contra perder el barrido entero a mitad de camino, que es lo que
        // venía pasando.
        //
        // El tema también se reinyecta: `addInitScript` es por contexto.
        const nuevaPagina = (p) => {
            p.on('pageerror', e => errores.push(e.message.slice(0, 200)));
            return p;
        };
        const reciclar = async () => {
            const nueva = await pg.context().newPage();
            await pg.close().catch(() => {});
            pg = nuevaPagina(nueva);
        };
        const reciclarContexto = async () => {
            const navegador = pg.context().browser();
            if (!navegador) return reciclar();          // sin browser: lo de siempre
            const viejo = pg.context();
            const ctx = await navegador.newContext({ ...APARATO });
            if (TEMA) {
                await ctx.addInitScript(({ tema, attr }) => {
                    try { localStorage.setItem('portal-theme', tema); } catch { /* sin localStorage */ }
                    if (attr) document.documentElement.setAttribute('data-theme', attr);
                    else document.documentElement.removeAttribute('data-theme');
                }, { tema: TEMA, attr: ATRIBUTO_TEMA[TEMA] ?? null });
            }
            pg = nuevaPagina(await ctx.newPage());
            await viejo.close().catch(() => {});
            const entro = await ingresar(pg);
            // Si el reingreso falla, el resto del barrido mediría la pantalla de
            // login. Es el mismo agujero del arranque y se corta igual.
            if (!entro) throw new Error('Tras reciclar el contexto no se pudo volver a entrar: el barrido habría medido el login.');
        };
        const CADA = Number(process.env.RECICLAR || 8);
        const CADA_CTX = Number(process.env.RECICLAR_CTX || 6);

        const informe = [];

        // Medir la pantalla que está abierta AHORA. `etiqueta` es la ruta, o
        // `ruta#pestaña` cuando se está recorriendo una pestaña interna: el
        // informe tiene que poder decir cuál de las dos falló, no promediarlas.
        const medirPantalla = async (etiqueta) => {
            // El motivo se IMPRIME. Con `.catch(() => null)` a secas, una
            // medición que falla sale en el informe como «(no cargó)» —igual que
            // una ruta que de verdad no cargó— y no hay forma de saber cuál de
            // las dos fue. Costó una corrida entera de pestañas.
            const m = await pg.evaluate(MEDIR).catch(e => {
                console.log(`   ⚠️  ${etiqueta}: MEDIR falló — ${String(e.message).slice(0, 140)}`);
                return null;
            });
            if (!m) { informe.push({ ruta: etiqueta, error: true }); return; }
            // Una sesión que se cae a mitad del barrido devuelve al login sólo a
            // partir de ahí, y esas rutas también saldrían en cero.
            if (/\/login/.test(pg.url())) {
                throw new Error(`La sesión se perdió en ${etiqueta}: de acá en adelante se estaría midiendo el login.`);
            }
            const extra = await pg.evaluate(() => {
                const vw = document.documentElement.clientWidth;
                // `data-tabla="matriz"` sale del conteo: hay tablas que en el
                // teléfono SE QUEDAN tabla porque no son una lista de registros
                // —un calendario semanal es personas × días— y no hay «una fila
                // = un registro» que convertir en ficha. La marca va en el DOM y
                // con su motivo escrito al lado, igual que `movil={false}` en
                // `DataTable`: una excepción sin motivo es deuda disfrazada, y un
                // hallazgo que aparece en cada corrida y nunca se arregla es como
                // se aprende a ignorar un informe.
                // DOS listas, porque son dos preguntas distintas y confundirlas
                // ya costó una corrida: al excluir la matriz del conteo de
                // HALLAZGOS quedó excluida también del de CONTENIDO, y
                // `schedules` —que pinta un calendario entero— pasó a contarse
                // como «sin nada que medir». El barrido bajó de 27 rutas medidas
                // a 25 sin que el portal hubiera cambiado.
                //
                //   `todasLasTablas` → ¿había algo que mirar en esta vista?
                //   `tablas`         → ¿cayó a tabla algo que debía ser ficha?
                const todasLasTablas = [...document.querySelectorAll('table')];
                const tablas = todasLasTablas.filter(t => t.getAttribute('data-tabla') !== 'matriz');
                const fichas = [...document.querySelectorAll('button[data-surface="card"], div[data-surface="card"]')]
                    .filter(e => e.firstElementChild?.classList?.contains('justify-between')).length;
                const anchas = tablas.filter(t => t.getBoundingClientRect().width > vw + 1).length;
                // ── Cuándo NO se pudo medir, en su tercera versión ──────
                // v1: `body.innerText.length < 120`. El menú lateral solo ya
                //     pasa ese umbral, así que NUNCA daba true y el resumen
                //     contaba como buenas 41 rutas que llegaron vacías.
                // v2: «ni ficha, ni tabla, ni fila». Demasiado estricto y por el
                //     motivo contrario: MEDIDO el 2026-08-24, `minmax` pinta 1
                //     tabla, 50 filas, 110 botones y 4.159 caracteres —está
                //     llena— y se marcaba igual, porque el selector de «ficha»
                //     (`[data-surface="card"]` cuyo primer hijo lleva
                //     `justify-between`) ya no reconoce lo que el portal pinta.
                //     Un detector con el selector viejo no encuentra menos:
                //     informa que no había nada que mirar.
                // v3: se MIDIÓ el chasis vacío —779 caracteres— y el corte se
                //     puso en 1.100. Anduvo para las vistas que pintan texto, y
                //     falla para las que NO lo pintan, que es la mitad del
                //     portal.
                // v4, la de acá: el texto se cambió por ESTRUCTURA, y el motivo
                //     es una propiedad de CSS que el portal usa a propósito.
                //     `BranchCard` lleva `content-visibility: auto` para no
                //     renderizar lo que está fuera de la pantalla — y
                //     `innerText` devuelve **sólo texto renderizado**. Medido el
                //     2026-08-24 en el teléfono: `branches` tiene 8 fichas, 129
                //     botones y 176 elementos con superficie de tarjeta, y su
                //     `innerText` da **508 caracteres**. `sesiones`, que llega
                //     sin una sola fila, da **506**. Dos caracteres separan una
                //     vista llena de una vacía: el texto no puede ser el
                //     instrumento.
                //
                //     Lo que sí se ve es la estructura, porque el DOM existe
                //     aunque no se pinte. Medido en las mismas ocho rutas:
                //
                //       llenas   overview 166 · branches 176
                //       vacías   cotizaciones 13 · sesiones 16 · corte-z 21
                //
                //     El corte va en 60: tres veces el chasis vacío y menos de
                //     la mitad de la vista con datos más pobre. El texto se
                //     conserva como señal ADICIONAL —una vista puede pintar
                //     mucho texto y ninguna tarjeta— pero ya no manda solo.
                //
                // Y se distingue «no tengo permiso» de «no hay datos», porque son
                // dos arreglos distintos: uno se resuelve dándole el módulo a la
                // cuenta de pruebas y el otro sembrando.
                const texto = document.body.innerText.trim();
                const filas = document.querySelectorAll('tbody tr, [role="row"], li[data-fila]').length;
                // La cuenta que NO depende de que el navegador haya pintado.
                const superficies = document.querySelectorAll('[data-surface], [class*="bg-surface-card"]').length;
                const sinAcceso = /sin acceso|no ten[eé]s permiso|acceso denegado|no ten[ée]s acceso/i.test(texto);
                const conContenido = superficies >= 60 || todasLasTablas.length > 0 || filas > 0
                                     || fichas > 0 || texto.length >= 1100;
                return { tablas: tablas.length, fichas, tablasAnchas: anchas, superficies,
                         reventó: /ALGO SALIÓ MAL/.test(texto),
                         sinAcceso,
                         sinDatos: sinAcceso || !conContenido,
                         vacia: !conContenido };
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
            // Y con TOPE de alto. Tres corridas seguidas murieron en la pantalla
            // 23 con «Target page, context or browser has been closed»: no era
            // la ruta siguiente —medida sola, anda— sino la memoria acumulada de
            // capturar páginas enteras de 14.000px una tras otra. Arriba del
            // tope se guarda el viewport, que para revisar a ojo se cubre con el
            // spec de foco.
            const esPestana = etiqueta.includes('#');
            const alto = await pg.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
            await pg.screenshot({
                path: `${SALIDA}/${etiqueta.replace(/[#/]/g, '_')}.png`,
                fullPage: !esPestana && alto <= 6000,
            });

            // El informe se escribe DESPUÉS DE CADA PANTALLA, no al final. Dos
            // corridas se cortaron por timeout con todo medido y el archivo sin
            // escribir: 25 minutos de medición perdidos porque el resultado
            // vivía en memoria hasta la última línea.
            fs.writeFileSync(INFORME_PARCIAL, JSON.stringify(informe, null, 1));
        };

        for (const [indice, ruta] of RUTAS.entries()) {
            errores.length = 0;
            if (indice > 0 && indice % CADA_CTX === 0) await reciclarContexto();
            else if (indice > 0 && indice % CADA === 0) await reciclar();
            // Pasar por `about:blank` DESCARTA el DOM anterior. Sin esto el
            // proceso de WebKit acumula las 37 vistas —varias con 200 fichas— y
            // se muere a mitad de camino: tres corridas se cortaron en la
            // pantalla 23 y, con el tope de captura puesto, la cuarta llegó a la
            // 29. Siempre «Target page, context or browser has been closed», y
            // siempre en la ruta siguiente a la última medida, lo que hacía
            // parecer que esa ruta era la culpable. Medida sola, ninguna lo era.
            await pg.goto('about:blank').catch(() => {});
            await pg.goto('/' + ruta).catch(() => {});
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
            // ⚠️ `{ timeout }` EXPLÍCITO, y no es cosmética: `actionTimeout` vale
            // **0 = sin límite** por defecto en Playwright, y esta config no lo
            // define. En una vista SIN pestañas —`cotizaciones`, `staff`,
            // `monitor`, `audit`, `payroll`, `vacation-plan`, `resumen-fiscal`,
            // `conteo-inventario`— el selector no aparece nunca, así que
            // `getAttribute` esperaba para siempre: la promesa no rechaza, el
            // `.catch()` no se dispara, y el barrido se queda colgado en silencio
            // hasta que lo mata el techo del test.
            //
            // Medido el 2026-08-08: **8 de 14 rutas** se colgaban justo después
            // de medir su pantalla base, y se leía como «murió por memoria de
            // WebKit» —el mismo síntoma que ya tenía una causa conocida—, así que
            // se le echaba la culpa al techo de recursos y se partía el barrido
            // en tandas cada vez más chicas. Partirlo no podía arreglar esto.
            // O sea que el recorrido de pestañas NUNCA cubrió las vistas que no
            // tienen pestañas, y eso no se veía: un cuelgue no da error.
            const claves = PESTANAS
                ? await pg.getAttribute('[data-pestanas]', 'data-pestanas', { timeout: 4000 }).catch(() => null)
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
                    await pg.locator('[data-pestanas] [role="combobox"]:visible').first().click({ timeout: 4000 });
                    await pg.waitForTimeout(500);
                    await pg.locator('[role="option"]').nth(i).click({ timeout: 4000 });
                    await esperarDatos();
                    await medirPantalla(`${ruta}#${lista[i]}`);
                } catch (e) {
                    // Con el catch mudo, «no se pudo abrir la pestaña» y «la
                    // pestaña no cargó» salían idénticos en el informe, y las
                    // dos primeras versiones del recorrido se depuraron a
                    // ciegas. El motivo se imprime.
                    console.log(`   ⚠️  ${ruta}#${lista[i]}: no se pudo abrir — ${String(e.message).split('\n')[0].slice(0, 140)}`);
                    informe.push({ ruta: `${ruta}#${lista[i]}`, error: true, noSeAbrio: true });
                    await pg.keyboard.press('Escape').catch(() => {});
                }
            }

            // ── Lo que la vista DESPLIEGA ────────────────────────────────────
            // Dos aperturas, y no más: la hoja de detalle de la primera ficha y
            // el panel de la acción principal de la barra flotante. Son las dos
            // que existen en casi todas las vistas y las que el usuario abre
            // primero; recorrer cada botón de cada vista sería otro barrido, no
            // una extensión de éste.
            //
            // Se mide con el diálogo ABIERTO: `MEDIR` recorre el DOM entero, así
            // que lo de adentro entra igual, y `encadenan` sólo tiene sentido
            // acá —mide el scroll que se escapa a la página de atrás, que es un
            // defecto que sólo existe dentro de una hoja—.
            if (MODALES) {
                const aperturas = [
                    ['ficha', 'button[data-surface="card"]'],
                    ['accion', '[data-barra-flotante] button'],
                ];
                for (const [nombre, selector] of aperturas) {
                    try {
                        const disparador = pg.locator(`${selector}:visible`).first();
                        if (!(await disparador.count())) continue;
                        await disparador.click({ timeout: 4000 });
                        await pg.waitForTimeout(1200);
                        // Sin diálogo abierto no hay nada nuevo que medir, y
                        // medir la misma vista otra vez ensucia el informe con
                        // una fila que dice lo mismo con otro nombre.
                        const abierto = await pg.locator('[role="dialog"], [data-hoja]').count();
                        if (abierto) await medirPantalla(`${ruta}»${nombre}`);
                        await pg.keyboard.press('Escape').catch(() => {});
                        await pg.waitForTimeout(600);
                    } catch (e) {
                        console.log(`   ⚠️  ${ruta}»${nombre}: no abrió — ${String(e.message).split('\n')[0].slice(0, 110)}`);
                        await pg.keyboard.press('Escape').catch(() => {});
                    }
                }
            }
        }
        // ── El informe final sólo existe si el barrido LLEGÓ AL FINAL ────────
        // `medidas` cuenta las RUTAS, no las pantallas: con `PESTANAS`/`MODALES`
        // una ruta aporta varias filas (`ruta#pestaña`, `ruta»ficha`) y compararlas
        // contra `RUTAS.length` daría siempre «de más».
        const medidas = new Set(informe.map(v => String(v.ruta).split(/[#»]/)[0]));
        const faltan = RUTAS.filter(r => !medidas.has(r));
        fs.writeFileSync(INFORME_PARCIAL, JSON.stringify(informe, null, 1));
        if (!faltan.length) {
            fs.renameSync(INFORME_PARCIAL, INFORME);
        }

        // ── `sinAcuse` y `chicos` CUENTAN como algo que corregir ─────────────
        // No estaban en esta lista, así que el encabezado decía «con algo que
        // corregir: 0» mientras la corrida acostado traía **23 toques sin
        // acuse** en Traslados — la lista entera. El número vivía en el JSON y
        // el resumen que lee una persona lo tapaba.
        //
        // Un resumen que no cuenta una dimensión que el instrumento SÍ mide es
        // peor que no medirla: promete que se miró.
        const malas = informe.filter(v => v.error || v.reventó || v.desbordePagina > 0
            || v.desbordan > 0 || v.tablas > 0 || v.zoomIOS > 0
            || v.chicos > 0 || v.sinAcuse > 0 || v.imposibles > 0 || v.tocarPerdido > 0);
        // Un cero se lee como «está todo bien», así que el encabezado tiene que
        // decir sobre cuántas vistas se midió DE VERDAD. Sin eso, «54 vistas · 0
        // por corregir» y «13 vistas · 0 por corregir» se imprimen igual — y la
        // segunda no es una respuesta sobre las 54.
        const conDatos = informe.filter(v => !v.sinDatos && !v.error);
        const sinDatos = informe.filter(v => v.sinDatos && !v.error);
        console.log(`\n╔══ ${informe.length} vistas · MEDIDAS ${conDatos.length} · con algo que corregir: ${malas.length} ══╗`);
        if (sinDatos.length) {
            const negadas = sinDatos.filter(v => v.sinAcceso);
            const vacias  = sinDatos.filter(v => !v.sinAcceso);
            console.log(`  ⚠ ${sinDatos.length} llegaron sin nada que medir. Su cero es del instrumento, no del portal.`);
            if (negadas.length) {
                console.log(`    · ${negadas.length} SIN ACCESO con esta cuenta — se arregla dándole el módulo:`);
                console.log(`      ${negadas.map(v => v.ruta).join(', ')}`);
            }
            if (vacias.length) {
                console.log(`    · ${vacias.length} SIN DATOS en este entorno — se arregla sembrando o corriendo fechas:`);
                console.log(`      ${vacias.map(v => v.ruta).join(', ')}`);
            }
        }
        console.log('  ruta'.padEnd(26) + 'tablas fichas desbP salen dedo zoom acuse imposib perdido');
        informe.forEach(v => {
            if (v.error) { console.log(`  ${v.ruta.padEnd(24)} (no cargó)`); return; }
            const mal = v.tablas > 0 || v.desbordePagina > 0 || v.desbordan > 0 || v.zoomIOS > 0
                || v.chicos > 0 || v.sinAcuse > 0 || v.imposibles > 0 || v.tocarPerdido > 0;
            console.log(`  ${mal ? '✗' : v.sinDatos ? '?' : '·'} ${v.ruta.padEnd(22)}`
                + String(v.tablas).padStart(6) + String(v.fichas).padStart(7)
                + String(v.desbordePagina).padStart(6) + String(v.desbordan).padStart(6)
                + String(v.chicos).padStart(5) + String(v.zoomIOS).padStart(5)
                + String(v.sinAcuse).padStart(6) + String(v.imposibles).padStart(8)
                + String(v.tocarPerdido ?? 0).padStart(8));
        });
        const rotas = informe.filter(v => v.reventó);
        console.log(`\n  REVENTADAS:               ${rotas.map(v => v.ruta).join(', ') || 'ninguna'}`);
        rotas.forEach(v => (v.error || []).forEach(e => console.log(`     ${v.ruta}: ${e}`)));
        console.log(`  con TABLA en el teléfono: ${informe.filter(v => v.tablas > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`  con desborde de página:   ${informe.filter(v => v.desbordePagina > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`  con inputs <16px:         ${informe.filter(v => v.zoomIOS > 0).map(v => v.ruta).join(', ') || 'ninguna'}`);
        console.log(`  con TOQUE PERDIDO:        ${informe.filter(v => v.tocarPerdido > 0).map(v => `${v.ruta}(${v.tocarPerdido})`).join(', ') || 'ninguna'}`);
        console.log(`╚════════════════════════════════════════════╝`);

        // Corta con ruido, no reporta. Un informe de 7 rutas se lee igual que
        // uno de 38 si nadie mira cuántas filas tiene, y «cero hallazgos sobre
        // 7 vistas» no es una respuesta sobre las 38.
        if (faltan.length) {
            console.log(`\n  ⚠️  BARRIDO INCOMPLETO — faltan ${faltan.length} de ${RUTAS.length}: ${faltan.join(', ')}`);
            console.log(`      El informe queda en ${INFORME_PARCIAL} (parcial, a propósito).`);
        }
        expect(faltan,
            `barrido incompleto: ${faltan.length} de ${RUTAS.length} rutas sin medir`)
            .toEqual([]);
    });
});
