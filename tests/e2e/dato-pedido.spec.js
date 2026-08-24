import { test, expect } from '@playwright/test';

// La baldosa «Datos que faltan», abierta de verdad en un navegador.
//
// **Esta prueba existe porque el resto de este circuito se verificó del lado del
// servidor.** Las funciones de la base se probaron con datos reales y las
// pruebas unitarias anclan el reparador de correos — pero nada de eso mira la
// pantalla, y en este proyecto ya pasó dos veces que el gate diera verde sobre
// una vista que no se pintaba. Acá se cazaron dos así: `EmptyState` no acepta
// `message` (el texto del vacío no salía) y `requireActiveEmployeeUser` no
// devuelve `branch_id` (la comparación daba NaN y habría dejado a TODAS las
// salas fuera de su propio pedido con un 403 que parece falta de permiso).
//
// ── Lo que NO hace, a propósito ────────────────────────────────────────────
// No confirma un correo válido. Corre contra producción y confirmar escribe en
// la ficha del sistema de origen y retransmite un documento fiscal a Hacienda:
// abrir no puede escribir, la misma regla que `dialogos-movil`.
//
// Lo que sí prueba de punta a punta es el camino completo hasta el borde de esa
// escritura: navegador → función → sesión → sala → validación → error de vuelta
// en la pantalla. Un correo sin forma se rechaza ANTES de tocar nada.
//
// ⚠️ CORRE EN EL PUERTO 4173, NO en el 4174 por defecto de Playwright.
//
//     OUT_DIR=dist-<nombre> npm run preview      # levanta el 4173
//     E2E_BASE_URL=http://localhost:4173 npx playwright test tests/e2e/dato-pedido.spec.js
//
// Las edge functions sólo aceptan CORS de `PORTAL_ORIGIN`, `localhost:5173` y
// `localhost:4173` (`ALLOWED_ORIGINS` en `_shared/security.ts`). Desde el 4174 el
// navegador bloquea la llamada en el preflight y **la pantalla no muestra ningún
// error**: el toast nunca aparece porque la respuesta nunca llega. Se ve igual
// que un fallo del formulario, y costó dos corridas darse cuenta.
//
// Necesita una fila sembrada en `dte_datos_pedidos`; sin ella sólo se comprueba
// que la baldosa monta y que su vacío se lee. Sembrarla y borrarla es cosa del
// operador — la prueba no escribe en la base.

const E2E_USER     = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe('Datos que faltan', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('la baldosa monta, muestra el pedido y rechaza un correo sin forma', async ({ page }) => {
        test.setTimeout(180_000);

        const erroresJs = [];
        page.on('pageerror', e => erroresJs.push(String(e.message).slice(0, 200)));

        // ── El ingreso, y por qué no es un `fill` y un clic ─────────────────
        // La pantalla de login escucha el teclado para el lector de carné, y en
        // una de cada dos corridas la contraseña terminaba PEGADA al final del
        // usuario («qa.test» + la clave en el mismo campo) con el campo de
        // contraseña vacío. Falla como si la credencial fuera mala, así que se
        // comprueba lo que quedó ESCRITO antes de enviar en vez de confiar en
        // que el `fill` aterrizó donde se pidió.
        await page.goto('/login');
        const usuario = page.locator('#username');
        const clave   = page.locator('#password');
        for (let intento = 1; intento <= 3; intento++) {
            await usuario.fill('');
            await clave.fill('');
            await usuario.fill(E2E_USER);
            await clave.fill(E2E_PASSWORD);
            if (await usuario.inputValue() === E2E_USER && (await clave.inputValue()).length > 0) break;
            expect(intento, 'el formulario de login no acepta lo que se escribe').toBeLessThan(3);
        }
        await page.locator('button[type="submit"]').first().click();
        // A la CONDICIÓN, no al reloj: la primera carga tras levantar el preview
        // tarda más que cualquier espera fija.
        await page.waitForFunction(
            () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
        );
        await page.waitForTimeout(4000);
        expect(page.url(), 'no se pudo iniciar sesión').not.toMatch(/\/login/);

        // ── 1 · La baldosa existe y está registrada ─────────────────────────
        const baldosa = page.locator('[data-widget-id="dato_pedido"]');
        await expect(baldosa, 'la baldosa no se pintó: revisá el permiso dash_dato_pedido')
            .toBeVisible({ timeout: 30_000 });
        // El tablero es largo: la baldosa nace fuera de la vista y hay que
        // traerla. Y el rótulo aparece DOS veces —el título propio y el de la
        // manija de arrastre, que el envoltorio pinta al pasar el puntero—, así
        // que sin `.first()` esto falla por ambigüedad y se lee como «no está».
        await baldosa.scrollIntoViewIfNeeded();
        await expect(baldosa.getByText('Datos que faltan').first()).toBeVisible();

        // ── 2 · Con un pedido sembrado: el detalle y el campo ───────────────
        const campo = baldosa.locator('input[type="email"]').first();
        const hayPedido = await campo.count() > 0;

        if (!hayPedido) {
            // Sin fila sembrada esto es lo único que se puede afirmar. Se dice,
            // en vez de pasar en verde como si hubiera probado el formulario:
            // una prueba que no midió no puede dar por bueno lo que no vio.
            await expect(baldosa.getByText(/Sin datos pendientes/i)).toBeVisible();
            test.info().annotations.push({
                type: 'parcial',
                description: 'Sin pedido sembrado: sólo se verificó que la baldosa monta y su vacío se lee.',
            });
            expect(erroresJs, `errores de JS: ${erroresJs.join(' | ')}`).toEqual([]);
            return;
        }

        const boton = baldosa.getByRole('button', { name: /Confirmar y enviar/i }).first();
        // El botón arranca apagado: sin correo no hay nada que enviar.
        await expect(boton).toBeDisabled();

        // ── 3 · Un correo sin forma se rechaza y el motivo se VE ────────────
        // Se para antes de escribir en el sistema de origen, así que es seguro
        // contra producción y prueba toda la cadena hasta ese borde.
        await campo.fill('esto-no-es-un-correo');
        await expect(boton).toBeEnabled();
        await boton.click();

        await expect(page.getByText(/no tiene forma de correo/i))
            .toBeVisible({ timeout: 30_000 });

        // Y el pedido sigue abierto: un rechazo no puede cerrarlo.
        await expect(campo).toBeVisible();

        expect(erroresJs, `errores de JS: ${erroresJs.join(' | ')}`).toEqual([]);
    });
});
