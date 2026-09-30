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

/** «Cobrar» (F2): la ventana donde sólo queda el monto y Enter procesa. */
async function cobrar(page) {
    await page.getByRole('button', { name: /^(Cobrar|Enviar a aprobación)/ }).click();
    const c = page.getByRole('dialog', { name: 'Cobrar' });
    await expect(c).toBeVisible();
    return c;
}


const SECCIONES = { inicio: 'Inicio', pedidos: 'Pedidos', documentos: 'Facturación', clientes: 'Clientes', catalogo: 'Catálogo',
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
