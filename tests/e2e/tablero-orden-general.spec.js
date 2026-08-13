import { test, expect } from '@playwright/test';

// El tablero General se arma SOLO mientras la persona no lo haya acomodado.
//
// El bug que motivó esta prueba: `tabsAcomodadas` daba por acomodada cualquier
// pestaña que tuviera layout guardado, y ese layout lo escribe la app sola en la
// primera carga. Como sus posiciones se calculan sobre el catálogo COMPLETO,
// cada widget que esta persona no ve —por permiso o porque lo apagó en
// «Personalizar»— dejaba su hueco, para siempre. El único tablero sin huecos era
// el del superusuario, que los ve todos.
//
// ── Qué se mide, y por qué NO son renglones vacíos ────────────────────────
// La primera versión de esta prueba contaba renglones sin nada, y daba verde
// sobre el tablero roto: en la captura del reporte los renglones de arriba SÍ
// están ocupados —por un widget a la derecha— y el hueco son las tres columnas
// de la izquierda. El agujero es de CELDAS. Se cuentan celdas libres dentro del
// rectángulo que ocupa el tablero, sin contar el último renglón, que puede
// quedar a medias legítimamente.

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const GRID_COLS = 4;

async function entrar(page) {
    await page.goto('/login');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('#password').press('Enter');
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

// Fabrica un acomodo propio CON UN AGUJERO y marca la pestaña como acomodada:
// es la precondición tanto del control como de la prueba de «Restablecer».
// Se hace desde el navegador porque el id de usuario sale de la sesión de
// Supabase — hasta el 2026-08-13 salía de `portal_dash_layout_*_general`, que la
// app escribía sola en la primera carga y que el reinicio de General borra al
// entrar (ver `REINICIO_GENERAL` en `DashboardView.jsx`).
async function acomodarConHueco(page) {
    return page.evaluate(() => {
        const clave = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
        let id = null;
        try { id = JSON.parse(localStorage.getItem(clave))?.user?.id ?? null; } catch { id = null; }
        if (!id) return null;

        const pintado = {};
        document.querySelectorAll('[data-widget-id]').forEach(el => {
            const cs = getComputedStyle(el);
            const n = (v, def) => { const m = /-?\d+/.exec(v || ''); return m ? parseInt(m[0], 10) : def; };
            pintado[el.getAttribute('data-widget-id')] = { col: n(cs.gridColumnStart, 1), row: n(cs.gridRowStart, 1) };
        });
        const ids = Object.keys(pintado);
        if (ids.length < 2) return null;
        // El que está más arriba a la izquierda: correrlo tres filas deja el
        // hueco en el primer renglón, que es donde se ve.
        const victima = ids.sort((a, b) => (pintado[a].row - pintado[b].row) || (pintado[a].col - pintado[b].col))[0];
        pintado[victima] = { ...pintado[victima], row: pintado[victima].row + 3 };

        localStorage.setItem(`portal_dash_layout_${id}_general`, JSON.stringify(pintado));
        localStorage.setItem(`portal_dash_acomodada_${id}_general`, '1');
        return id;
    });
}

// La huella del tablero pintado: qué widget, dónde y de qué tamaño. Sirve para
// comparar dos tableros sin depender del orden en que el DOM los devuelve.
const huella = (celdas) => celdas
    .map(c => `${c.id}@${c.col},${c.row}:${c.cols}x${c.rows}`)
    .sort()
    .join(' ');

async function medirTablero(page) {
    await page.waitForSelector('[data-widget-id]', { timeout: 20_000 });
    // Las baldosas `sales_branch_*` entran cuando responde su consulta; sin esta
    // espera se mide un tablero a medio poblar.
    await page.waitForTimeout(3_000);

    const celdas = await page.$$eval('[data-widget-id]', els => els.map(el => {
        const cs = getComputedStyle(el);
        const n = (v, def) => { const m = /-?\d+/.exec(v || ''); return m ? parseInt(m[0], 10) : def; };
        return {
            id:   el.getAttribute('data-widget-id'),
            col:  n(cs.gridColumnStart, 1),
            row:  n(cs.gridRowStart, 1),
            cols: n(cs.gridColumnEnd, 1),
            rows: n(cs.gridRowEnd, 1),
        };
    }));

    const ocupadas = new Set();
    for (const c of celdas) {
        for (let r = c.row; r < c.row + Math.max(c.rows, 1); r++)
            for (let k = c.col; k < c.col + Math.max(c.cols, 1); k++)
                ocupadas.add(`${k}:${r}`);
    }
    const ultimo = Math.max(...celdas.map(c => c.row + Math.max(c.rows, 1) - 1));

    // Sólo los renglones COMPLETOS: el último puede quedar a medias.
    const libres = [];
    for (let r = 1; r < ultimo; r++)
        for (let k = 1; k <= GRID_COLS; k++)
            if (!ocupadas.has(`${k}:${r}`)) libres.push(`c${k}r${r}`);

    return { celdas, ultimo, libres };
}

test.describe('Tablero General — acomodo automático', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('sin acomodo propio no quedan celdas libres', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        const { celdas, ultimo, libres } = await medirTablero(page);

        console.log(`ARREGLADO · widgets: ${celdas.length} · alto: ${ultimo} · celdas libres: ${libres.length} [${libres.join(' ')}]`);
        await page.screenshot({ path: process.env.SHOT || 'tablero-general.png', fullPage: true });

        expect(libres, `celdas libres: ${libres.join(' ')}`).toEqual([]);
    });

    // El CONTROL, sobre el MISMO build y los MISMOS datos: se guarda un acomodo
    // con un agujero y se marca la pestaña como acomodada, con lo que el tablero
    // deja de armarse solo y pinta lo guardado. Sin este caso, el verde de
    // arriba no distingue «lo arreglé» de «acá nunca hubo huecos».
    //
    // El control **se fabrica su propia precondición** y no la toma prestada del
    // `localStorage`. Hasta el 2026-08-13 leía el id de usuario de la clave
    // `portal_dash_layout_*_general`, que la app escribía sola en la primera
    // carga; desde el reinicio de General esa clave se borra al entrar, así que
    // el control se quedó sin de dónde sacar el id y falló por su andamiaje, no
    // por el tablero. El id sale ahora de la sesión de Supabase, que existe
    // siempre que haya alguien adentro.
    //
    // El agujero se hace corriendo UN widget tres filas hacia abajo: deja su
    // celda vacía en medio del rectángulo, que es exactamente la forma del bug
    // que esta prueba vigila.
    test('CONTROL · con la pestaña marcada, el layout guardado deja huecos', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        await page.waitForSelector('[data-widget-id]', { timeout: 20_000 });
        await page.waitForTimeout(3_000);

        const uid = await acomodarConHueco(page);
        expect(uid, 'no se pudo fabricar el acomodo con hueco: el control no controlaría nada').not.toBeNull();

        await page.reload();
        const { celdas, ultimo, libres } = await medirTablero(page);

        console.log(`CONTROL · widgets: ${celdas.length} · alto: ${ultimo} · celdas libres: ${libres.length} [${libres.join(' ')}]`);
        await page.screenshot({ path: process.env.SHOT_CONTROL || 'tablero-control.png', fullPage: true });

        // Se espera que SÍ haya huecos: es el tablero de antes del arreglo.
        expect(libres.length, 'el control no reprodujo el hueco').toBeGreaterThan(0);
    });

    // «Restablecer» tiene que devolver EXACTAMENTE el tablero de quien nunca
    // movió nada — pedido del usuario el 2026-08-13, y hasta ese día no lo hacía:
    // borraba el acomodo pero no la marca de «acomodada», así que la pestaña
    // seguía pintándose con posiciones guardadas y quedaba agujereada. Un botón
    // que dice restablecer y devuelve otra cosa.
    //
    // Se compara la HUELLA de los dos tableros, no sólo la ausencia de huecos:
    // un tablero distinto también puede estar lleno, y lo que se promete es que
    // sea el mismo.
    test('Restablecer devuelve el tablero automático', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        const automatico = await medirTablero(page);
        expect(automatico.libres, 'el tablero de partida ya venía con huecos').toEqual([]);

        const uid = await acomodarConHueco(page);
        expect(uid, 'no se pudo fabricar el acomodo con hueco').not.toBeNull();
        await page.reload();
        const desacomodado = await medirTablero(page);
        expect(desacomodado.libres.length, 'no se llegó a desacomodar: nada que restablecer').toBeGreaterThan(0);

        await page.getByRole('button', { name: /Personalizar/i }).click();
        await page.getByRole('button', { name: /Restablecer/i }).click();
        await page.waitForTimeout(1_500);
        const restablecido = await medirTablero(page);

        console.log(`RESTABLECER · huecos antes: ${desacomodado.libres.length} · después: ${restablecido.libres.length}`);
        expect(restablecido.libres, `celdas libres: ${restablecido.libres.join(' ')}`).toEqual([]);
        expect(huella(restablecido.celdas)).toBe(huella(automatico.celdas));

        // Y no vuelve al acomodo viejo en la siguiente carga: la marca se borró.
        await page.reload();
        const trasRecargar = await medirTablero(page);
        expect(huella(trasRecargar.celdas)).toBe(huella(automatico.celdas));
    });

    // Entrar al tablero es entrar a General (2026-08-13). La pestaña abierta se
    // recordaba entre sesiones, así que quien miró Operación una vez volvía a
    // encontrarse ahí semanas después.
    //
    // Qué pestaña está abierta se comprueba por lo que está PINTADO y no por el
    // botón: la barra de pestañas canónica marca la activa sólo con clases, sin
    // `aria-selected` ni `aria-pressed`, así que preguntarle al DOM cuál está
    // activa devuelve la lista entera. `trend` (Tendencia de asistencia) es de
    // General y no está en Operación: su presencia es la firma de la pestaña.
    test('al entrar, la pestaña abierta es siempre General', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        await page.waitForSelector('[data-widget-id]', { timeout: 20_000 });

        const hayTendencia = () => page.locator('[data-widget-id="trend"]').count();
        expect(await hayTendencia(), 'no se arrancó en General').toBeGreaterThan(0);

        await page.getByRole('button', { name: /^Operación$/i }).click();
        await page.waitForTimeout(1_500);
        expect(await hayTendencia(), 'el clic no cambió de pestaña: la prueba no probaría nada').toBe(0);

        await page.reload();
        await page.waitForSelector('[data-widget-id]', { timeout: 20_000 });
        await page.waitForTimeout(1_500);
        expect(await hayTendencia(), 'la recarga no volvió a General').toBeGreaterThan(0);
    });

    // El reinicio de General de una sola pasada: quien llega con un acomodo
    // propio de antes del 2026-08-13 lo pierde y vuelve al automático. Se simula
    // borrando la marca del reinicio, que es lo que distingue «este navegador ya
    // lo aplicó» de «viene de antes».
    test('el reinicio de General borra el acomodo viejo una sola vez', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        const automatico = await medirTablero(page);

        const uid = await acomodarConHueco(page);
        expect(uid).not.toBeNull();
        await page.evaluate(id => localStorage.removeItem(`portal_dash_reinicio_general_${id}`), uid);

        await page.reload();
        const tras = await medirTablero(page);
        expect(tras.libres, 'el reinicio no devolvió el tablero automático').toEqual([]);
        expect(huella(tras.celdas)).toBe(huella(automatico.celdas));

        // Y quedó anotado, así que no se repite: el acomodo que se guarde a
        // partir de acá sobrevive a la siguiente carga.
        const anotado = await page.evaluate(id => localStorage.getItem(`portal_dash_reinicio_general_${id}`), uid);
        expect(anotado, 'sin la anotación, el reinicio borraría el acomodo en cada carga').toBeTruthy();

        await acomodarConHueco(page);
        await page.reload();
        const conAcomodoPropio = await medirTablero(page);
        expect(conAcomodoPropio.libres.length, 'el reinicio volvió a correr y pisó el acomodo propio').toBeGreaterThan(0);
    });
});
