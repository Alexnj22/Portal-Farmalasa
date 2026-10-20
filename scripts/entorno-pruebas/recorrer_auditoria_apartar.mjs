// Auditoría de punta a punta de apartar, encargar y retirar (2026-10-20).
// SÓLO contra el entorno de pruebas, con `vite --mode staging --port 5173`.
// Va por etapas porque entre una y otra el encargo cambia de estado en la base
// (confirmar precio, llegó), que es trabajo de Compras y no de la sala:
//   ETAPA=1  aparta con efectivo, aparta con tarjeta sin voucher, encarga
//   ETAPA=2  cobra el encargo en «Por cobrar», retira las dos reservas
//   ETAPA=3  entrega el encargo
//   ETAPA=1 node scripts/entorno-pruebas/recorrer_auditoria_apartar.mjs <capturas>
import { chromium } from '@playwright/test';
const C = process.argv[2] || '.';
const ETAPA = Number(process.env.ETAPA || 1);
const BASE = 'http://localhost:5173';
const pasos = [];
const paso = (n, ok, d = '') => pasos.push({ ok: ok ? '✓' : '✗', paso: n, detalle: ok ? '' : String(d).slice(0, 160) });
const ve = (p, t, ms = 15_000) => p.getByText(t).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
const b = await chromium.launch();
const errores = [];
const respuestas = [];

async function abrirApartar(p) {
    await p.goto(`${BASE}/caja?sala=28`);
    await p.getByRole('button', { name: /^entrada$/i }).first().waitFor({ timeout: 30_000 });
    await p.getByRole('button', { name: /^entrada$/i }).first().click();
    await p.getByText('Anotar un ingreso').first().waitFor({ timeout: 10_000 });
    await p.getByText('Elige de qué se trata').first().click();
    await p.getByRole('option', { name: /Apartar o encargar/ }).first().click().catch(async () => {
        await p.getByText(/Apartar o encargar/).last().click();
    });
    await p.getByText('Si hay en la sala se aparta').first().waitFor({ timeout: 15_000 });
}
async function elegir(p, producto, cantidad) {
    await p.getByPlaceholder('Cliente: nombre, DUI o teléfono').fill('CARLOS MAR');
    await p.getByRole('button', { name: /^CARLOS MARÍA ALVARADO/ }).first().click({ timeout: 15_000 });
    await p.getByPlaceholder('Producto a apartar o encargar…').fill(producto.source.replace(/^\^/, '').replace(/\\s\+/g, ' ').replace(/\\/g, '').replace(/ YDAS$/, ''));
    await p.getByText(producto).last().click({ timeout: 15_000 });
    await p.getByText('¿Cuál?').first().click();
    await p.getByRole('option').first().click();
    await p.locator('input[type=number]').last().fill(String(cantidad));
}
async function abrirRetiro(p, codigo) {
    await p.goto(`${BASE}/ofertas-clientes?tab=reservas`);
    const fila = p.locator('li', { hasText: codigo }).first();
    await fila.waitFor({ timeout: 30_000 });
    await fila.getByRole('button', { name: /^(Retirar|Entregar)$/ }).click();
    await p.getByText(new RegExp(`^Retirar ${codigo}`)).first().waitFor({ timeout: 15_000 });
}

