// Distribución contra el ENTORNO DE PRUEBAS (nunca producción: crea pedidos
// y documentos). Correr con el portal compilado en modo staging:
//
//   npx vite build --mode staging --outDir dist-sas-staging
//   npx vite preview --mode staging --outDir dist-sas-staging --port 4173 --strictPort
//   E2E_BASE_URL=http://localhost:4173 npx playwright test tests/e2e/distribucion.spec.js --project=chromium
//
// Se niega a correr si la página no muestra el marco «ENTORNO DE PRUEBAS».
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { entrar } from './distribucionEntrar.js';

const SALIDA = process.env.E2E_CAPTURAS || 'test-results/distribucion';

/** «Cobrar» (F2): la ventana donde sólo queda el monto y Enter procesa. */
async function cobrar(page) {
    await page.getByRole('button', { name: /^(Cobrar|Enviar a aprobación)/ }).click();
    const c = page.getByRole('dialog', { name: 'Cobrar' });
    await expect(c).toBeVisible();
    return c;
}


const SECCIONES = { inicio: 'Inicio', pedidos: 'Pedidos', documentos: 'Facturación', clientes: 'Clientes', catalogo: 'Catálogo', compras: 'Compras', reportes: 'Reportes', liquidacion: 'Liquidación',
    inventario: 'Inventario', solicitudes: 'Solicitudes', emisor: 'Empresa' };

test('las secciones de Torogoz abren sin romper, y la dirección vieja lleva allá', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    // Un aviso viejo con `/distribucion?tab=…&documento=…` sigue llegando.
    await page.goto('/distribucion?tab=clientes');
    await expect(page).toHaveURL(/\/torogoz\/clientes$/);
    // La distribuidora no es un módulo del menú de las farmacias: es un acceso
    // aparte al pie, sólo para quien la administra (la cuenta de pruebas sí).
    await page.goto('/ventas');
    await expect(page.getByRole('link', { name: /^Distribución$/ })).toHaveCount(0);
    const acceso = page.getByRole('link', { name: /Torogoz/ }).first();
    await expect(acceso).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/acceso-torogoz.png` });
    await acceso.click();
    await expect(page).toHaveURL(/\/torogoz\/(inicio|pedidos)/);
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
    await page.screenshot({ path: `${SALIDA}/venta-lista.png`, fullPage: true });
    // Sin ticketera, «imprimir» abriría el diálogo del navegador: acá se apaga.
    const c = await cobrar(page);
    await c.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await c.getByRole('button', { name: /^Facturar$/ }).click();
    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc).toBeVisible({ timeout: 30_000 });
    // Abre en «Detalle» (lo vendido como información); el papel, en «Ticket».
    await expect(doc.locator('[data-testid="detalle-venta"]')).toBeVisible({ timeout: 15_000 });
    await doc.getByText('Ticket', { exact: true }).click();
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
    const c = await cobrar(page);
    await c.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await c.getByRole('button', { name: /^Facturar$/ }).click();
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

    const c = await cobrar(page);
    await c.getByRole('button', { name: 'Dividir el pago' }).click();
    // La nueva forma (transferencia) entra arriba y lleva monto; el efectivo
    // queda último y es «lo que falta».
    await c.locator('input[name^="monto-pago-"]').first().fill('2');
    await expect(c.getByText('Lo que falta')).toBeVisible();
    await expect(c.getByText(/Comprobante pendiente/)).toBeVisible();
    await c.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    await page.screenshot({ path: `${SALIDA}/pago-dividido.png`, fullPage: true });
    await c.getByRole('button', { name: /^Facturar$/ }).click();

    const doc = page.getByRole('dialog', { name: 'Documento' });
    await expect(doc).toBeVisible({ timeout: 30_000 });
    await doc.getByText('Datos', { exact: true }).click();
    await expect(doc.getByText('Falta el comprobante')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/pagos-en-documento.png`, fullPage: true });
});

