// Distribución contra el ENTORNO DE PRUEBAS (nunca producción: crea pedidos
// y documentos). Correr con el portal compilado en modo staging:
//
//   npx vite build --mode staging --outDir dist-sas-staging
//   npx vite preview --mode staging --outDir dist-sas-staging --port 4173 --strictPort
//   E2E_BASE_URL=http://localhost:4173 npx playwright test tests/e2e/distribucion.spec.js --project=chromium
//
// Se niega a correr si la página no muestra el marco «ENTORNO DE PRUEBAS».
import { test, expect } from '@playwright/test';
import { entrar } from './distribucionEntrar.js';

const SALIDA = process.env.E2E_CAPTURAS || 'test-results/distribucion';


const SECCIONES = { pedidos: 'Pedidos', documentos: 'Documentos', clientes: 'Clientes', catalogo: 'Catálogo',
    inventario: 'Inventario', solicitudes: 'Solicitudes', emisor: 'Empresa' };

test('las secciones de Torogoz abren sin romper, y la dirección vieja lleva allá', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    // Un aviso viejo con `/distribucion?tab=…&documento=…` sigue llegando.
    await page.goto('/distribucion?tab=clientes');
    await expect(page).toHaveURL(/\/torogoz\/clientes$/);
    // La distribuidora ya no está en el menú de las farmacias.
    await page.goto('/ventas');
    await expect(page.getByRole('link', { name: /Distribución|Torogoz/ })).toHaveCount(0);
    for (const [tab, titulo] of Object.entries(SECCIONES)) {
        await page.goto(`/torogoz/${tab}`);
        await expect(page.getByRole('heading', { name: titulo }).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1500);
        await expect(page.getByText(/algo salió mal/i)).toHaveCount(0);
        await page.screenshot({ path: `${SALIDA}/${tab}.png`, fullPage: true });
    }
    expect(errores).toEqual([]);
});

test('venta a una tienda: buscar, agregar, facturar, ver ticket y PDF', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/pedidos');
    await page.getByRole('button', { name: /nueva venta/i }).first().click();
    await expect(page).toHaveURL(/\/torogoz\/venta$/);
    const modal = page;
    await expect(modal.getByRole('heading', { name: 'Nueva venta' }).first()).toBeVisible();

    await modal.getByText('Elegir cliente…').click();
    await page.getByText('TIENDA LA ESQUINA', { exact: true }).last().click();
    await expect(modal.getByText(/Sólo venta libre/)).toBeVisible();

    // Buscar escribiendo y agregar con un toque; el segundo toque suma uno.
    const buscar = modal.getByLabel('Buscar producto');
    await buscar.fill('a');
    const primero = modal.getByRole('option').first();
    await expect(primero).toBeVisible();
    await primero.click();
    await buscar.fill('a');
    await modal.getByRole('option').first().click();
    await modal.getByRole('button', { name: 'Uno más' }).first().click();
    await expect(modal.locator('input[name^="cantidad-"]').first()).toHaveValue('3');
    // Sin ticketera, «imprimir» abriría el diálogo del navegador: acá se apaga.
    await modal.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await page.screenshot({ path: `${SALIDA}/venta-lista.png`, fullPage: true });

    await modal.getByRole('button', { name: /^Facturar$/ }).click();
    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc).toBeVisible({ timeout: 30_000 });
    await expect(doc.frameLocator('iframe[title="Vista previa del ticket"]').getByText('FACTURA').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/ticket.png`, fullPage: true });

    await doc.getByText('PDF', { exact: true }).click();
    await expect(doc.locator('iframe[title="Documento en PDF"]')).toBeVisible({ timeout: 20_000 });
    await expect(doc.getByRole('button', { name: /Descargar PDF/ })).toBeEnabled();
    // El visor de PDF no existe en el navegador sin pantalla: se baja el archivo
    // y se guarda para mirarlo (y para convertirlo a imagen si hace falta).
    const [descarga] = await Promise.all([
        page.waitForEvent('download'),
        doc.getByRole('button', { name: /Descargar PDF/ }).click(),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^FACTURA-\d{6}-[0-9A-F-]{36}\.pdf$/);
    await descarga.saveAs(`${SALIDA}/documento.pdf`);

    // Corregir: el documento nunca llegó a Hacienda, se retira y el pedido vuelve a la venta.
    await doc.getByRole('button', { name: 'Corregir' }).click();
    await expect(page).toHaveURL(/\/torogoz\/venta\/\d+$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Finalizar venta|Corregir venta/ }).first()).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/corregir.png`, fullPage: true });
});

test('a un contribuyente se le puede emitir Factura si la pide', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/pedidos');
    await page.getByRole('button', { name: /nueva venta/i }).first().click();
    const modal = page;
    await modal.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    // Por la ficha (tiene NRC) arranca en Crédito Fiscal; se cambia a Factura.
    await expect(modal.getByRole('radio', { name: 'Crédito Fiscal' })).toHaveAttribute('aria-checked', 'true');
    await modal.getByRole('radio', { name: 'Factura' }).click();
    await modal.getByLabel('Buscar producto').fill('a');
    await modal.getByRole('option').first().click();
    await modal.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await modal.getByRole('button', { name: /^Facturar$/ }).click();
    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc.getByRole('heading', { name: /^Factura/ })).toBeVisible({ timeout: 30_000 });
});

