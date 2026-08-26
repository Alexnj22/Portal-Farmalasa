// F0.3 de `docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md`.
//
// La CSP la sirve Vercel desde `vercel.json`, así que `vite preview` NUNCA la
// manda y en local no se puede comprobar mirando el navegador. Acá se lee la
// política REAL del archivo —no una copia escrita a mano, que se desincronizaría
// el día que alguien la edite— y se inyecta en la respuesta del documento.
//
// El control positivo es unpkg: si un `<script>` a unpkg NO queda bloqueado, la
// cabecera no se está aplicando y todo lo demás que mida este archivo no prueba
// nada. Es la diferencia entre «cero violaciones» y «cero datos».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const CSP = (() => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    const h = vercel.headers?.[0]?.headers?.find((x) => x.key === 'Content-Security-Policy');
    if (!h) throw new Error('vercel.json no tiene Content-Security-Policy en enforce');
    return h.value;
})();

// Carga un <script src> en la página y contesta si el navegador lo dejó entrar.
const intentarScript = (page, src) =>
    page.evaluate(
        (url) =>
            new Promise((resolve) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload = () => resolve('cargó');
                s.onerror = () => resolve('bloqueado');
                document.head.appendChild(s);
                setTimeout(() => resolve('sin respuesta'), 15_000);
            }),
        src,
    );

test.describe('F0.3 · CSP en enforce', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('la política bloquea los CDN y no rompe lo que el portal sí usa', async ({ page }) => {
        test.setTimeout(120_000);

        const violaciones = [];
        await page.addInitScript(() => {
            window.__cspViolaciones = [];
            document.addEventListener('securitypolicyviolation', (e) => {
                window.__cspViolaciones.push(`${e.violatedDirective} ← ${e.blockedURI}`);
            });
        });

        // La política real de `vercel.json`, sobre la respuesta del documento y
        // SÓLO sobre ella: reenviar cada recurso por el interceptor hace que al
        // terminar la prueba queden llamadas en vuelo y el worker se cae.
        await page.route('**/*', async (route) => {
            if (route.request().resourceType() !== 'document') return route.continue();
            const res = await route.fetch();
            return route.fulfill({
                response: res,
                headers: { ...res.headers(), 'content-security-policy': CSP },
            });
        });

        await page.goto('/');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('#username')).toHaveCount(0, { timeout: 30_000 });

        // ── Control positivo: sin esto el resto del test no significa nada ──
        expect(
            await intentarScript(page, 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
            'unpkg NO quedó bloqueado: la cabecera no se aplicó y este test no prueba nada',
        ).toBe('bloqueado');

        expect(
            await intentarScript(page, 'https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js'),
            'jsdelivr no quedó bloqueado',
        ).toBe('bloqueado');

        // ── Y lo que el portal SÍ necesita tiene que seguir entrando ──
        const clave = process.env.VITE_GOOGLE_MAPS_API_KEY;
        if (clave) {
            expect(
                await intentarScript(page, `https://maps.googleapis.com/maps/api/js?key=${clave}&libraries=geometry&loading=async`),
                'Google Maps quedó bloqueado por la CSP — el mapa de Rutas dejaría de cargar',
            ).toBe('cargó');
        }

        // Un paseo por las vistas principales para que se ejerciten los chunks
        // lazy, los estilos en línea y las llamadas a Supabase bajo la política.
        for (const ruta of ['/inicio', '/pedidos', '/productos', '/inventario']) {
            await page.goto(ruta);
            await page.waitForTimeout(2_500);
        }

        const encontradas = await page.evaluate(() => window.__cspViolaciones || []);
        violaciones.push(...encontradas);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        expect(violaciones, `violaciones de CSP en el paseo: ${JSON.stringify(violaciones, null, 2)}`).toEqual([]);
    });
});
