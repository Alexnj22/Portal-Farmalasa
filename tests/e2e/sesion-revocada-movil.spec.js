// El agujero que reportó el usuario el 2026-08-09: «le di en cerrar sesión a mis
// sesiones que eran un montón, pero no me sacó».
//
// `validateSession` usaba `getSession()`, que **no valida nada** — lee el token
// del disco y lo devuelve. Con la sesión ya borrada del servidor, el portal
// seguía pintando el tablero, incluso tras recargar. Medido con los dos
// extremos: `/auth/v1/user` contesta 403 `session_not_found`, y `/rest/v1/…`
// contesta 200. O sea que la única forma de enterarse es PREGUNTAR.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;

test.describe('Sesión revocada por debajo', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD || !ANON, 'Requiere E2E_USER/E2E_PASSWORD/VITE_SUPABASE_ANON_KEY');

    test('si el servidor ya no la reconoce, el portal saca a la persona', async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto('/');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });
        await page.waitForTimeout(4_000);

        // Se revoca la sesión POR FUERA del portal — como si otra persona la
        // hubiera cerrado desde Conexiones. Así se prueba la detección, que es
        // lo general; el atajo de «me cerré a mí mismo» es aparte.
        const revocado = await page.evaluate(async (anon) => {
            const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x));
            const tok = JSON.parse(localStorage.getItem(k)).access_token;
            const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const c = JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
            const r = await fetch(c.iss.replace('/auth/v1', '') + '/rest/v1/rpc/revoke_person_sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: 'Bearer ' + tok },
                body: JSON.stringify({ p_user_id: c.sub }),
            });
            return r.status;
        }, ANON);

        // Control: si la revocación no ocurrió, lo de abajo pasaría por el
        // motivo equivocado.
        expect(revocado, 'la revocación no se aplicó: el test no probó nada').toBe(200);

        // Recargar es el momento en que `validateSession` le pregunta al
        // servidor. Antes de este arreglo, acá salía el tablero.
        await page.reload();
        await expect(page.locator('#username')).toBeVisible({ timeout: 45_000 });

        // Y el token no puede quedarse en el disco.
        const token = await page.evaluate(
            () => Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x)) || null);
        expect(token, 'el token siguió guardado tras cerrar la sesión').toBeNull();
    });
});
