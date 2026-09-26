// Entrar al portal del ENTORNO DE PRUEBAS con la cuenta de pruebas. Vive aparte
// de los specs: importar un spec desde otro vuelve a registrar sus pruebas.
import { expect } from '@playwright/test';

export async function entrar(page) {
    await page.goto('/login');
    await expect(page.getByText(/entorno de pruebas/i).first()).toBeVisible({ timeout: 15_000 });
    // El formulario de entrada se hidrata tarde y a veces se traga lo escrito:
    // se reintenta hasta que los dos campos digan lo que tienen que decir.
    await page.waitForTimeout(1500);
    for (let i = 0; i < 4; i++) {
        await page.locator('#username').fill('pruebas');
        await page.locator('#password').fill('pruebas2026');
        await page.waitForTimeout(300);
        if (await page.locator('#username').inputValue() === 'pruebas'
            && await page.locator('#password').inputValue() === 'pruebas2026') break;
    }
    await page.locator('#password').press('Enter');
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4_000 }).catch(() => {});
}
