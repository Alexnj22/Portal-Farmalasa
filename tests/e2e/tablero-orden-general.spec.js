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

    // El CONTROL, sobre el MISMO build y los MISMOS datos: se marca la pestaña
    // como acomodada a mano, con lo que el tablero vuelve a usar el layout
    // guardado —el que se calculó sobre el catálogo completo— y los widgets
    // apagados dejan su hueco. Sin este caso, el verde de arriba no distingue
    // «lo arreglé» de «acá nunca hubo huecos».
    //
    // La marca se escribe DESPUÉS de la primera carga del tablero, que es cuando
    // ya existe la clave de la que sale el id de usuario. Escribirla antes la
    // dejaba en `guest` y el control no controlaba nada — dio verde y por un
    // momento pareció que el bug no existía.
    test('CONTROL · con la pestaña marcada, el layout guardado deja huecos', async ({ page }) => {
        await entrar(page);
        await page.goto('/');
        await page.waitForSelector('[data-widget-id]', { timeout: 20_000 });
        await page.waitForTimeout(3_000);

        const uid = await page.evaluate(() => {
            const k = Object.keys(localStorage).find(x => /^portal_dash_layout_.+_general$/.test(x));
            if (!k) return null;
            const uid = k.replace(/^portal_dash_layout_/, '').replace(/_general$/, '');
            localStorage.setItem(`portal_dash_acomodada_${uid}_general`, '1');
            return uid;
        });
        expect(uid, 'no se encontró la clave del layout: el control no controlaría nada').not.toBeNull();

        await page.reload();
        const { celdas, ultimo, libres } = await medirTablero(page);

        console.log(`CONTROL · widgets: ${celdas.length} · alto: ${ultimo} · celdas libres: ${libres.length} [${libres.join(' ')}]`);
        await page.screenshot({ path: process.env.SHOT_CONTROL || 'tablero-control.png', fullPage: true });

        // Se espera que SÍ haya huecos: es el tablero de antes del arreglo.
        expect(libres.length, 'el control no reprodujo el hueco').toBeGreaterThan(0);
    });
});
