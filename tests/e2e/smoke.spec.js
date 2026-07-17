import { test, expect } from '@playwright/test';

// Smoke suite de los flujos críticos de Fase 5 (ver PLAN-EJECUCION-2026-07.md,
// Bloque 2). Credenciales SIEMPRE por variables de entorno — nunca hardcodeadas
// (ver .env.example para las que hacen falta). Corre contra `vite preview`
// (ver playwright.config.js): un build de producción, no el dev server.

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const E2E_CARNE_CODE = process.env.E2E_CARNE_CODE;

test.describe('Login', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('login con usuario y contraseña entra al portal', async ({ page }) => {
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();

        await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
        await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 15_000 });
    });

    test('login por carné (lector físico simulado) entra al portal', async ({ page }) => {
        test.skip(!E2E_CARNE_CODE, 'Requiere E2E_CARNE_CODE');

        await page.goto('/login');
        // El lector físico tipea rápido y termina con Enter; la captura global
        // de LoginView solo actúa si el foco NO está en un input (ver
        // src/views/LoginView.jsx, handleScanLogin / onKeyDown).
        await page.locator('body').click({ position: { x: 10, y: 10 } });
        await page.keyboard.type(E2E_CARNE_CODE, { delay: 30 });
        await page.keyboard.press('Enter');

        await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
        await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 15_000 });
    });
});

test.describe('Flujos autenticados', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 15_000 });
    });

    test('Dashboard carga sin errores', async ({ page }) => {
        await expect(page.getByText('Empleados activos')).toBeVisible({ timeout: 15_000 });
    });

    test('Pedidos carga sin errores', async ({ page }) => {
        await page.goto('/pedidos');
        await expect(page.getByText('Pedidos', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('Modal de Editar Empleado no muestra campos sensibles vacíos por race condition', async ({ page }) => {
        // Ver project_sensitive_fields_boot_race: Editar Empleado debe esperar
        // bootStatus==='ready' antes de abrir, o DUI/ISSS/AFP/banco/kiosk_pin
        // pueden verse vacíos y guardarse como NULL. Este smoke no fuerza la
        // ventana de carrera exacta, pero confirma el síntoma que dejaría: el
        // campo DUI debe llegar poblado, nunca vacío, al abrir el modal.
        // "Personal" es un grupo colapsable de sidebar SOLO si el rol tiene ≥2
        // módulos visibles ahí (Listado + Nómina); con un solo módulo visible
        // (ej. el rol de la cuenta QA, que no ve Nómina) el sidebar aplana el
        // grupo y "Listado" aparece directo, sin "Personal" para hacer clic.
        const personalGroup = page.getByText('Personal', { exact: true });
        if (await personalGroup.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await personalGroup.click();
        }
        await page.getByText('Listado', { exact: true }).click();
        await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });

        // El lápiz "Edición rápida" (StaffManagementView.jsx) abre el modal
        // directo — NO es el último botón de la fila (ese es "Ver perfil
        // completo", que navega al dossier de solo lectura). Apuntar por
        // title en vez de .last() evita el falso negativo si se agregan más
        // botones de fila en el futuro. Requiere staff_list.can_edit (la
        // cuenta QA lo tiene; staff_detail.can_edit deliberadamente no).
        await page.locator('table tbody tr').first().locator('button[title="Edición rápida"]').click();

        const duiInput = page.locator('input[name="dui"]');
        await expect(duiInput).toBeVisible({ timeout: 15_000 });
        await expect(duiInput).not.toHaveValue('', { timeout: 15_000 });
    });
});