test('pago dividido: $2 en efectivo y el resto con tarjeta, comprobante después', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/pedidos');
    await page.getByRole('button', { name: /nueva venta/i }).first().click();
    const modal = page;
    await modal.getByText('Elegir cliente…').click();
    await page.getByText('TIENDA LA ESQUINA', { exact: true }).last().click();
    await modal.getByLabel('Buscar producto').fill('a');
    await modal.getByRole('option').first().click();
    await modal.getByRole('button', { name: 'Uno más' }).first().click();

    await modal.getByRole('button', { name: 'Dividir el pago' }).click();
    // La nueva forma (transferencia) entra arriba y lleva monto; el efectivo
    // queda último y es «lo que falta».
    await modal.locator('input[name^="monto-pago-"]').first().fill('2');
    await expect(modal.getByText('Lo que falta')).toBeVisible();
    await expect(modal.getByText(/Comprobante pendiente/)).toBeVisible();
    await modal.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await page.screenshot({ path: `${SALIDA}/pago-dividido.png`, fullPage: true });
    await modal.getByRole('button', { name: /^Facturar$/ }).click();

    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc).toBeVisible({ timeout: 30_000 });
    await doc.getByText('Datos', { exact: true }).click();
    await expect(doc.getByText('Falta el comprobante')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/pagos-en-documento.png`, fullPage: true });
});

test('venta como en la caja: presentación, lista, descuento y el cambio del efectivo, con el cobro abajo', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    // La lista del encabezado sale de la ficha del cliente.
    await expect(page.getByText('Premium').first()).toBeVisible();
    await page.getByRole('radio', { name: 'Factura' }).click();

    await page.getByLabel('Buscar producto').fill('transpore');
    await page.getByRole('option').first().click();
    const renglon = page.locator('[data-renglon]').first();
    await expect(renglon).toBeVisible();

    // Presentación: de unidad a paquete (12 unidades, otro precio).
    const precioUnidad = await renglon.getByTestId('precio-renglon').innerText();
    await renglon.getByLabel(/Presentación de/).click();
    await page.getByRole('option', { name: /PAQUETE/ }).click();
    await expect(renglon.getByTestId('precio-renglon')).not.toHaveText(precioUnidad);

    // Descuento de 5%. (El tope de la empresa no frena a esta cuenta: tiene
    // la capacidad de configurar Distribución. El freno se probó en la base.)
    await renglon.locator('input[name^="descuento-"]').fill('5');
    await expect(page.getByText('Descuentos')).toBeVisible();

    // Efectivo: entrega un billete grande y se ve el cambio.
    await page.locator('input[name^="recibido-pago-"]').fill('100');
    await expect(page.getByText('Cambio').first()).toBeVisible();

    // El cobro va DEBAJO de los productos, no al costado.
    const yProductos = (await renglon.boundingBox()).y;
    const yCobro = (await page.getByText('Forma de pago').boundingBox()).y;
    expect(yCobro).toBeGreaterThan(yProductos);

    await page.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await page.screenshot({ path: `${SALIDA}/venta-caja.png`, fullPage: true });
    // El total de la pantalla sale del mismo motor que el documento: tiene que
    // ser EXACTAMENTE el que Hacienda recibe, no «uno parecido».
    const totalPantalla = (await page.getByTestId('total-venta').innerText()).trim();
    await page.getByRole('button', { name: /^Facturar$/ }).click();
    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc).toBeVisible({ timeout: 30_000 });
    await doc.getByText('Datos', { exact: true }).click();
    await expect(doc.getByText(totalPantalla).first()).toBeVisible({ timeout: 15_000 });
    await doc.getByText('Ticket', { exact: true }).click();
    await expect(doc.frameLocator('iframe[title="Vista previa del ticket"]').getByText(/PAQUETE/).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/venta-caja-ticket.png`, fullPage: true });
});

test('pedidos separados en pendientes y finalizados; la venta lista las pendientes para finalizarlas', async ({ page }) => {
    await entrar(page);
    // Pedidos abre en Pendientes: sólo preventas.
    await page.goto('/torogoz/pedidos');
    await expect(page).toHaveURL(/\/torogoz\/pedidos/);
    await page.waitForTimeout(2500);
    const estadosPendientes = await page.locator('table tbody tr').allInnerTexts();
    expect(estadosPendientes.every(t => /PREVENTA|DESCUENTO POR APROBAR/i.test(t) || /Sin pendientes/i.test(t))).toBe(true);
    // Finalizados: ninguna preventa, y la pestaña queda en la dirección.
    await page.getByRole('tab', { name: 'Finalizados' }).click();
    await expect(page).toHaveURL(/vista=finalizados/);
    await page.waitForTimeout(1500);
    const finalizados = await page.locator('table tbody tr').allInnerTexts();
    expect(finalizados.some(t => /PREVENTA/i.test(t))).toBe(false);
    await page.screenshot({ path: `${SALIDA}/pedidos-finalizados.png`, fullPage: true });

    // En la venta nueva, arriba, las pendientes: se elige una y se abre para finalizar.
    await page.goto('/torogoz/venta');
    const lista = page.locator('[data-pendiente]');
    await expect(lista.first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/venta-pendientes.png`, fullPage: true });
    await lista.first().click();
    await expect(page).toHaveURL(/\/torogoz\/venta\/\d+$/);
    await expect(page.getByRole('heading', { name: /Finalizar venta/ }).first()).toBeVisible();
    await expect(page.locator('[data-renglon]').first()).toBeVisible();
});
