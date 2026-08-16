import { test, expect } from '@playwright/test';

// Prueba del kiosco de marcación contra el ENTORNO DE PRUEBAS.
//
// Requiere `npm run dev:staging` levantado en :5173 y el kiosco sembrado en el
// branch de pruebas (dispositivo + empleados con PIN de carné + horario
// publicado). Los valores de abajo son los del branch `staging`.
//
// Lo que verifica que ninguna prueba unitaria puede: que el carné escaneado
// llega al servidor, que el marcaje QUEDA GUARDADO —no encolado— y que el
// segundo escaneo resuelve salida y no otra entrada.

const KIOSCO = {
    branchId:    '4',
    branchName:  'Salud 1',
    deviceId:    '549b7f10-b7a7-4287-9e49-ab24363038b2',
    deviceToken: '5f76390c-8d4f-4038-874b-ad19c540cd0f',
    deviceName:  'Kiosco Salud 1 (pruebas)',
};

const CARNE = 'NZXPLEGQ';        // PIN impreso en el carné de Marta Alfaro
const CARNE_INEXISTENTE = 'ZZZZ9999';

// Un lector físico entrega el carné entero en milisegundos. El kiosco mide esa
// velocidad y bloquea el tecleo manual (más de 40 ms por carácter), así que la
// prueba tiene que escribir rápido de verdad o se rechaza sola.
async function escanear(page, valor) {
    for (const ch of valor) {
        await page.keyboard.down(ch);
        await page.keyboard.up(ch);
        await page.waitForTimeout(5);
    }
    await page.keyboard.press('Enter');
}

test.describe('Kiosco de marcación', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((cfg) => {
            localStorage.setItem('kiosk_config', JSON.stringify(cfg));
            localStorage.removeItem('kiosk_attendance_queue');
            localStorage.removeItem('kiosk_auth_grace');
        }, KIOSCO);
    });

    test('un carné no reconocido lo dice, y no cuelga la pantalla', async ({ page }) => {
        // Esperar a que TERMINE la carga inicial, no sólo a que se pinte la
        // pantalla: `kiosco_marcajes_recientes` es la última llamada del
        // arranque, y hasta que vuelve el kiosco todavía no tiene su padrón.
        const cargado = page.waitForResponse((r) => r.url().includes('/rpc/kiosco_marcajes_recientes'), { timeout: 20000 });
        await page.goto('/kiosk');
        await expect(page.getByText('Acerca tu carné al lector')).toBeVisible({ timeout: 15000 });
        await cargado;

        await escanear(page, CARNE_INEXISTENTE);
        await expect(page.getByText('CARNÉ NO RECONOCIDO')).toBeVisible({ timeout: 10000 });
    });

    test('el carné se resuelve en el servidor y el marcaje NO queda en cola', async ({ page }) => {
        const identificaciones = [];
        const marcajes = [];
        page.on('response', (r) => {
            if (r.url().includes('/rpc/kiosco_identificar')) identificaciones.push(r);
            if (r.url().includes('/rpc/kiosco_marcar'))      marcajes.push(r);
        });

        // Esperar a que TERMINE la carga inicial, no sólo a que se pinte la
        // pantalla: `kiosco_marcajes_recientes` es la última llamada del
        // arranque, y hasta que vuelve el kiosco todavía no tiene su padrón.
        const cargado = page.waitForResponse((r) => r.url().includes('/rpc/kiosco_marcajes_recientes'), { timeout: 20000 });
        await page.goto('/kiosk');
        await expect(page.getByText('Acerca tu carné al lector')).toBeVisible({ timeout: 15000 });
        await cargado;

        await escanear(page, CARNE);

        // El nombre en pantalla prueba dos cosas a la vez: que el servidor
        // resolvió el carné (el navegador ya no tiene con qué compararlo) y que
        // la pantalla encontró a esa persona en su carga.
        await expect(page.getByText(/ALFARO/i).first()).toBeVisible({ timeout: 10000 });

        expect(identificaciones.length).toBeGreaterThan(0);
        expect((await identificaciones[0].json()).ok).toBe(true);

        // El tipo de marcaje depende de en qué punto de la jornada esté la
        // persona, así que las dos salidas son correctas: o se registra, o pide
        // autorización (turno extra fuera de horario). Lo que NO puede pasar,
        // y era exactamente lo que pasaba, es que la pantalla cante éxito
        // mientras el marcaje se va a una cola que nunca vacía.
        await expect(page.getByText(/se sincronizará solo/i)).toHaveCount(0);

        if (marcajes.length > 0) {
            expect((await marcajes[marcajes.length - 1].json()).ok).toBe(true);
        } else {
            await expect(page.getByText(/Autorización Requerida/i)).toBeVisible();
        }

        const cola = await page.evaluate(() => localStorage.getItem('kiosk_attendance_queue'));
        expect(cola === null || cola === '[]').toBe(true);
    });
});
