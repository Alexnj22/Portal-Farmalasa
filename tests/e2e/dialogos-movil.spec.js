import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import { MEDIR } from './medicion-movil.js';

/**
 * Barrido de DIÁLOGOS en el teléfono — F3 de `docs/PLAN-MOVIL-2026-08-20.md`.
 *
 * ── Por qué hace falta otro barrido ──────────────────────────────────────────
 * `barrido-total-movil` mide las VISTAS y, con `MODALES=1`, exactamente dos
 * cosas por ruta: la hoja de la primera ficha y el primer botón del clúster
 * flotante. Pero **41 archivos de vista declaran diálogos y hay 40 componentes
 * de formulario**, y un formulario de empleado, uno de sucursal o el editor de
 * una boleta nunca se abrieron en 390px en una medición.
 *
 * Es la superficie más grande sin mirar, y es donde el defecto duele más: un
 * formulario que no entra no es incómodo, es **trabajo perdido** — el portal
 * cierra la sesión sola a los 5 minutos en los cargos de sala.
 *
 * ── EL FRENO, que es la parte importante ─────────────────────────────────────
 * Esto corre contra PRODUCCIÓN y **abre cosas apretando botones de verdad**. La
 * regla es que abrir no puede escribir:
 *
 *  1. Sólo se aprieta lo que coincide con `ABRE` — verbos que abren un panel.
 *  2. Nunca se aprieta lo que coincide con `NO_TOCAR`, y esa lista GANA sobre
 *     la primera: «Anular» tiene «anul» y no se toca aunque el rótulo diga
 *     «Ver anulación».
 *  3. Adentro del diálogo **no se toca nada**: se mide y se cierra con Escape.
 *     No se escribe, no se envía, no se confirma.
 *  4. Un botón sin nombre accesible no se aprieta. Si no se puede leer qué
 *     hace, no se puede saber que es seguro.
 *
 * La lista de `NO_TOCAR` está escrita hacia el lado seguro a propósito: perder
 * la medición de un diálogo es un hueco, y apretar «Sincronizar» en producción
 * es un incidente. Ante la duda, no se toca.
 */

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const SALIDA_INFORMES = 'barridos';
const ETIQUETA = process.env.ETIQUETA || 'dialogos';
const INFORME = `${SALIDA_INFORMES}/informe-${ETIQUETA}.json`;
const INFORME_PARCIAL = `${SALIDA_INFORMES}/informe-${ETIQUETA}.parcial.json`;

// Verbos que ABREN algo. Deliberadamente cortos: `nuev` cubre «Nuevo» y «Nueva».
const ABRE = /(nuev|agregar|añadir|editar|ver\b|detalle|abrir|configur|ajust|filtr|solicit|cargar|registrar|asignar|planificar|crear)/i;

// Y lo que NO se toca jamás. Gana sobre `ABRE`.
//
// Cada familia está por un motivo distinto:
//   · escribe o borra en la base (anular, eliminar, publicar, guardar)
//   · habla con un sistema externo (enviar, sincronizar, transmitir, imprimir)
//   · dispara un cálculo caro sobre todo el catálogo (recalcular, calcular)
//   · cierra sesión y se lleva el barrido con ella
const NO_TOCAR = /(anul|elimin|borrar|quitar|descart|publicar|guardar|enviar|sincroniz|transmit|imprim|recalcul|calcular|confirm|aprob|rechaz|despach|salir|cerrar sesi|firmar|pagar|liquidar|fusionar|reintent|restaurar|generar|exportar|descargar)/i;

const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map(r => r.trim()) : [
    'staff', 'branches', 'clientes', 'proveedores', 'productos', 'payroll',
    'cotizaciones', 'facturacion', 'facturas-compra', 'pedidos', 'minmax',
    'requests', 'vacation-plan', 'announcements', 'metas', 'roles', 'overview',
];

// Cuántos disparadores por ruta. Acota el tiempo, y lo que quede afuera se
// ANOTA: un tope silencioso se lee como «se midió todo».
const TOPE = Number(process.env.TOPE_DIALOGOS || 8);

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