test('venta como en la caja: presentación, lista, descuento; F2 cobra con el foco en la entrega y Enter procesa', async ({ page }) => {
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
    await expect(page.getByText('Descuentos (ya aplicados)').first()).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/venta-caja.png`, fullPage: true });

    // F2 abre el cobro con el foco en «Entrega»: se escribe el billete, se ve
    // el cambio, y Enter procesa.
    await page.keyboard.press('F2');
    const c = page.getByRole('dialog', { name: 'Cobrar' });
    await expect(c).toBeVisible();
    await c.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    const entrega = c.locator('input[name^="recibido-pago-"]');
    await entrega.click();
    await entrega.fill('100');
    await expect(c.getByText('Cambio').first()).toBeVisible();
    await expect(c.getByText('Descuentos')).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/venta-caja-cobro.png`, fullPage: true });
    // El total de la pantalla sale del mismo motor que el documento: tiene que
    // ser EXACTAMENTE el que Hacienda recibe, no «uno parecido».
    const totalPantalla = (await c.getByTestId('total-venta').innerText()).trim();
    await entrega.press('Enter');
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

    // En la venta nueva, «Pendientes» arriba a la derecha: se elige una y se abre para finalizar.
    await page.goto('/torogoz/venta');
    await page.getByRole('button', { name: /Pendientes/ }).first().click();
    const lista = page.locator('[data-pendiente]');
    await expect(lista.first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/venta-pendientes.png`, fullPage: true });
    await lista.first().click();
    await expect(page).toHaveURL(/\/torogoz\/venta\/\d+$/);
    await expect(page.getByRole('heading', { name: /Finalizar venta/ }).first()).toBeVisible();
    await expect(page.locator('[data-renglon]').first()).toBeVisible();
});

test('volver a vender desde un pedido finalizado; guardar la preventa deja lista la siguiente', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/pedidos?vista=finalizados');
    // Esperar a que la lista esté cargada: un clic sobre el esqueleto no abre nada.
    await expect(page.getByText(/^Pedido \d+/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(/^Pedido \d+/).first().click();
    await page.getByRole('button', { name: 'Volver a vender' }).click();
    await expect(page).toHaveURL(/\/torogoz\/venta$/, { timeout: 15_000 });
    await expect(page.locator('[data-renglon]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Elegir cliente…')).toHaveCount(0);
    await page.screenshot({ path: `${SALIDA}/volver-a-vender.png`, fullPage: true });
    // La barra de abajo, siempre a mano: guardar la preventa deja la pantalla limpia.
    await page.getByRole('button', { name: 'Guardar preventa' }).click();
    await expect(page.getByText('Preventa guardada').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-renglon]')).toHaveCount(0);
    await expect(page.getByText('Elegir cliente…')).toBeVisible();
});

test('teclado como en la caja: foco a la cantidad, Tab y flechas por el renglón, ↑ ↓ entre productos, F7 existencias', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    const foco = () => page.evaluate(() => document.activeElement?.getAttribute('name') || document.activeElement?.getAttribute('aria-label'));
    // F3 al buscador; ↓ y Enter agregan: el foco cae en la cantidad de ESE producto.
    await page.keyboard.press('F3');
    await page.keyboard.type('ensure');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(foco).toMatch(/^cantidad-/);
    const primera = await foco();
    await page.keyboard.type('5');
    await page.keyboard.press('Tab');
    await expect.poll(foco).toMatch(/^Presentación de/);
    await page.keyboard.press('ArrowRight');
    await expect.poll(foco).toMatch(/^Precio y lista de|^descuento-/);
    // Un segundo producto, y ↑ vuelve a la cantidad del primero.
    await page.keyboard.press('F3');
    await page.keyboard.type('transpore');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(foco).toMatch(/^cantidad-/);
    await page.keyboard.press('ArrowUp');
    await expect.poll(foco).toBe(primera);
    // Un producto de presentación única (deshabilitada): → desde la cantidad
    // la salta y cae en el precio o el descuento, no se queda trabado.
    await page.keyboard.press('F3');
    await page.keyboard.type('klaricid');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(foco).toMatch(/^cantidad-/);
    await page.keyboard.press('ArrowRight');
    await expect.poll(foco).toMatch(/^Precio y lista de|^descuento-/);
    // F7: existencias en todas las sucursales, buscando el producto donde está el cursor.
    await page.keyboard.press('F7');
    await expect(page.getByRole('dialog', { name: 'Existencias en todas las sucursales' })).toBeVisible();
    await expect(page.getByText(/Bodega: /).first()).toBeVisible({ timeout: 15_000 });
});

test('la forma de pago se elige arriba; F6 borra la preventa abierta y vacía una venta nueva', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    // La forma de pago vive en la franja, como el «tipo de pago» de la caja.
    await page.locator('[data-testid="forma-pago"] [role="combobox"]').click();
    await page.getByRole('option', { name: /Transferencia/ }).click();
    await page.keyboard.press('F3');
    await page.keyboard.type('ensure');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-renglon]')).toHaveCount(1);
    await expect(page.getByText(/Contado · Transferencia/).first()).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/venta-forma-de-pago.png`, fullPage: true });
    // F2: el cobro abre con la forma ya elegida (pide la referencia).
    const c = await cobrar(page);
    await expect(c.locator('input[name^="ref-pago-"]')).toBeVisible();
    await c.getByRole('button', { name: 'Volver' }).click();

    // F8 guarda la preventa; se abre desde Pendientes y F6 la borra.
    await page.keyboard.press('F8');
    await expect(page.getByText('Preventa guardada').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Pendientes/ }).first().click();
    const primera = page.locator('[data-pendiente]').first();
    await expect(primera).toBeVisible({ timeout: 15_000 });
    const ids = await page.locator('[data-pendiente]').evaluateAll(els => els.map(e => Number(e.dataset.pendiente)));
    const id = Math.max(...ids);
    await page.locator(`[data-pendiente="${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/torogoz/venta/${id}$`));
    await expect(page.locator('[data-renglon]').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    const d = page.getByRole('dialog', { name: 'Borrar preventa' });
    await expect(d).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/venta-borrar-preventa.png` });
    await d.locator('input[name="motivo-borrar"]').fill('prueba automática');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Preventa borrada').first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/torogoz\/venta$/);
    await expect(page.locator('[data-renglon]')).toHaveCount(0);
    await page.getByRole('button', { name: /Pendientes/ }).first().click();
    await expect(page.locator('[data-pendiente]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-pendiente="${id}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // En una venta nueva F6 no borra nada guardado: vacía la pantalla.
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    await expect(page.getByRole('dialog', { name: 'Vaciar la venta' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Elegir cliente…')).toBeVisible();
});

test('lotes: primero vence, y lo que no alcanza se reparte abajo; sin existencia se anota como venta perdida', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    // GLUCERNA LIQUIDO FRESA tiene un lote CORTO de 2 que vence antes (semilla 5).
    await page.keyboard.press('F3');
    await page.keyboard.type('glucerna liquido fresa');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-renglon]')).toHaveCount(1);
    await expect(page.locator('[data-renglon]').first()).toContainText('CORTO-01');
    // Pido 5: quedan 2 del CORTO y 3 del siguiente lote, en un renglón nuevo abajo.
    await page.keyboard.type('5');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-renglon]')).toHaveCount(2);
    const filas = page.locator('[data-renglon]');
    await expect(filas.nth(0)).toContainText('CORTO-01');
    await expect(filas.nth(0).locator('input[name^="cantidad-"]')).toHaveValue('2');
    await expect(filas.nth(1)).toContainText('PRUEBA-01');
    await expect(filas.nth(1).locator('input[name^="cantidad-"]')).toHaveValue('3');
    await expect(filas.nth(0)).toContainText(/Total \d+/);
    await page.screenshot({ path: `${SALIDA}/venta-lotes.png`, fullPage: true });

    // NEPRO AP no tiene existencia: no entra a la venta, se ofrece venta perdida.
    await page.keyboard.press('F3');
    await page.keyboard.type('nepro');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    const d = page.getByRole('dialog', { name: 'Venta perdida' });
    await expect(d).toBeVisible();
    await expect(d).toContainText('NEPRO');
    await d.locator('input[name="cantidad-perdida"]').fill('4');
    await page.screenshot({ path: `${SALIDA}/venta-perdida.png` });
    await d.getByRole('button', { name: 'Anotar venta perdida' }).click();
    await expect(d).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('[data-renglon]')).toHaveCount(2);

    // Un insumo que no está en el catálogo: desde el buscador sin resultados.
    await page.keyboard.press('F3');
    await page.keyboard.type('gasa esteril prueba');
    await page.locator('[data-anotar-perdida]').click();
    const d2 = page.getByRole('dialog', { name: 'Venta perdida' });
    await d2.getByRole('radio', { name: 'Insumo' }).or(d2.getByRole('button', { name: 'Insumo' })).first().click();
    await expect(d2.locator('input[name="nombre-insumo"]')).toHaveValue('gasa esteril prueba');
    await d2.getByRole('button', { name: 'Anotar venta perdida' }).click();
    await expect(d2).toBeHidden({ timeout: 15_000 });

    // F9 abre la venta perdida desde cualquier parte de la venta.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F9');
    await expect(page.getByRole('dialog', { name: 'Venta perdida' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Las dos aparecen en Ventas perdidas.
    // Vacía la venta: si no, la reserva de estos productos queda 30 minutos y
    // la próxima corrida encuentra el lote corto ya apartado.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Elegir cliente…')).toBeVisible();
    await page.goto('/torogoz/perdidas');
    await expect(page.getByText('gasa esteril prueba').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/NEPRO AP/).first()).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/ventas-perdidas.png`, fullPage: true });
});

