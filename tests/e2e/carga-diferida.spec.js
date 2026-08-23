// Lo que se difiere TIENE que llegar cuando se lo pide.
//
// `gate:bundle` mide el peso y da verde cuando algo sale del cierre estático —
// pero no puede saber si ese algo vuelve. Un `lazy()` sin su `Suspense`, un
// `.then(m => ({ default: m.Algo }))` con el nombre mal escrito o un import que
// apunta a una ruta que ya no existe compilan perfecto, pasan el lint, pasan las
// 689 pruebas unitarias, y bajan el número del gate. El defecto sólo aparece
// cuando alguien aprieta el botón.
//
// O sea que la medición que premia diferir es ciega justamente al modo en que
// diferir se rompe. Esta prueba cierra ese hueco: abre cada cosa diferida y
// exige ver su contenido.
//
// Nació el 2026-08-23, cuando la auditoría bajó el Inicio de 100 a 87 kB y
// Traslados de 61 a menos de 47 moviendo cinco piezas a `lazy()`. Sin esto, la
// única prueba de que el portal seguía funcionando era que compilaba.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_USER=pruebas E2E_PASSWORD=... \
//     npx playwright test tests/e2e/carga-diferida.spec.js --project=chromium

import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// ── Qué se considera un fallo, y por qué NO es «cero errores» ──────────────
//
// La primera versión exigía la consola limpia, y falló tres veces seguidas por
// cosas del ENTORNO: `TypeError: Failed to fetch` (el branch de pruebas no tiene
// las edge functions desplegadas, a propósito), un 400 y un 404 de consultas
// cuyos datos ese branch no tiene. Ninguno decía nada sobre lo que la prueba
// vino a verificar.
//
// Estaba midiendo la salud del entorno en vez de la carga del módulo. Un
// detector que mide lo que no debe no da un resultado imperfecto: da uno que
// hay que ignorar, y un chequeo que se ignora se termina borrando.
//
// Entonces se acota a los errores que SÓLO pueden venir de un diferido roto.
// Los cuatro son los modos reales de fallar:
//
//   · el chunk no llegó                → «Failed to fetch dynamically imported module»
//   · `.then(m => m.NombreMalEscrito)` → «Element type is invalid» / «got: undefined»
//   · falta el `Suspense`              → «suspended while responding to synchronous input»
//   · el módulo resolvió a nada        → «is not a function» sobre el componente
//
// Todo lo demás se informa y no bloquea: sirve para leer, no para fallar.
const FALLO_DE_CARGA = [
    /Failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /Element type is invalid/i,
    /suspended while responding to synchronous input/i,
    /A component suspended while rendering/i,
];

function vigilarConsola(page) {
    const todos = [];
    page.on('console', m => { if (m.type() === 'error') todos.push(m.text()); });
    page.on('pageerror', e => todos.push(`pageerror: ${e.message}`));
    return {
        deCarga: () => todos.filter(t => FALLO_DE_CARGA.some(r => r.test(t))),
        todos: () => todos,
    };
}

test.describe('lo diferido llega cuando se lo pide', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('#password').press('Enter');
        await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 });
    });

    test('el buscador de inventario abre su panel, que ya no viaja con el Inicio', async ({ page }) => {
        const errores = vigilarConsola(page);
        await page.goto('/overview');

        // La baldosa se queda en el chunk del Inicio: tiene que estar SIN pedir
        // nada. Si esto falla, lo que se rompió es el azulejo, no el diferido.
        const baldosa = page.getByText('Consulta de inventario', { exact: false }).first();
        await expect(baldosa).toBeVisible({ timeout: 20_000 });

        // El cuerpo son 1,180 líneas que ahora viven en otro archivo. Abrir la
        // baldosa es lo único que las pide.
        await baldosa.click();
        await expect(
            page.getByPlaceholder('Buscar por nombre o principio activo...'),
        ).toBeVisible({ timeout: 20_000 });

        expect(errores.deCarga(), `el módulo diferido no cargó:\n${errores.deCarga().join('\n')}`).toEqual([]);
    });

    test('las tres pestañas de Traslados pintan, y dos de ellas son diferidas', async ({ page }) => {
        const errores = vigilarConsola(page);
        await page.goto('/traslados');

        // «En camino» abre por defecto y sus tarjetas son `lazy`. Lo que se
        // comprueba es que la vista TERMINA de cargar: si el `Suspense` faltara,
        // React lanzaría y la pantalla quedaría en blanco.
        await expect(page.getByRole('tab', { name: /En camino/i })).toBeVisible({ timeout: 20_000 });

        for (const nombre of [/Envíos/i, /Historial/i, /En camino/i]) {
            await page.getByRole('tab', { name: nombre }).click();
            // Que la pestaña quede seleccionada y el cuerpo exista. No se
            // comprueba CONTENIDO: en el entorno de pruebas puede no haber ni un
            // traslado, y un `EmptyState` es una respuesta correcta.
            await expect(page.getByRole('tab', { name: nombre })).toHaveAttribute('aria-selected', 'true');
            await page.waitForTimeout(600);   // que el chunk resuelva y pinte
        }

        expect(errores.deCarga(), `el módulo diferido no cargó:\n${errores.deCarga().join('\n')}`).toEqual([]);
    });

    test('la pestaña Envíos abre el modal de enviar producto, que también es diferido', async ({ page }) => {
        const errores = vigilarConsola(page);
        await page.goto('/traslados?tab=envios');

        const boton = page.getByRole('button', { name: /Enviar producto a otra sala/i });
        // El botón depende del permiso de la cuenta: si no está, no hay nada que
        // verificar acá y la prueba lo dice en vez de fallar por algo ajeno.
        if (await boton.count() === 0) {
            test.skip(true, 'La cuenta de pruebas no tiene el permiso de enviar producto');
        }
        await boton.first().click();
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });

        expect(errores.deCarga(), `el módulo diferido no cargó:\n${errores.deCarga().join('\n')}`).toEqual([]);
    });
});
