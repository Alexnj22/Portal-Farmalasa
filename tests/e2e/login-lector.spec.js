// El carné ES la contraseña (`AuthContext.login` lo manda como `password` a
// `signInWithPassword`). O sea que si el lector dispara con el foco puesto en
// «usuario» —un campo de texto plano—, el código queda escrito y a la vista de
// cualquiera que mire la pantalla del mostrador.
//
// La captura global de keydown de LoginView no cubre ese caso a propósito:
// mientras el foco está en un input, las teclas son del input. Lo que separa a
// un lector de una persona es la VELOCIDAD, y este archivo mide justamente eso
// — incluida la vuelta atrás, que es la parte que se rompe sola: los códigos
// reales miden 3, 4 o 5 caracteres, así que el detector tiene que decidir con
// dos huecos, y sin la vuelta atrás un tecleo humano veloz se comería texto.
//
// Corre contra la pantalla de login, sin sesión: no toca la base.
import { test, expect } from '@playwright/test';

const RAFAGA = 6;    // ms entre teclas — un lector real anda por debajo de 15
const HUMANO = 130;  // ms entre teclas — un tecleo rápido de persona

test.describe('Login · el carné no se escribe en el campo de usuario', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('#username')).toBeVisible();
    });

    test('un tecleo humano entra tal cual', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('maria.hernandez', { delay: HUMANO });
        await expect(usuario).toHaveValue('maria.hernandez');
    });

    test('una ráfaga de lector no deja el código a la vista', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('447', { delay: RAFAGA });
        // Ni siquiera antes del Enter: en cuanto se detecta, lo pintado se borra.
        await expect(usuario).toHaveValue('');
        await page.keyboard.press('Enter');
        // Y el Enter va al lector, no al formulario: se ve el intento de validar.
        await expect(page.getByText(/Verificando|Carné no reconocido|conexión/i).first()).toBeVisible({ timeout: 5000 });
        await expect(usuario).toHaveValue('');
    });

    test('la ráfaga respeta lo que la persona ya había escrito', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('ana', { delay: HUMANO });
        await page.keyboard.type('5091', { delay: RAFAGA });
        await page.keyboard.press('Enter');
        await expect(usuario).toHaveValue('ana');
    });

    test('un tecleo veloz de persona se devuelve entero al campo', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('asd', { delay: 5 });      // dispara la sospecha
        await page.keyboard.type('fghij', { delay: HUMANO }); // el hueco humano la deshace
        await expect(usuario).toHaveValue('asdfghij');
    });

    test('la ráfaga tampoco entra por el campo de contraseña', async ({ page }) => {
        const clave = page.locator('#password');
        await clave.click();
        await page.keyboard.type('447', { delay: RAFAGA });
        await page.keyboard.press('Enter');
        await expect(clave).toHaveValue('');
    });
});

test.describe('Login · no se pega en usuario ni en contraseña', () => {
    for (const campo of ['username', 'password']) {
        test(`pegar en ${campo} no escribe nada`, async ({ page }) => {
            await page.goto('/login');
            const input = page.locator(`#${campo}`);
            await input.click();
            await input.evaluate((el) => {
                const dt = new DataTransfer();
                dt.setData('text/plain', 'pegado.prohibido');
                el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            });
            await expect(input).toHaveValue('');
            await expect(page.getByText(/aquí no se pega/i)).toBeVisible();
        });
    }
});
