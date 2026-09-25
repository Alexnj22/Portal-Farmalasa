// «Crear ruta» guarda lo que la ruta mide DESPUÉS de reordenarla.
//
// 2026-09-25: subir, bajar o quitar una parada la renumeraba y nada más. Cada
// parada se quedaba con la distancia desde la que tenía ANTES del cambio, y eso
// es lo que se guardaba con la ruta: el tramo de cada parada y los totales
// (`p_distancia_total_m`, `p_duracion_min`). Esta prueba reordena y compara lo
// que se MANDA a la base contra lo que se calcula por su cuenta desde las
// coordenadas de cada sala.
//
// Corre contra el ENTORNO DE PRUEBAS, con los pedidos de
// `scripts/entorno-pruebas/semilla_pedidos_ruta.sql` (correrla antes: deja los
// dos pedidos disponibles otra vez). Google Maps se BLOQUEA a propósito: sin
// él las distancias son en línea recta, y ésas se pueden calcular exactas acá.
// Las de carretera las cubre el enfrentamiento de `rutaArmado.test.js`.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// `branches.settings.location` del entorno de pruebas (copia de producción),
// por `erp_sucursal_id`. La 6 es la bodega.
const COORDS = {
    1: { lat: 14.040614677110216, lng: -88.93690718535933 },
    2: { lat: 14.043229, lng: -88.935683 },
    4: { lat: 14.106492047689937, lng: -89.06847091966127 },
    5: { lat: 14.18625339790212, lng: -89.22778604630774 },
    6: { lat: 14.041176958447284, lng: -88.96311126213165 },
    7: { lat: 14.128001164569541, lng: -89.29326452325331 },
};

// Calculado aparte, sin importar el código del portal: si el portal y la
// prueba compartieran la función, un error en ella daría verde en los dos.
const rad = (d) => (d * Math.PI) / 180;
function metros(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const tramo = (a, b) => {
    const d = metros(a, b);
    return { dist_m: Math.round(d), dur_min: Math.max(1, Math.round((d / 1000 / 40) * 60)) };
};

async function entrar(page) {
    await page.goto('/login');
    await page.waitForTimeout(2000);
    for (let intento = 0; intento < 4; intento++) {
        await page.locator('#username').fill('');
        await page.locator('#username').fill(E2E_USER);
        await page.waitForTimeout(400);
        await page.locator('#password').fill('');
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.waitForTimeout(400);
        if (await page.locator('#username').inputValue() === E2E_USER
            && await page.locator('#password').inputValue() === E2E_PASSWORD) break;
    }
    await page.locator('#password').press('Enter');
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 6_000 }).catch(() => {});
}

test('reordenar una ruta vuelve a medirla, y se guarda lo medido', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'el flujo se prueba en escritorio');
    // Sin Google: línea recta, calculable acá.
    await page.route(/maps\.googleapis\.com|\/functions\/v1\/maps-proxy/, (r) => r.abort());

    await entrar(page);
    // Por la dirección: la barra agrupa las pestañas en un menú según el ancho,
    // y la pestaña activa vive en `?tab=` (usePestanaEnUrl).
    await page.goto('/pedidos?tab=rutas');
    await page.getByRole('button', { name: /^Crear ruta$/i }).first().click();
    await expect(page.getByText('Nueva Ruta de Entrega')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Seleccionar todo/i }).click();
    await page.getByRole('button', { name: /Ver ruta optimizada/i }).click();
    await expect(page.getByText('Confirmar ruta')).toBeVisible({ timeout: 20_000 });

    // Bajar la PRIMERA parada un lugar: cambia desde dónde se llega a las dos
    // primeras. Con el defecto, las dos se quedaban con su tramo viejo.
    await page.getByRole('dialog').locator('button:has(svg.lucide-chevron-down)').first().click();
    await page.waitForTimeout(500);

    const enviado = page.waitForRequest((r) => r.url().includes('/rpc/crear_ruta'));
    await page.getByRole('button', { name: /^Crear Ruta$/ }).click();
    const cuerpo = (await enviado).postDataJSON();

    // Una fila por pedido-sala; la parada es el `orden_entrega`.
    const porParada = new Map();
    for (const f of cuerpo.p_paradas) if (!porParada.has(f.orden_entrega)) porParada.set(f.orden_entrega, f);
    const paradas = [...porParada.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
    expect(paradas.length, 'la ruta debería tener las 5 salas sembradas').toBe(5);

    let desde = COORDS[6];
    let totalDist = 0, totalDur = 0;
    for (const p of paradas) {
        const esperado = tramo(desde, COORDS[p.erp_sucursal_id]);
        expect({ sala: p.erp_sucursal_id, dist_m: p.dist_m, dur_min: p.dur_min },
            `el tramo hasta la sala ${p.erp_sucursal_id} no se volvió a medir`)
            .toEqual({ sala: p.erp_sucursal_id, ...esperado });
        totalDist += esperado.dist_m;
        totalDur += esperado.dur_min;
        desde = COORDS[p.erp_sucursal_id];
    }
    const regreso = tramo(desde, COORDS[6]);
    expect(cuerpo.p_distancia_total_m, 'el total guardado no es la suma de los tramos más el regreso')
        .toBe(totalDist + regreso.dist_m);
    expect(cuerpo.p_duracion_min).toBe(totalDur + regreso.dur_min);
});
