// F2 de `docs/PLAN-SESIONES-SEGURAS-2026-08-08.md`.
//
// Las dos propiedades que el plan exige verificar y que NINGÚN gate puede ver,
// porque las dos dependen de qué queda en `localStorage` después de un fallo de
// red:
//
//   1. Cerrar por inactividad SIN RED borra el token igual. Antes no: auth-js
//      retorna antes de `_removeSession()` cuando la revocación falla, y el
//      refresh token quedaba vivo en el disco del que ya «cerró sesión».
//   2. La clase del dispositivo la fija la ventana que inició sesión y una
//      segunda ventana NO la cambia — el caso de la PWA instalada en la misma
//      computadora, que comparte `localStorage` con el navegador.
import { test, expect } from '@playwright/test';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const REF = 'sacecdkdmsdvgqnrsett';
const CLAVE_TOKEN = `sb-${REF}-auth-token`;
const CLAVE_SELLO = 'sb_last_activity_at';
const CLAVE_CLASE = 'sb_device_class';

async function iniciarSesion(page) {
    await page.goto('/');
    await page.locator('#username').fill(E2E_USER);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });
}

const leer = (page, clave) => page.evaluate((k) => localStorage.getItem(k), clave);

test.describe('F2 · sesiones', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('cerrar por inactividad sin red borra el token igual', async ({ page }) => {
        // El vigilante revisa cada 30s (`CHECK_EVERY_MS`), así que esta prueba
        // no entra en el timeout por defecto de Playwright. No es lentitud: es
        // el período real del reloj que se está verificando.
        test.setTimeout(150_000);

        await iniciarSesion(page);
        expect(await leer(page, CLAVE_TOKEN), 'el token tiene que existir tras entrar').toBeTruthy();

        // La red de auth se cae DESPUÉS de entrar: es el escenario exacto —la
        // laptop que se durmió— donde `signOut()` no llega a revocar.
        //
        // Se CUENTAN los cortes, y al final se exige que haya habido al menos
        // uno. Sin eso, un test que nunca llegó a cortar nada pasaría igual —
        // `signOut()` habría borrado el token por su cuenta— y estaría
        // verificando el camino feliz mientras dice verificar el roto.
        let cortes = 0;
        await page.route('**/auth/v1/logout**', (route) => {
            cortes += 1;
            return route.abort('failed');
        });

        // Sello 60 días atrás: más viejo que CUALQUIERA de los tres límites, así
        // que el veredicto no depende de qué permisos tenga la cuenta de QA.
        const hace60d = Date.now() - 60 * 24 * 60 * 60 * 1000;
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CLAVE_SELLO, String(hace60d)]);

        // El vigilante revisa cada 30s (CHECK_EVERY_MS) y se saltea el tick con
        // la pestaña oculta, así que hay que mantenerla visible y esperar.
        await expect
            .poll(() => leer(page, CLAVE_TOKEN), {
                timeout: 60_000,
                message: 'el token seguía en localStorage después del cierre por inactividad',
            })
            .toBeNull();

        expect(cortes, 'la revocación nunca se intentó: el test no probó el camino sin red').toBeGreaterThan(0);

        // Y la consecuencia que importa: ya no hay sesión que restaurar.
        await page.reload();
        await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
        expect(await leer(page, CLAVE_TOKEN)).toBeNull();
    });

    // F3: el latido es la mitad que hace REAL el límite de inactividad — sin él
    // el servidor no sabe que la sesión sigue viva y el hook no tiene qué mirar.
    // Se afirma sobre la RED y no sobre el efecto, porque el primer intento de
    // este latido fallaba en silencio (`userRef` todavía sin llenar al llamarlo
    // desde `startIdleWatcher`) y `session_activity` quedaba vacía sin que nada
    // lo dijera.
    test('al entrar, el latido llega al servidor', async ({ page }) => {
        const latidos = [];
        page.on('response', (r) => {
            if (r.url().includes('/rest/v1/rpc/touch_session')) latidos.push(r.status());
        });

        await iniciarSesion(page);
        await expect
            .poll(() => latidos, { timeout: 20_000, message: 'no salió ninguna llamada a touch_session' })
            .not.toEqual([]);

        // 204 = la fila quedó escrita. Un 401/403 querría decir que el RPC está
        // ahí pero el permiso no, y el efecto sería el mismo: cero enforcement.
        expect(latidos.every((s) => s === 204), `estados recibidos: ${latidos}`).toBe(true);
    });

    test('la clase la fija la ventana que entró; una segunda no la cambia', async ({ page, context }) => {
        // Playwright no emula `display-mode`, así que se sustituye la consulta.
        // Es exactamente lo que ve el código: `matchMedia(...).matches`.
        await page.addInitScript(() => {
            const real = window.matchMedia.bind(window);
            window.matchMedia = (q) =>
                q.includes('display-mode: standalone') ? { matches: true, addEventListener() {}, removeEventListener() {} } : real(q);
        });

        await iniciarSesion(page);
        expect(await leer(page, CLAVE_CLASE), 'entró desde la app instalada').toBe('app');

        // Segunda ventana del MISMO contexto = mismo origen y mismo
        // localStorage, sin el override: es la pestaña normal del navegador
        // conviviendo con la PWA instalada en la misma computadora.
        const pestana = await context.newPage();
        await pestana.goto('/');
        await pestana.waitForTimeout(3_000);

        expect(await leer(pestana, CLAVE_CLASE), 'la segunda ventana no puede degradar la clase').toBe('app');
        expect(await leer(page, CLAVE_CLASE)).toBe('app');
        await pestana.close();
    });
});
