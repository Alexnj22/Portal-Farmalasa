// El carné de papel: el ticket que sale del rollo y se pasa por el lector.
//
// ── Qué lleva y por qué ─────────────────────────────────────────────────────
// El código de barras, el nombre de quien lo va a usar y hasta cuándo vale.
//
// **Lo que NO lleva es el código escrito.** Instrucción del usuario el
// 2026-08-20: «JAMÁS lo debes mostrar». Es una credencial —este papel abre el
// portal— y en claro basta una foto desde el otro lado del mostrador. Lo apaga
// `HRI_APAGADO` en `ticketPrint.js`, con el comando explícito y no confiando en
// el valor por defecto de la impresora.
//
// No lleva foto ni sello: es un papel térmico que se borra en semanas y que
// vale hasta medianoche. Confundirlo con el carné de plástico sería el peor
// resultado posible, así que el título lo dice y el pie lo repite.
//
// ── La simbología está en UNA constante a propósito ─────────────────────────
// Arranca en CODE128 porque es la del carné de plástico, o sea la única probada
// contra los lectores que ya hay en las salas. Pero eso está probado contra
// barras impresas por una impresora de etiquetas, no por una ticketera: la hoja
// de prueba (Sistema → Prueba de impresión) imprime las dos simbologías juntas
// para que el papel conteste cuál lee el lector de verdad. Si contesta CODE39,
// lo que cambia es esta línea y nada más.
import { imprimirDocumento, limpiarValorDeBarras } from '@nucleo/utils/ticketPrint';
import { construirCarneDePapel } from '@nucleo/utils/carneDePapel';
import { VENTANA_BLOQUEADA } from './ventanaDeImpresion';
import { svgDeCodigoDeBarras } from './impresion';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

// El documento vive en el núcleo (`carneDePapel`): la app imprime el mismo.
export { SIMBOLOGIA_DEL_CARNE, construirCarneDePapel } from '@nucleo/utils/carneDePapel';

/**
 * Emite nada: recibe el carné ya emitido y lo manda al rollo.
 *
 * `sala` es la sucursal de QUIEN IMPRIME, no la del empleado: el papel se le
 * entrega en mano a alguien que está parado ahí. Mandarlo a la sala del
 * empleado lo haría salir en un mostrador donde no hay nadie esperándolo.
 */
export function imprimirCarneDePapel(datos, { sala = null, soloCola = false } = {}) {
    // `soloCola` viaja: con una sala ELEGIDA, si su caja no lo recibe se dice y
    // no sale por esta computadora — quien lo espera está en la otra sala.
    // Antes se descartaba al desestructurar y el papel caía acá en silencio.
    return imprimirDocumento(construirCarneDePapel(datos), { sala, soloCola });
}

// ── El carné de PLÁSTICO ────────────────────────────────────────────────────
//
// El carné completo, a tamaño tarjeta (85.6 × 54 mm), en una hoja carta para
// recortar: logo, foto, nombre, cargo, sucursal y el código de barras. Hasta el
// 2026-11-17 esto era sólo una etiqueta de 85 × 30 mm con el nombre y las
// barras; en hoja carta el navegador ignoraba el `@page` y estiraba el código a
// lo ancho de la hoja. Ahora el tamaño lo fija la TARJETA, no la página.
//
// NO va al rollo, y eso es una decisión, no una omisión: lo que lleva adentro
// es el `kiosk_pin`, la credencial PERMANENTE de esa persona. En un ticket
// térmico quedaría sobre un mostrador y sin fecha de vencimiento — que es
// exactamente el problema por el que existe el carné del día.
//
// Lo usan el perfil (reimprimir) y `FormNovedad` (el cambio de código): una
// sola copia, porque dos se desincronizan y sólo se ve con los papeles al lado.
//
// **La ventana se abre SINCRÓNICA en el gesto y por eso la recibe hecha**: si
// se abriera después del `await` del `import`, el bloqueador de emergentes la
// mata por no venir de una interacción.
//
// Y el documento no lleva ni un `<script>`: una ventana abierta con
// `window.open('')` **hereda el origen del portal**, así que un script de un
// tercero adentro vería el `localStorage` entero, token de sesión incluido.
// El código de barras se dibuja acá y a la ventana viaja el SVG ya hecho; la
// espera de las imágenes también se hace desde acá.
export async function imprimirCarneCompleto(win, { nombre, cargo = '', sala = '', foto = null, valor }) {
    if (!win) return { ok: false, motivo: VENTANA_BLOQUEADA };
    const limpio = limpiarValorDeBarras(valor);
    if (!limpio) { win.close(); return { ok: false, motivo: 'Esa persona no tiene código de carné.' }; }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let svg = '';
    try {
        svg = await svgDeCodigoDeBarras(limpio, 'CODE128');
    } catch { /* abajo */ }
    if (!svg) {
        // Sin código de barras el carné no sirve: mejor cerrar la ventana que
        // imprimir uno mudo que parece bueno.
        win.close();
        return { ok: false, motivo: 'No se pudo dibujar el código de barras.' };
    }
    // Que llene su caja: el ancho de las barras escala parejo, el lector lo lee igual.
    svg = svg.replace('<svg', '<svg preserveAspectRatio="none"');

    const origen = window.location.origin;
    const logo = `${origen}/logo-ticket-completo.png`;
    const fotoHtml = foto
        ? `<img class="foto" src="${esc(foto)}" alt="">`
        : '<div class="foto sin-foto"></div>';

    win.document.write(`<!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <title>Carné</title>
        <style>
            @page { size: letter; margin: 15mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
            .carne { width: 85.6mm; height: 54mm; border: 0.3mm dashed #888; border-radius: 3mm;
                     padding: 3mm; display: flex; flex-direction: column; justify-content: space-between;
                     overflow: hidden; }
            .arriba { display: flex; gap: 3mm; }
            .foto { width: 22mm; height: 27mm; object-fit: cover; border-radius: 1.5mm; flex: none; }
            .sin-foto { border: 0.3mm solid #bbb; }
            .datos { min-width: 0; display: flex; flex-direction: column; }
            .logo { height: 8mm; max-width: 52mm; object-fit: contain; object-position: left; margin-bottom: 2mm; }
            .nombre { font-size: 11pt; font-weight: bold; line-height: 1.15; margin: 0 0 1mm; }
            .linea { font-size: 8pt; line-height: 1.25; margin: 0; }
            .barras { width: 100%; height: 11mm; display: block; }
        </style>
        </head>
        <body>
            <div class="carne">
                <div class="arriba">
                    ${fotoHtml}
                    <div class="datos">
                        <img class="logo" src="${esc(logo)}" alt="">
                        <p class="nombre">${esc(shortEmployeeName({ name: nombre }))}</p>
                        ${cargo ? `<p class="linea">${esc(cargo)}</p>` : ''}
                        ${sala ? `<p class="linea">${esc(sala)}</p>` : ''}
                    </div>
                </div>
                <div class="barras">${svg.replace('<svg', '<svg class="barras"')}</div>
            </div>
        </body>
        </html>
    `);
    win.document.close();

    // Imprimir antes de que carguen la foto y el logo los deja en blanco.
    await Promise.all(Array.from(win.document.images).map(img => (img.complete ? null : new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 5000);
    }))));
    win.print();
    return { ok: true };
}