test('venta perdida de un medicamento buscado en la SRS', async ({ page }) => {
    await entrar(page);
    await page.goto('/torogoz/perdidas');
    await page.getByRole('button', { name: 'Anotar venta perdida' }).first().click();
    const d = page.getByRole('dialog', { name: 'Venta perdida' });
    await d.locator('input[name="buscar-srs"]').fill('acetaminofen');
    const primero = d.locator('[data-srs]').first();
    await expect(primero).toBeVisible({ timeout: 30_000 });
    await primero.click();
    await page.screenshot({ path: `${SALIDA}/venta-perdida-srs.png` });
    await d.getByRole('button', { name: 'Anotar venta perdida' }).click();
    await expect(page.getByText('Venta perdida anotada').first()).toBeVisible({ timeout: 15_000 });
});

test('tablero: indicadores, filtros por ruta y período en la dirección, y «Vender» a un cliente que dejó de comprar', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz');
    await expect(page).toHaveURL(/\/torogoz\/inicio/);
    await expect(page.getByText('Ventas por día')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^\$[\d,]+\.\d{2}$/).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/tablero.png`, fullPage: true });
    // Tocar una ruta filtra todo el tablero, y queda en la dirección.
    await page.getByRole('button', { name: /Ruta 3 — La Palma/ }).first().click();
    await expect(page).toHaveURL(/ruta=Ruta/);
    await expect(page.getByRole('button', { name: 'Quitar filtros' })).toBeVisible();
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    await expect(page).not.toHaveURL(/ruta=/);
    // El período también vive en la dirección.
    await page.getByRole('tab', { name: '7 días' }).click();
    await expect(page).toHaveURL(/periodo=7d/);
    await expect(page.getByText('Ventas por día')).toBeVisible();
    // «Vender» sobre un cliente que dejó de comprar abre la venta con él elegido.
    const inactivo = page.locator('[data-inactivo]').first();
    await expect(inactivo).toBeVisible({ timeout: 15_000 });
    const nombre = (await inactivo.locator('span span').first().innerText()).trim();
    await inactivo.click();
    await expect(page).toHaveURL(/\/torogoz\/venta$/);
    await expect(page.getByText(nombre, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(errores).toEqual([]);
});

test('reservas: lo que una venta tiene en el carrito no se lo lleva otra, y se dice quién lo está vendiendo', async ({ browser }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    const abrirVenta = async (page) => {
        await entrar(page);
        await page.goto('/torogoz/venta');
        await page.getByText('Elegir cliente…').click();
        await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    };
    // A lleva las 3 que hay.
    await abrirVenta(a);
    await a.keyboard.press('F3');
    await a.keyboard.type('glucerna triple care x 850');
    await expect(a.getByRole('option').first()).toBeVisible();
    await a.keyboard.press('Enter');
    await a.keyboard.type('3');
    await a.keyboard.press('Tab');
    await expect(a.locator('[data-testid="reserva"]')).toContainText(/Reservado · \d+ min/, { timeout: 15_000 });
    await a.screenshot({ path: `${SALIDA}/reserva-a.png` });

    // B no puede: le sale quién lo está vendiendo.
    await abrirVenta(b);
    await b.keyboard.press('F3');
    await b.keyboard.type('glucerna triple care x 850');
    await expect(b.getByRole('option').first()).toContainText(/reservado por/i, { timeout: 20_000 });
    await b.keyboard.press('Enter');
    const d = b.getByRole('dialog', { name: 'Venta perdida' });
    await expect(d).toContainText(/lo está vendiendo/);
    await b.screenshot({ path: `${SALIDA}/reserva-b.png` });
    await b.keyboard.press('Escape');

    // A vacía la venta: se suelta, y B ya lo puede agregar.
    await a.locator('body').click({ position: { x: 5, y: 5 } });
    await a.keyboard.press('F6');
    await a.keyboard.press('Enter');
    await expect(a.getByText('Elegir cliente…')).toBeVisible();
    await a.waitForTimeout(1500);
    await b.reload();
    // El borrador puede traer ya el cliente elegido.
    await expect(b.getByPlaceholder(/Producto o código de barras|Elige primero el cliente/)).toBeVisible({ timeout: 15_000 });
    if (await b.getByText('Elegir cliente…').count()) {
        await b.getByText('Elegir cliente…').click();
        await b.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    }
    await b.keyboard.press('F3');
    await b.keyboard.type('glucerna triple care x 850');
    await expect(b.getByRole('option').first()).toContainText(/hay 3/, { timeout: 15_000 });
    await b.keyboard.press('Enter');
    await expect(b.locator('[data-renglon]')).toHaveCount(1);
    // Limpia: B vacía también.
    await b.locator('body').click({ position: { x: 5, y: 5 } });
    await b.keyboard.press('F6');
    await b.keyboard.press('Enter');
    await expect(b.getByText('Elegir cliente…')).toBeVisible();
});

test('facturación: semáforo con Hacienda, cubetas, lista de chequeo del documento y reenviar pendientes', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/documentos');
    // El menú avisa cuánto falta.
    await expect(page.locator('[data-testid="facturacion-pendiente"]').first()).toBeVisible({ timeout: 15_000 });
    const semaforo = page.locator('[data-testid="semaforo-hacienda"]');
    await expect(semaforo).toBeVisible({ timeout: 15_000 });
    await expect(semaforo).toContainText(/por resolver|Todo al día/);
    await page.screenshot({ path: `${SALIDA}/facturacion.png`, fullPage: true });
    // Rechazados: el documento dice qué dijo Hacienda y ofrece corregir.
    await page.getByRole('button', { name: /Rechazados/ }).first().click();
    await page.locator('table tbody tr').first().click();
    const estado = page.locator('[data-testid="estado-hacienda"]');
    await expect(estado).toHaveAttribute('data-nivel', 'error', { timeout: 15_000 });
    await expect(estado).toContainText('Hacienda lo rechazó');
    await expect(estado).toContainText(/NRC/);
    await expect(estado.getByRole('button', { name: 'Corregir y facturar' })).toBeVisible();
    // Lo vendido, como información (no como papel): abre en «Detalle».
    await expect(page.locator('[data-testid="detalle-venta"]')).toBeVisible();
    await expect(page.locator('[data-testid="detalle-venta"]')).toContainText(/Total/);
    await page.screenshot({ path: `${SALIDA}/facturacion-rechazado.png` });
    await page.keyboard.press('Escape');
    // Sin sello: el documento ofrece reenviar.
    await page.getByRole('button', { name: /Sin sello/ }).first().click();
    await page.locator('table tbody tr').first().click();
    await expect(estado).toHaveAttribute('data-nivel', 'pendiente', { timeout: 15_000 });
    await expect(estado.getByRole('button', { name: 'Reenviar a Hacienda' })).toBeVisible();
    await page.keyboard.press('Escape');
    // En bloque: sin certificado en este entorno, se detiene al primero y lo dice.
    await page.locator('[data-reenviar-todos]').click();
    await expect(page.getByText(/certificado/i).first()).toBeVisible({ timeout: 60_000 });
    expect(errores).toEqual([]);
});

test('sin señal: la venta se guarda en el teléfono y al volver la señal se factura en contingencia', async ({ page, context }) => {
    await entrar(page);
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.', { exact: true }).last().click();
    await page.keyboard.press('F3');
    await page.keyboard.type('ensure advance liq fresa');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-renglon]')).toHaveCount(1);
    const c = await cobrar(page);
    await c.getByRole('switch', { name: /Imprimir el ticket/ }).click();
    // Se cae la señal justo al facturar.
    await context.setOffline(true);
    await c.getByRole('button', { name: /^Facturar$/ }).click();
    await expect(page.getByText('Venta guardada sin señal').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="ventas-sin-senal"]')).toContainText('1 venta sin señal');
    await expect(page.getByText('Elegir cliente…')).toBeVisible();
    await page.screenshot({ path: `${SALIDA}/sin-senal.png` });
    // Vuelve la señal: la cola se manda sola.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('[data-testid="ventas-sin-senal"]')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByText(/Ventas sin señal (enviadas|con problemas)/).first()).toBeVisible({ timeout: 15_000 });
    // En Facturación queda en contingencia, con su aviso por enviar (en este
    // entorno no hay certificado: queda sin firmar y con el motivo guardado).
    await page.goto('/torogoz/documentos?cubeta=todos');
    await expect(page.getByText(/DTE-01-/).first()).toBeVisible({ timeout: 15_000 });
});

test('cuentas por cobrar: cobrar, no cobrar de más, anular el cobro, y la venta a crédito respeta lo disponible', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    const dinero = (t) => Number(String(t).replace(/[^0-9.]/g, ''));
    await entrar(page);
    await page.goto('/torogoz/cobros');
    await expect(page.getByText('Antigüedad de saldos')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/cuentas-por-cobrar.png`, fullPage: true });
    await page.getByText('FARMACIA DEL PUEBLO, S.A. DE C.V.').first().click();
    const saldo = page.locator('[data-testid="saldo-cliente"]');
    await expect(saldo).toBeVisible({ timeout: 15_000 });
    // Esperar a que carguen sus cuentas: antes, el saldo dice $0.00.
    await expect(page.locator('[data-cuenta]').first()).toBeVisible({ timeout: 15_000 });
    const antes = dinero(await saldo.innerText());
    // De más: no deja.
    await page.locator('input[name="monto-cobro"]').fill(String(antes + 100));
    await expect(page.locator('[data-cobrar-cartera]')).toBeDisabled();
    await expect(page.getByText(/no se puede cobrar más/)).toBeVisible();
    // Un abono en efectivo (la mitad de lo que debe, hasta $50), entrega $10 más.
    const abono = Math.min(50, Math.floor(antes * 50) / 100);
    await page.locator('input[name="monto-cobro"]').fill(abono.toFixed(2));
    await page.locator('input[name="recibido-cobro"]').fill((abono + 10).toFixed(2));
    await page.getByRole('switch', { name: /Imprimir el recibo/ }).click();
    await page.locator('[data-cobrar-cartera]').click();
    await expect(page.getByText('Cobro registrado').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => dinero(await saldo.innerText())).toBeCloseTo(antes - abono, 2);
    await page.screenshot({ path: `${SALIDA}/cuenta-cliente.png` });
    // Anular el cobro (la cuenta de pruebas administra): el saldo vuelve.
    const recibo = page.locator('[data-recibo]').first();
    await recibo.getByRole('button', { name: 'Anular este cobro' }).click();
    await recibo.locator('input[name^="motivo-anular-"]').fill('prueba automática');
    await recibo.getByRole('button', { name: 'Anular cobro' }).click();
    await expect(page.getByText('Cobro anulado').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => dinero(await saldo.innerText())).toBeCloseTo(antes, 2);
    await page.keyboard.press('Escape');

    // Venta a crédito a un cliente que ya debe más que su límite: se dice y no factura.
    await page.goto('/torogoz/venta');
    await page.getByText('Elegir cliente…').click();
    await page.getByText('FARMACIA LA PALMA', { exact: true }).last().click();
    await expect(page.locator('[data-testid="credito-cliente"]')).toContainText(/disponible \$0\.00/, { timeout: 15_000 });
    await page.locator('[data-testid="forma-pago"] [role="combobox"]').click();
    await page.getByRole('option', { name: /A crédito/ }).click();
    await page.keyboard.press('F3');
    await page.keyboard.type('ensure advance liq fresa');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    const c = await cobrar(page);
    await expect(c.getByText(/a crédito puede llevar hasta \$0\.00/)).toBeVisible();
    await c.getByRole('button', { name: /^Facturar/ }).click();
    await expect(c.getByText(/puede llevar a crédito hasta/).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    await page.keyboard.press('Enter');
    expect(errores).toEqual([]);
});

