import { test, expect } from '@playwright/test';

// Los cuatro gráficos que pasaron a `React.lazy` (v2.522.0), verificados en
// WebKit con viewport de iPhone 13 — que es donde vive el bug que hace falta
// descartar.
//
// ── Por qué este spec existe ─────────────────────────────────────────────
// `ChartContainer` envuelve todo gráfico del portal porque recharts entra en un
// bucle infinito («Maximum update depth exceeded») en WebKit móvil cuando un
// ancestro se está animando — y era INTERMITENTE: 3 de 5 corridas. Meter un
// `Suspense` cambia exactamente la variable de ese bug: cuándo se monta el
// gráfico respecto de las animaciones de entrada de las tarjetas. Antes el
// gráfico existía desde el primer render del padre; ahora aparece cuando llega
// el chunk, que puede caer en pleno stagger.
//
// Por eso esto se corre varias veces y no una: una corrida verde no distingue
// «arreglado» de «esta vez no tocó». Ver el encabezado de `ChartContainer.jsx`.
//
// Cada gráfico se comprueba por lo que DIBUJA (un `<svg>` de recharts con
// barras o líneas adentro), no por que el contenedor exista: un `Suspense` que
// nunca resuelve deja el div en su lugar y el esqueleto colgado para siempre,
// que es justo el modo de fallar que este cambio podría introducir.

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// El bucle de recharts se manifiesta como este error de React. Se escucha en la
// consola además de mirar el DOM: el ErrorBoundary puede tragárselo y dejar una
// pantalla que parece sana.
const BUCLE = /Maximum update depth exceeded/i;

async function entrar(page) {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

function vigilarConsola(page) {
    const errores = [];
    page.on('console', (m) => { if (BUCLE.test(m.text())) errores.push(m.text()); });
    page.on('pageerror', (e) => { if (BUCLE.test(String(e))) errores.push(String(e)); });
    return errores;
}

// El archivo se llama `*movil.spec.js` a propósito: es el patrón con el que
// `playwright.config.js` engancha el proyecto `webkit-movil`. Corre además en
// chromium de escritorio, que sirve de control — si el gráfico falla en los dos,
// no es del motor.
test.describe('Gráficos lazy', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    // Tres corridas del mismo recorrido. El bug que se descarta aparecía en 3 de
    // 5 intentos, así que repetir es parte de la prueba, no redundancia.
    for (const corrida of [1, 2, 3]) {
        test(`Metas · el «día por día» entra por Suspense y dibuja (corrida ${corrida})`, async ({ page }) => {
            const errores = vigilarConsola(page);
            await entrar(page);

            await page.goto('/metas');
            // El gráfico vive debajo de «Cómo va <mes>» y sólo aparece con el
            // mes en curso cargado; el `Suspense` corre en paralelo con ese RPC.
            const svg = page.locator('.recharts-surface').first();
            await expect(svg).toBeVisible({ timeout: 30_000 });
            // Que haya SUPERFICIE no basta: sin barras el gráfico está vacío.
            await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible({ timeout: 15_000 });

            // El esqueleto de espera no puede quedar colgado detrás del dibujo.
            await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 10_000 });
            expect(errores, `bucle de recharts en la corrida ${corrida}`).toEqual([]);
        });

        test(`Metas · el Histórico dibuja sus dos gráficas (corrida ${corrida})`, async ({ page }) => {
            const errores = vigilarConsola(page);
            await entrar(page);

            await page.goto('/metas?tab=historico');
            // Dos tarjetas: cumplimiento (línea) y meta contra venta (barras +
            // listones). Si el chunk no resuelve, no hay ninguna.
            await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 30_000 });
            await expect(page.locator('.recharts-line').first()).toBeVisible({ timeout: 15_000 });

            expect(errores, `bucle de recharts en la corrida ${corrida}`).toEqual([]);
        });
    }

    // Los otros dos gráficos del mismo cambio. Van una vez cada uno: comparten
    // el patrón ya ejercitado tres veces arriba, y lo que se comprueba acá es
    // que su punto de entrada concreto sigue llegando al dibujo.
    test('Sucursales · la pestaña Gastos dibuja la tendencia', async ({ page, isMobile }) => {
        // Sólo escritorio, y dicho de frente en vez de dejar el test en rojo:
        // en el teléfono la lista de sucursales ordena distinto, así que el
        // primer clic cae en una sucursal sin pestaña «Gastos» (sólo existe en
        // farmacias y bodega) y el test falla por navegación, no por el
        // gráfico. Lo que este spec vino a descartar —el bucle de recharts en
        // WebKit móvil— ya queda cubierto por las tres corridas de Metas y por
        // Horarios, que sí corren en el teléfono. Amarrar la sucursal por
        // nombre o por id ataría el test a datos de producción.
        test.skip(!!isMobile, 'El recorrido hasta la pestaña Gastos es de escritorio');

        const errores = vigilarConsola(page);
        await entrar(page);

        await page.goto('/branches');
        await page.locator('a[href^="/branches/"], [role="button"]').first().click();
        await expect(page).toHaveURL(/\/branches\/\d+/, { timeout: 20_000 });

        await page.getByRole('button', { name: /Gastos/i }).first().click();
        // Los EJES, no las barras: una sucursal sin pagos registrados da una
        // sola barra de altura cero, que recharts no pinta. Los ejes se dibujan
        // igual, así que son la señal de «el chunk llegó y recharts corrió» sin
        // depender de que esa sucursal tenga historial.
        await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.recharts-cartesian-axis').first()).toBeAttached({ timeout: 15_000 });
        // Y el esqueleto de la espera no puede quedar colgado detrás del dibujo.
        await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 10_000 });

        expect(errores, 'bucle de recharts en Gastos').toEqual([]);
    });

    test('Horarios · el análisis de la operación dibuja su heatmap', async ({ page }) => {
        const errores = vigilarConsola(page);
        await entrar(page);

        // Se entra por Horarios y no por el Inicio: acá el botón de expandir
        // lleva `title="Expandir Análisis"`, o sea nombre accesible. El del
        // Inicio es `iconOnly` sin título y no hay por dónde agarrarlo.
        await page.goto('/schedules');
        await page.getByRole('button', { name: /Expandir Análisis/i }).first()
            .click({ timeout: 30_000 });

        await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.recharts-cartesian-axis').first()).toBeAttached({ timeout: 20_000 });

        expect(errores, 'bucle de recharts en el análisis de la operación').toEqual([]);
    });
});