try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errores.push(e.message));
    p.on('response', async (r) => {
        if (/operar-caja|creditos-erp|rpc\/(apartado|encargo)/.test(r.url())) respuestas.push(`${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    });
    await p.goto(`${BASE}/login`);
    await p.locator('text=/entorno de pruebas/i >> visible=true').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    await p.locator('#username').fill('pruebas'); await p.locator('#password').fill('pruebas2026'); await p.locator('#password').press('Enter');
    await p.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 30_000 });
    await p.getByRole('button', { name: 'Entendido' }).first().click({ timeout: 4000 }).catch(() => {});

    if (ETAPA === 1) {
        // A · efectivo
        await abrirApartar(p);
        await elegir(p, /^MICROPORE\s+2X10 YDAS/, 1);
        paso('A · con existencia dice «se aparta»', await ve(p, /se aparta 7 días/));
        await p.getByRole('button', { name: /^Cobrar anticipo/ }).click();
        paso('A · cobra el anticipo en efectivo', await ve(p, 'Anticipo cobrado', 30_000));
        // B · tarjeta sin voucher
        await abrirApartar(p);
        await elegir(p, /^MICROPORE\s+2X10 YDAS/, 1);
        await ve(p, /se aparta 7 días/);
        await p.getByText('Tarjeta', { exact: true }).last().click();
        await p.getByText('No tengo el voucher').first().click();
        await p.getByPlaceholder('el cliente pagó por transferencia y no mandó la captura').fill('Prueba de auditoría sin voucher');
        await p.screenshot({ path: `${C}/b-tarjeta.png` });
        await p.getByRole('button', { name: /^Cobrar anticipo/ }).click();
        paso('B · cobra el anticipo con tarjeta sin voucher', await ve(p, 'Anticipo cobrado', 30_000));
        // C · encargo
        await abrirApartar(p);
        await elegir(p, /^MICROPORE\s+1\/2X10 YDAS/, 5);
        paso('C · sin existencia dice «se encarga»', await ve(p, /se encarga/));
        await p.getByRole('button', { name: 'Registrar encargo' }).click();
        paso('C · registra el encargo sin cobrar', await ve(p, 'Encargo registrado', 20_000));
    }

    if (ETAPA === 2) {
        const [ra, rb, ec] = (process.env.CODIGOS || '').split(',');
        // Cobrar el encargo confirmado
        await abrirApartar(p);
        await p.getByText('Por cobrar', { exact: true }).last().click();
        const tarjeta = p.locator('button[data-surface="card"]', { hasText: ec }).first();
        paso('C · el encargo confirmado aparece en «Por cobrar»', await tarjeta.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
        await tarjeta.click();
        await p.screenshot({ path: `${C}/c-por-cobrar.png` });
        await p.getByRole('button', { name: /^Cobrar \$/ }).click();
        paso('C · cobra el 100 % del encargo', await ve(p, /cobrado/i, 30_000));
        // Retirar A al contado
        await abrirRetiro(p, ra);
        paso('A · el retiro propone factura al contado', await ve(p, /al contado/));
        await p.getByRole('button', { name: 'Hacer el vale' }).click();
        paso('A · hace el vale y queda retirada', await ve(p, 'Retirado', 30_000));
        // Retirar B: sólo crédito
        await abrirRetiro(p, rb);
        paso('B · con tarjeta propone factura al crédito', await ve(p, /al crédito/));
        paso('B · no ofrece el vale', !(await p.getByRole('button', { name: 'Hacer el vale' }).isVisible().catch(() => false)));
        paso('B · ofrece buscar el crédito', await p.getByRole('button', { name: 'Buscar el crédito' }).isVisible().catch(() => false));
        await p.screenshot({ path: `${C}/b-retiro-credito.png` });
    }

    if (ETAPA === 3) {
        const ec = process.env.CODIGOS;
        await p.goto(`${BASE}/ofertas-clientes?tab=reservas`);
        const fila = p.locator('li', { hasText: ec }).first();
        await fila.waitFor({ timeout: 30_000 });
        await fila.getByRole('button', { name: /^Entregar$/ }).click();
        paso('C · el retiro del encargo propone el contado', await ve(p, /al contado/));
        await p.screenshot({ path: `${C}/c-retiro.png` });
        await p.getByRole('button', { name: 'Hacer el vale' }).click();
        paso('C · hace el vale y queda entregado', await ve(p, 'Retirado', 30_000));
    }
} catch (e) { paso('el recorrido terminó sin tropezar', false, e.message); await b.contexts()[0]?.pages()[0]?.screenshot({ path: `${C}/error.png` }).catch(() => {}); }
await b.close();
paso('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.table(pasos);
console.log(respuestas.filter((r) => !r.startsWith('200')).join('\n'));
process.exit(pasos.some((x) => x.ok === '✗') ? 1 : 0);