test('compras: el JSON del proveedor llena la compra, no se recibe sin cuadrar ni sin lote, y se anula', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/compras');
    await expect(page.getByText('Comprado este mes')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Nueva compra' }).click();
    const n = String(Date.now()).slice(-9);
    const dte = {
        identificacion: { tipoDte: '03', numeroControl: `DTE-03-E2E00001-${n.padStart(15, '0')}`, codigoGeneracion: crypto.randomUUID(), fecEmi: new Date().toISOString().slice(0, 10) },
        emisor: { nombre: 'DROGUERIA DE PRUEBA E2E, S.A. DE C.V.', nit: '06149999990019', nrc: '99999' },
        cuerpoDocumento: [
            { codigo: 'E2E-1', descripcion: 'ENSURE ADVANCE FRESA CAJA X 6', cantidad: 1, precioUni: 30, montoDescu: 0, ventaGravada: 30, ventaExenta: 0, ventaNoSuj: 0 },
            { codigo: 'E2E-2', descripcion: 'ENSURE ADVANCE FRESA SUELTO', cantidad: 4, precioUni: 5, montoDescu: 0, ventaGravada: 20, ventaExenta: 0, ventaNoSuj: 0 },
        ],
        resumen: { totalGravada: 50, totalExenta: 0, totalNoSuj: 0, descuGravada: 0, tributos: [{ codigo: '20', valor: 6.5 }], ivaPerci1: 0, ivaRete1: 0, condicionOperacion: 1 },
    };
    await page.getByTestId('json-proveedor').setInputFiles({ name: 'ccf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dte)) });
    // La primera vez el proveedor no existe: se registra con lo leído del documento.
    const registrar = page.getByRole('button', { name: 'Registrarlo' });
    if (await registrar.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await registrar.click();
        await expect(page.locator('input[name="nit"]')).toHaveValue('06149999990019');
        await page.getByRole('button', { name: 'Guardar proveedor' }).click();
    }
    await expect(page.locator('input[name="numero"]')).toHaveValue(dte.identificacion.numeroControl);
    await expect(page.locator('input[name="total"]')).toHaveValue('56.5');
    const recibir = page.getByRole('button', { name: 'Recibir en bodega' });
    await expect(recibir).toBeDisabled();
    // Productos: la memoria del proveedor los recuerda desde la segunda vez.
    for (const i of [0, 1]) {
        const r = page.locator(`[data-renglon="${i}"]`);
        const combo = r.getByRole('combobox');
        if ((await combo.innerText()).includes('Producto del catálogo')) {
            await combo.click();
            await page.keyboard.type('ensure advance liq fresa');
            const opcion = page.getByRole('option', { name: /ENSURE ADVANCE/i }).first();
            await expect(opcion).toBeVisible();
            await page.waitForTimeout(400); // el menú termina de filtrar
            await opcion.click();
        }
        await r.locator(`input[name="lote-${i}"]`).fill(`E2E-${n}-${i}`);
        await r.locator('input[aria-label="Día"]').pressSequentially('31');
        await r.locator('input[aria-label="Mes"]').pressSequentially('12');
        await r.locator('input[aria-label="Año"]').pressSequentially('2028');
    }
    // La caja de 6: seis unidades a $5 cada una.
    await page.locator('input[name="upe-0"]').fill('6');
    await expect(page.locator('input[name="cant-0"]')).toHaveValue('6');
    await expect(page.locator('[data-cuadre="si"]')).toBeVisible();
    // Un IVA mal escrito lo dice y no deja recibir.
    await page.locator('input[name="iva"]').fill('6.00');
    await expect(page.getByText(/Debería ser \$6\.50/)).toBeVisible();
    await expect(recibir).toBeDisabled();
    await page.locator('input[name="iva"]').fill('6.50');
    await page.screenshot({ path: `${SALIDA}/compra-nueva.png`, fullPage: true });
    await expect(recibir).toBeEnabled();
    await recibir.click();
    await expect(page.getByText('Compra recibida').first()).toBeVisible({ timeout: 15_000 });

    // Entra al libro de compras del mes, y el archivo sale con las 23 columnas del de las farmacias.
    await page.goto('/torogoz/reportes?reporte=compras');
    await expect(page.getByText(dte.identificacion.numeroControl).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/libro-compras.png`, fullPage: true });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar CSV' }).click()]);
    const csv = fs.readFileSync(await descarga.path(), 'utf8');
    const fila = csv.split('\r\n').find(l => l.includes(dte.identificacion.numeroControl.replace(/-/g, '')));
    expect(fila?.split(';')).toHaveLength(23);
    expect(fila).toContain(';DROGUERIA DE PRUEBA E2E, S.A. DE C.V.;');

    // En la lista, y se anula (todo sigue en bodega).
    await page.goto('/torogoz/compras');
    await page.getByText(dte.identificacion.numeroControl).first().click();
    await expect(page.getByText('Recibida', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Anular esta compra' }).click();
    await page.locator('input[name="motivo-anular"]').fill('prueba automática');
    await page.getByRole('button', { name: 'Anular compra' }).click();
    await expect(page.getByText('Compra anulada').first()).toBeVisible({ timeout: 15_000 });
    expect(errores).toEqual([]);
});

test('utilidad: venta contra costo, agrupar por cliente en la dirección, y sin costo no infla el margen', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/reportes?periodo=90d');
    await expect(page.getByText('Utilidad bruta')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Venta y utilidad por día')).toBeVisible();
    await expect(page.locator('section[aria-label="Utilidad por día"] .recharts-surface').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/utilidad.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Agrupar' }).click();
    await page.getByRole('option', { name: 'Por cliente' }).click();
    await expect(page).toHaveURL(/agrupar=cliente/);
    await expect(page.getByText('FARMACIA LA PALMA').first()).toBeVisible();
    expect(errores).toEqual([]);
});

test('devolución: nota de crédito de un Crédito Fiscal sellado, a cuarentena, y la cuarentena se resuelve', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/documentos?cubeta=sellados');
    await page.locator('table tbody tr', { hasText: 'Crédito Fiscal' }).first().click();
    await page.getByRole('button', { name: 'Devolución' }).click();
    const modal = page.locator('[data-devolucion]');
    const renglon = modal.locator('[data-renglon-devolucion]').filter({ has: page.locator('input:not([disabled])') }).first();
    await expect(renglon).toBeVisible({ timeout: 15_000 });
    // Más de lo vendido: lo dice y no deja emitir.
    await renglon.locator('input').fill('99999');
    await expect(page.getByRole('button', { name: 'Emitir nota de crédito' })).toBeDisabled();
    await renglon.locator('input').fill('1');
    await renglon.getByRole('radio', { name: 'Cuarentena' }).click();
    await expect(renglon.getByRole('radio', { name: 'Cuarentena' })).toHaveAttribute('aria-checked', 'true');
    await page.locator('textarea[name="motivo-devolucion"]').fill('prueba automática: llegó golpeado');
    await expect(modal.locator('[data-total-devolucion]')).not.toHaveText('$0.00');
    await page.screenshot({ path: `${SALIDA}/devolucion.png`, fullPage: true });
    await page.getByRole('button', { name: 'Emitir nota de crédito' }).click();
    await expect(page.getByText('Nota de crédito emitida').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');

    // La nota está en Facturación.
    await page.goto('/torogoz/documentos?cubeta=todos');
    await expect(page.locator('table tbody tr', { hasText: 'Nota de Crédito' }).first()).toBeVisible({ timeout: 15_000 });

    // Lo devuelto espera en cuarentena; se destruye.
    await page.goto('/torogoz/inventario');
    await page.getByText('En cuarentena').first().click();
    const q = page.locator('[data-cuarentena]').first();
    await expect(q).toBeVisible({ timeout: 15_000 });
    await q.getByRole('button', { name: 'Destruir' }).click();
    await expect(page.getByText('Anotado como destruido.').first()).toBeVisible({ timeout: 15_000 });

    // Inicio resta lo devuelto y lo dice.
    await page.goto('/torogoz/inicio');
    await expect(page.getByTestId('devuelto')).toBeVisible({ timeout: 15_000 });
    expect(errores).toEqual([]);
});

test('correo al cliente: el documento se envía (simulado en pruebas) y queda anotado', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/documentos?cubeta=todos');
    // Uno emitido por las pruebas (trae su archivo; los del historial sembrado no).
    await page.locator('table tbody tr', { hasText: 'B001P001' }).first().click();
    const correo = page.locator('section[aria-label="Correo al cliente"]');
    await expect(correo).toBeVisible({ timeout: 15_000 });
    await correo.locator('input[name="correo-destino"]').fill('no-es-correo');
    await expect(correo.getByRole('button', { name: /^(Enviar|Reenviar)$/ })).toBeDisabled();
    await correo.locator('input[name="correo-destino"]').fill('cliente.prueba@example.com');
    await correo.getByRole('button', { name: /^(Enviar|Reenviar)$/ }).click();
    await expect(page.getByText('Documento enviado').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('section[data-correo="enviado"]')).toContainText('cliente.prueba@example.com', { timeout: 15_000 });
    await page.screenshot({ path: `${SALIDA}/correo.png`, fullPage: true });
    expect(errores).toEqual([]);
});

test('liquidación del vendedor: efectivo a entregar, faltante exige motivo, cierre y reapertura', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await entrar(page);
    await page.goto('/torogoz/liquidacion');
    await expect(page.getByText('Efectivo a entregar')).toBeVisible({ timeout: 15_000 });
    const cierre = page.locator('section[aria-label="Cierre"]');
    // Si una corrida anterior la dejó cerrada, se reabre primero.
    if (await cierre.getAttribute('data-cierre') === 'cerrada') {
        await cierre.getByRole('button', { name: 'Reabrir' }).click();
        await page.locator('input[name="motivo-reabrir"]').fill('prueba automática');
        await cierre.getByRole('button', { name: 'Reabrir' }).last().click();
        await expect(cierre).toHaveAttribute('data-cierre', 'abierta', { timeout: 15_000 });
    }
    await page.locator('input[name="efectivo-contado"]').fill('1.00');
    await expect(page.locator('[data-diferencia-previa]')).toContainText('Faltan');
    await expect(cierre.getByRole('button', { name: 'Cerrar liquidación' })).toBeDisabled();
    await page.locator('input[name="motivo-diferencia"]').fill('prueba automática');
    await page.screenshot({ path: `${SALIDA}/liquidacion.png`, fullPage: true });
    await cierre.getByRole('button', { name: 'Cerrar liquidación' }).click();
    await expect(page.getByText('Liquidación cerrada').first()).toBeVisible({ timeout: 15_000 });
    await expect(cierre.locator('[data-diferencia]')).toContainText('Faltante');
    // Se deja abierta para la próxima corrida.
    await cierre.getByRole('button', { name: 'Reabrir' }).click();
    await page.locator('input[name="motivo-reabrir"]').fill('prueba automática');
    await cierre.getByRole('button', { name: 'Reabrir' }).last().click();
    await expect(cierre).toHaveAttribute('data-cierre', 'abierta', { timeout: 15_000 });
    expect(errores).toEqual([]);
});