test.describe('Diálogos · WebKit iPhone 13', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('los diálogos en 390px', async ({ page }) => {
        test.setTimeout(Number(process.env.TIMEOUT_MS) || 2_700_000);
        fs.mkdirSync(SALIDA_INFORMES, { recursive: true });

        let pg = page;
        const errores = [];
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

        if (!await ingresar(pg)) {
            throw new Error('No se pudo iniciar sesión: el barrido habría medido el login.');
        }
        pg.on('pageerror', e => errores.push(e.message.slice(0, 200)));

        // Mismo motivo que en `barrido-total-movil`: WebKit reparte varias
        // páginas del mismo contexto en un proceso de contenido, y ese proceso
        // es el que se pasa de su techo. Un contexto nuevo es un proceso nuevo.
        const reciclarContexto = async () => {
            const navegador = pg.context().browser();
            if (!navegador) return;
            const viejo = pg.context();
            const ctx = await navegador.newContext({ ...APARATO });
            pg = await ctx.newPage();
            pg.on('pageerror', e => errores.push(e.message.slice(0, 200)));
            await viejo.close().catch(() => {});
            if (!await ingresar(pg)) throw new Error('Tras reciclar el contexto no se pudo volver a entrar.');
        };

        const informe = [];
        const guardar = () => fs.writeFileSync(INFORME_PARCIAL, JSON.stringify(informe, null, 1));

        for (const [indice, ruta] of RUTAS.entries()) {
            if (indice > 0 && indice % 5 === 0) await reciclarContexto();
            await pg.goto('about:blank').catch(() => {});
            await pg.goto('/' + ruta).catch(() => {});
            await pg.waitForTimeout(1500);
            await pg.waitForFunction(
                () => document.querySelectorAll('button, [role="button"]').length > 4,
                null, { timeout: 25_000 },
            ).catch(() => {});
            await pg.waitForTimeout(2500);

            // Los disparadores se eligen POR NOMBRE, en el navegador, y se
            // devuelven como índices estables dentro de la lista de botones
            // visibles: un `Locator` guardado se invalida en cuanto el DOM se
            // mueve, y acá el DOM se mueve en cada apertura.
            const candidatos = await pg.evaluate(({ abre, noTocar }) => {
                const rAbre = new RegExp(abre, 'i');
                const rNo = new RegExp(noTocar, 'i');
                const vis = el => {
                    const b = el.getBoundingClientRect();
                    if (!b.width || !b.height) return false;
                    for (let p = el; p; p = p.parentElement) {
                        const cs = getComputedStyle(p);
                        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
                    }
                    return true;
                };
                // El MARCO no se toca. El menú lateral, el encabezado y el
                // clúster flotante están llenos de rótulos que pasan el filtro
                // —«Solicitudes», «Ajustes», «Abrir el menú»— y ninguno abre un
                // diálogo: navegan. Y navegar es peor que no medir, porque deja
                // al resto de la ruta apretando índices de otra pantalla.
                // El clúster flotante SÍ entra: en el teléfono es donde viven
                // las acciones de la vista —«Nuevo empleado» está ahí— y
                // excluirlo tiraba las acciones junto con la navegación, que es
                // justo lo que este barrido viene a medir.
                const enElMarco = el => !!el.closest(
                    'nav, [role="navigation"], header, aside, [data-sidebar]');
                // Y por NOMBRE los que el marco no atrapa: el botón del menú
                // vive en el cuerpo en algunas vistas y nunca abre un diálogo.
                const DEL_MARCO = /(abrir el men|cerrar el men|volver|atr[áa]s|notificaci|perfil|tema)/i;
                const out = [];
                const todos = [...document.querySelectorAll('button, [role="button"]')];
                todos.forEach((el, i) => {
                    if (!vis(el)) return;
                    if (enElMarco(el)) return;
                    // La ficha de una lista ya la mide `barrido-total-movil`
                    // con `MODALES=1`, y su «nombre» es el texto entero de la
                    // tarjeta. Medirla acá duplica el hallazgo y gasta el tope.
                    if (el.matches('[data-surface="card"]')) return;
                    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
                    const nombre = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
                    if (!nombre) return;                  // sin nombre no se sabe qué hace: no se toca
                    if (rNo.test(nombre)) return;         // la lista de freno gana
                    if (DEL_MARCO.test(nombre)) return;
                    if (!rAbre.test(nombre)) return;
                    // Lo que se declara como disparador de diálogo va primero:
                    // es el único caso donde no hay que adivinar.
                    const seguro = el.getAttribute('aria-haspopup') === 'dialog' ? 0 : 1;
                    out.push({ i, seguro, nombre: nombre.slice(0, 40) });
                });
                // Un nombre, una medición. Sucursales daba **32 candidatos que
                // son 4 diálogos**: la misma tarjeta repetida por sucursal. Sin
                // deduplicar, el tope se gastaba midiendo «Ajustes generales»
                // cinco veces y las otras rutas no llegaban a correrse.
                const vistos = new Set();
                return out.sort((a, b) => a.seguro - b.seguro)
                    .filter(c => !vistos.has(c.nombre) && vistos.add(c.nombre));
            }, { abre: ABRE.source, noTocar: NO_TOCAR.source });

            console.log(`\n══ ${ruta}: ${candidatos.length} candidato(s): ${candidatos.map(c => c.nombre).join(' | ').slice(0, 220)}`);
            const usar = candidatos.slice(0, TOPE);
            const descartados = candidatos.length - usar.length;

            const urlBase = pg.url();
            const camposAntes = await pg.locator('input, textarea, select').count();
            for (const c of usar) {
                errores.length = 0;
                // ── Primero el clic de VERDAD, y `el.click()` sólo de respaldo
                //
                // La primera versión usaba `el.click()` en el navegador para
                // esquivar la espera de accionabilidad de Playwright: en el
                // teléfono el clúster flotante y el aviso de «agregar a inicio»
                // tapan media pantalla, y «Nueva Cotización» fallaba por tiempo
                // aunque exista y se pueda apretar.
                //
                // **Pero `el.click()` sólo dispara `click`.** Un control que
                // responde a eventos de PUNTERO no se entera — y así se perdía
                // «Nuevo empleado», que es un botón del clúster flotante y es el
                // formulario más largo del portal. El barrido lo reportaba como
                // «no abrió nada», o sea que el hueco parecía del portal cuando
                // era del instrumento. Tercera vez en este plan que pasa eso.
                //
                // Ahora se intenta el clic real —que dispara la secuencia
                // completa de punteros— y sólo si Playwright lo rechaza por
                // accionabilidad se cae al `el.click()`. Acá no se está probando
                // si el botón se deja apretar —eso lo mide `chicos`/`imposibles`
                // del barrido de vistas—: se está ABRIENDO un diálogo para
                // medirlo, y el elemento se eligió por identidad.
                // ── El índice se REVUELVE por nombre, justo antes de apretar
                // Los candidatos se enumeran una vez por ruta, pero el DOM se
                // mueve con cada apertura y con cada cierre: el carrusel de
                // tarjetas avanza, una lista se re-filtra. Con el índice viejo,
                // `nth(i)` termina apuntando a OTRO elemento — y si ese otro
                // está tapado, el barrido reporta «no abrió» sobre un botón que
                // nunca apretó. Así se perdía «Nuevo empleado» después de tocar
                // el carrusel de arriba.
                const idx = await pg.evaluate((nombre) => {
                    const els = [...document.querySelectorAll('button, [role="button"]')];
                    return els.findIndex(el =>
                        (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
                            .trim().slice(0, 40) === nombre);
                }, c.nombre).catch(() => -1);
                if (idx < 0) {
                    console.log(`   – «${c.nombre}» ya no está en el DOM`);
                    continue;
                }

                let apreto = true;
                try {
                    await pg.locator('button, [role="button"]').nth(idx).click({ timeout: 4000 });
                } catch {
                    apreto = await pg.evaluate((i) => {
                        const el = [...document.querySelectorAll('button, [role="button"]')][i];
                        if (!el) return false;
                        el.click();
                        return true;
                    }, idx).catch(() => false);
                    if (apreto) console.log(`   · «${c.nombre}» tapado: se apretó desde la página`);
                }
                if (!apreto) {
                    console.log(`   – «${c.nombre}» ya no está en el DOM`);
                    continue;
                }
                // Esperar a la CONDICIÓN, no al reloj. Los formularios pesados
                // llegan por `await import()` —es la regla del proyecto para
                // toda librería grande—, así que el diálogo aparece cuando bajó
                // su chunk, no a los 2 segundos. Con espera fija, «Nuevo
                // empleado» daba «no abrió nada» y el hueco parecía del portal.
                await pg.waitForFunction(
                    (antes) => document.querySelector('[role="dialog"]')
                        || document.querySelectorAll('input, textarea, select').length > antes + 2,
                    camposAntes, { timeout: 4000 },
                ).catch(() => {});
                await pg.waitForTimeout(900);
                // Si el clic NAVEGÓ, los índices siguientes son de otra
                // pantalla. Se vuelve y se sigue: medir la ruta equivocada es
                // peor que perder un disparador.
                if (pg.url() !== urlBase) {
                    console.log(`   – «${c.nombre}» navegó en vez de abrir`);
                    await pg.goto(urlBase).catch(() => {});
                    await pg.waitForTimeout(2500);
                    continue;
                }
                // ── «Abrió» no siempre es `role="dialog"` ────────────────
                // Varias pantallas del portal no abren un diálogo: **cambian de
                // modo dentro de la misma vista**. «Nueva Cotización» y el
                // detalle de una cotización son eso, y son justamente
                // formularios largos —los que este barrido viene a medir—.
                // Medir sólo `role="dialog"` los dejaba a todos afuera.
                //
                // El segundo signo es que aparecieron CONTROLES DE CAPTURA que
                // antes no estaban: es lo que define a un formulario, y es la
                // misma cuenta que usa `gate:borradores` para decir «largo».
                const camposAhora = await pg.locator('input, textarea, select').count();
                const dialogo = await pg.locator('[role="dialog"]').count();
                const abierto = dialogo > 0 || camposAhora > camposAntes + 2;
                if (!abierto) {
                    console.log(`   – «${c.nombre}» no abrió nada (campos ${camposAntes}→${camposAhora})`);
                    await pg.keyboard.press('Escape').catch(() => {}); continue;
                }
                console.log(`   ✓ «${c.nombre}» abrió (${dialogo ? 'diálogo' : `modo de vista, ${camposAhora} campos`})`);

                const m = await pg.evaluate(MEDIR).catch(() => null);
                if (m) {
                    informe.push({
                        ruta: `${ruta}»${c.nombre}`, ...m.totales,
                        desbordePagina: m.desbordePagina,
                        grupos: m.grupos, imposibles: m.imposibles,
                        error: errores.length ? [...errores] : undefined,
                    });
                    guardar();
                }
                await pg.keyboard.press('Escape').catch(() => {});
                await pg.waitForTimeout(900);
                // Un diálogo que no cierra con Escape —o un MODO de vista, que
                // no tiene por qué cerrarse con Escape— deja al resto de la ruta
                // midiendo lo que hay encima. Se recarga y se sigue.
                const sigueAbierto = (await pg.locator('[role="dialog"]').count())
                    || (await pg.locator('input, textarea, select').count()) > camposAntes + 2;
                if (sigueAbierto) {
                    await pg.goto('/' + ruta).catch(() => {});
                    await pg.waitForTimeout(2500);
                }
            }
            if (descartados > 0) {
                console.log(`   · ${ruta}: ${descartados} disparador(es) por encima del tope de ${TOPE}`);
            }
        }

        fs.writeFileSync(INFORME_PARCIAL, JSON.stringify(informe, null, 1));
        fs.renameSync(INFORME_PARCIAL, INFORME);

        const malas = informe.filter(v => v.desbordePagina > 0 || v.desbordan > 0 || v.zoomIOS > 0 || v.chicos > 0 || v.imposibles > 0);
        console.log(`\n╔══ ${informe.length} diálogos · con algo que corregir: ${malas.length} ══╗`);
        console.log('  diálogo'.padEnd(46) + 'desbP salen dedo zoom imposib');
        informe.forEach(v => {
            const mal = v.desbordePagina > 0 || v.desbordan > 0 || v.zoomIOS > 0 || v.chicos > 0 || v.imposibles > 0;
            console.log(`  ${mal ? '✗' : '·'} ${v.ruta.slice(0, 42).padEnd(43)}`
                + String(v.desbordePagina).padStart(5) + String(v.desbordan).padStart(6)
                + String(v.chicos).padStart(5) + String(v.zoomIOS).padStart(5)
                + String(v.imposibles).padStart(8));
        });
        console.log(`╚═══════════════════════════════════════════════════════════╝`);

        // Que se hayan abierto CERO diálogos no es «todo bien»: es que el
        // instrumento no encontró nada que abrir. Mismo agujero que el login.
        expect(informe.length, 'no se abrió ningún diálogo: el barrido no midió nada').toBeGreaterThan(0);
    });
});
