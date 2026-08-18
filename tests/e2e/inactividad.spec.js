// El cierre por inactividad tiene que ocurrir CUANDO el contador llega a cero.
//
// Medido el 2026-08-18: no ocurría. El vigilante revisaba cada 30 s
// (`CHECK_EVERY_MS`) mientras el cartel «¿Sigues ahí?» descontaba cada segundo
// contra el instante real, así que el cierre caía en cualquier punto de esos
// 30 s — el cartel se quedó diciendo «0 segundos» 21 s con la sesión abierta, y
// el aviso que promete 60 s salió con 9. Ningún gate puede ver esto: es una
// propiedad de RELOJ, y sólo se ve dejando correr el reloj.
//
// Por eso las dos pruebas son lentas a propósito. No es lentitud del portal: es
// el minuto y medio que hay que esperar para poder afirmar algo sobre él.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const CLAVE_SELLO = 'sb_last_activity_at';

async function iniciarSesion(page) {
    await page.goto('/');
    // La pantalla de entrada mueve el foco sola (escucha del lector de carné):
    // hay que dejarla asentarse y CONFIRMAR lo escrito antes de mandar, o los
    // dos campos terminan pegados dentro del de usuario.
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
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(3000);
}

// El sello se retrocede tanto como haga falta para que el vencimiento caiga
// dentro de `margenMs`. El límite se calcula como lo calcula el portal
// (`getIdleLimitMs`): así la prueba vale con 5 minutos de sala o con 12 horas
// de gestión, sin depender de qué cuenta sea la de QA.
async function vencerEn(page, margenMs) {
    return page.evaluate((margen) => {
        const clave = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        let limite = null;
        try {
            const cuerpo = JSON.parse(localStorage.getItem(clave)).access_token.split('.')[1];
            const claims = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
            if (Number(claims.idle_limit_min) > 0) limite = Number(claims.idle_limit_min) * 60 * 1000;
        } catch { /* token ilegible: manda el respaldo */ }
        if (localStorage.getItem('sb_device_class') === 'app') limite = 30 * 24 * 60 * 60 * 1000;
        if (!limite) {
            let admin = false;
            try { admin = JSON.parse(localStorage.getItem('sb_is_su') || 'false'); } catch { /* */ }
            if (!admin) {
                try {
                    const perms = JSON.parse(localStorage.getItem('sb_role_perms') || '{}');
                    const mgmt = ['staff_list','schedules','monitor','requests','time_audit','permissions','announcements'];
                    admin = mgmt.some(m => perms[m]?.can_view);
                } catch { /* */ }
            }
            limite = admin ? 12 * 60 * 60 * 1000 : 5 * 60 * 1000;
        }
        const vence = Date.now() + margen;
        localStorage.setItem('sb_last_activity_at', String(vence - limite));
        return vence;
    }, margenMs);
}

const hayCartel = () => (document.body.innerText || '').toLowerCase().includes('sigues ahí');

test.describe('cierre por inactividad', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('la sesion se cierra cuando el contador llega a cero, no 30 s despues', async ({ page }) => {
        test.setTimeout(180_000);
        await iniciarSesion(page);

        const vence = await vencerEn(page, 75_000);
        await page.waitForFunction(() => !!document.querySelector('#username'), null,
            { timeout: 120_000, polling: 250 });
        const tarde = (Date.now() - vence) / 1000;

        // El margen cubre el sondeo de la prueba y el `signOut`, no los 30 s del
        // barrido: con el defecto, esto daba entre 0 y 30 y el promedio 15.
        expect(tarde, `cerró ${tarde.toFixed(1)} s después de marcar cero`).toBeLessThan(5);
        expect(tarde, 'no puede cerrarse ANTES de llegar a cero').toBeGreaterThan(-2);
    });

    test('moverse con el cartel puesto salva la sesion', async ({ page }) => {
        test.setTimeout(200_000);
        await iniciarSesion(page);

        // 40 s de margen: el cartel sale en cuanto el barrido ve el sello ajeno.
        const vence = await vencerEn(page, 40_000);
        await page.waitForFunction(hayCartel, null, { timeout: 60_000, polling: 250 });

        // Alguien está: dos movimientos de mouse de verdad.
        await page.mouse.move(400, 400);
        await page.mouse.move(420, 410);

        // Y se cruza el vencimiento viejo con margen de sobra.
        await page.waitForTimeout(Math.max(0, vence - Date.now()) + 30_000);
        expect(await page.evaluate(() => !!document.querySelector('#username')),
            'hubo actividad: la sesión no puede cerrarse').toBe(false);
        expect(await page.evaluate(hayCartel), 'el cartel tiene que irse al moverse el mouse').toBe(false);
        expect(await page.evaluate((k) => Number(localStorage.getItem(k) || 0) > Date.now() - 60_000, CLAVE_SELLO),
            'el sello de actividad tiene que haberse renovado').toBe(true);
    });
});
