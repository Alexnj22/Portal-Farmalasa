// ─── Impresión en rollo (ticketera) ──────────────────────────────────────────
//
// El portal imprimía sólo en hoja: `pedidoPrint.js`, `conteoInventarioPrint.js`
// y `corteZPrint.js` arman un PDF de carta con pdfmake, y `CotizacionesView`
// abre una ventana con `@page{size:letter}`. En la sala no hay impresora de
// hoja: hay una ticketera. Este archivo es el camino al rollo.
//
// ── Cómo lo hace el sistema de facturación (medido el 2026-08-13) ────────────
//
// Su pantalla de venta NO usa el diálogo de impresión del navegador. Pide al
// servidor el texto ya armado y lo manda por HTTP a un **programa que corre en
// la misma computadora de la caja** (`http://localhost/…`, con la ticketera
// registrada como impresora compartida). Ese programa es el que le habla a la
// impresora, así que el cajero nunca ve una ventana: aprieta Enter y sale el
// papel.
//
// Lo que devuelve el servidor son diez campos separados por `|` —sucursal,
// cliente, dos líneas de dirección, NIT, NRC, uno vacío, el cuerpo con los
// totales, el total en letras y el vendedor— más dos cadenas de encabezado y
// pie configurables. El cuerpo viene **rellenado con espacios** a un ancho
// fijo: el que imprime no acomoda nada, sólo saca los caracteres tal cual.
// Medido contra un Corte Z real del origen (`corte_z.ticket`): **40 columnas**.
//
// Ese camino tiene dos virtudes —no hay diálogo, y el papel sale al instante—
// y dos defectos: sólo funciona en las computadoras donde ese programa está
// instalado, y **la respuesta no se puede leer** (el navegador la entrega
// opaca), así que un fallo de impresión es indistinguible de un éxito. En su
// propio código el aviso de error está comentado.
//
// ── Lo que hace el portal ────────────────────────────────────────────────────
//
// El camino principal es el del navegador: el ticket se arma como HTML con
// `@page { size: <ancho>mm auto }` y se imprime desde un iframe. Ventajas
// sobre lo anterior:
//
//   · **Funciona en cualquier computadora y en el teléfono**, sin instalar nada.
//   · **Lo que se ve es lo que sale**: la vista previa y la impresión son el
//     MISMO documento, no dos renderizadores que hay que mantener parecidos.
//   · Las columnas las alinea el CSS, no espacios contados a mano, así que un
//     nombre largo **se parte en dos renglones** en vez de correr la columna
//     del precio o quedar cortado.
//   · Un error se ve: `print()` es síncrono y el navegador dice si no hay
//     impresora.
//
// `enviarAImpresoraDeLaComputadora` conserva el camino sin diálogo para las
// computadoras de sala que ya tienen ese programa. Está aparte a propósito: es
// el único que no se puede verificar desde acá.
//
// ── Reglas del rollo (por qué el CSS de acá no se parece al del portal) ──────
//
// 1. **Sólo negro.** La ticketera es térmica: un gris se convierte en un
//    entramado de puntos que se lee sucio y se borra con el tiempo. La
//    jerarquía sale del grosor, el tamaño y las mayúsculas — nunca del color.
//    Por eso este archivo no usa los tokens del tema: el papel no tiene tema.
// 2. **Nada de fondos.** Rellenar un renglón de negro gasta cabezal y batería
//    de la impresora. La única excepción es la barra de prueba, que existe
//    justamente para ver si el cabezal está parejo.
// 3. **Ancho fijo, alto medido.** El rollo no tiene página: fijar un alto de
//    hoja deja papel en blanco o corta el final. La forma obvia de pedirlo
//    —`@page { size: 80mm auto }`— **no es CSS válido**: la regla acepta `auto`
//    o dos longitudes, nunca una mezcla, así que el navegador la descarta
//    entera y vuelve a su papel por defecto. Medido el 2026-08-13: el PDF salía
//    de **216 × 279 mm (carta)** con esa regla puesta. Por eso el alto se mide
//    sobre el documento ya pintado y se inyecta —`ajustarAltoDePagina`—, y el
//    valor escrito a mano queda sólo como respaldo por si el JS no corre.
// 4. **Margen de corte al final.** La cuchilla queda unos milímetros arriba
//    del punto donde deja de salir papel; sin ese margen se lleva la última
//    línea.

// Anchos de rollo que existen en el mercado. El `margen` es cuánto se deja a
// cada lado: el área imprimible de un rollo es menor que el papel, y además el
// borde del térmico es donde primero se pierde el punto.
export const ANCHOS_ROLLO = [
    { mm: 80, label: '80 mm (el más común)', margen: 3 },
    { mm: 76, label: '76 mm (papel de matriz de punto)', margen: 3 },
    { mm: 58, label: '58 mm (rollo angosto)', margen: 2 },
];

export const ANCHO_POR_DEFECTO = 80;

// Escapar antes de interpolar: el mismo motivo que en `CotizacionesView` y
// `FormNovedad` — el HTML del ticket se escribe en un documento de la MISMA
// origin, así que un nombre de producto con `<script>` correría acá.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// La pila de monoespaciadas arranca por DejaVu Sans Mono porque las
// computadoras de sala son Linux y ahí está siempre; Menlo cubre la Mac y
// Consolas Windows. Courier New queda al final: existe en todas partes pero es
// la más delgada de todas, y sobre papel térmico se lee lavada.
const MONO = "'DejaVu Sans Mono','Menlo','Consolas','Courier New',monospace";

/**
 * El documento imprimible de un ticket.
 *
 * `ticket` es la forma que declaran los documentos del portal:
 *   ancho        — mm de rollo (uno de ANCHOS_ROLLO)
 *   encabezado   — { titulo, lineas[] }   qué farmacia y sus datos
 *   titulo       — qué es este papel ('PRUEBA DE IMPRESIÓN', 'PEDIDO', …)
 *   datos        — [[rótulo, valor], …]   los pares de arriba
 *   bloques      — [{ titulo, filas[]|texto|monoespaciado }, …]  el cuerpo
 *   items        — { columnas: [{label, ancho, alinear}], filas: [[…]] }
 *   totales      — [[rótulo, valor, destacado?], …]
 *   pie          — [líneas]
 *   barraPrueba  — true para imprimir la barra de control del cabezal
 */
export function construirTicketHtml(ticket) {
    const cfg = ANCHOS_ROLLO.find(a => a.mm === ticket.ancho) ?? ANCHOS_ROLLO[0];
    const { encabezado = {}, datos = [], bloques = [], items, totales = [], pie = [] } = ticket;

    const filaPar = ([rot, val]) => `
      <div class="par"><span class="rot">${esc(rot)}</span><span class="val">${esc(val)}</span></div>`;

    const filaTotal = ([rot, val, destacado]) => `
      <div class="par ${destacado ? 'grande' : ''}"><span class="rot">${esc(rot)}</span><span class="val">${esc(val)}</span></div>`;

    const bloqueHtml = (b) => `
      <div class="bloque">
        ${b.titulo ? `<div class="btit">${esc(b.titulo)}</div>` : ''}
        ${b.texto ? `<p class="texto">${esc(b.texto)}</p>` : ''}
        ${b.monoespaciado ? `<pre class="regla">${esc(b.monoespaciado)}</pre>` : ''}
        ${(b.filas ?? []).map(filaPar).join('')}
      </div>`;

    // `table-layout:fixed` es lo que hace que un nombre largo se parta en vez
    // de ensanchar su columna y correr las demás.
    const itemsHtml = !items ? '' : `
      <table class="items">
        <colgroup>${items.columnas.map(c => `<col style="width:${c.ancho}"/>`).join('')}</colgroup>
        <thead><tr>${items.columnas.map(c => `<th class="a-${c.alinear || 'izq'}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${items.filas.map(f => `<tr>${f.map((celda, i) =>
              `<td class="a-${items.columnas[i]?.alinear || 'izq'}">${esc(celda)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>`;

    return `<!DOCTYPE html>
<html lang="es" data-ancho="${cfg.mm}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(ticket.titulo || 'Ticket')}</title>
<style>
  /* El alto de acá es sólo el respaldo: el de verdad lo mide e inyecta
     ajustarAltoDePagina() sobre el documento ya pintado. 297mm es un rollo
     largo — si el JS no corre, sale papel de más, que es preferible a que el
     navegador vuelva a carta y el ticket salga en una esquina de la hoja.
     (Ojo: de acá para abajo estamos DENTRO de un literal de plantilla — un
     acento invertido en un comentario del CSS corta la cadena y el archivo
     deja de compilar.) */
  @page { size: ${cfg.mm}mm 297mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #fff; }
  body {
    width: ${cfg.mm}mm;
    padding: 3mm ${cfg.margen}mm 0;
    background: #fff;
    color: #000;
    font-family: ${MONO};
    font-size: 8.5pt;
    line-height: 1.28;
    /* El navegador aclara los negros al imprimir si no se le prohíbe, y en
       térmico eso es la diferencia entre negro y gris entramado. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .centro { text-align: center; }
  .marca { font-size: 11pt; font-weight: 700; letter-spacing: .3px; }
  .sub { font-size: 8pt; }
  .titulo {
    margin: 2mm 0 1mm; padding: .8mm 0;
    border-top: 1px solid #000; border-bottom: 1px solid #000;
    text-align: center; font-weight: 700; font-size: 9.5pt;
    text-transform: uppercase; letter-spacing: .6px;
  }
  .par { display: flex; justify-content: space-between; gap: 2mm; }
  .par .rot { flex: 0 1 auto; min-width: 0; }
  /* min-width:0 en los dos lados: sin eso un valor largo desborda el rollo en
     vez de partirse — es la misma trampa de flex de siempre. */
  .par .val { flex: 1 1 auto; min-width: 0; text-align: right; font-weight: 700;
              overflow-wrap: anywhere; }
  .bloque { margin-top: 2mm; }
  .btit { font-weight: 700; text-transform: uppercase; font-size: 8pt;
          letter-spacing: .5px; border-bottom: 1px dotted #000; margin-bottom: .8mm; }
  .texto { overflow-wrap: anywhere; }
  /* pre-wrap y no pre: un renglón más largo que el rollo tiene que PARTIRSE, no
     salirse. Con pre el papel lo corta, y una línea cortada se confunde con una
     falla de la impresora; partida, se ve que no cabía. Medido: la regla de 48
     caracteres se cortaba a 40. */
  .regla { font-family: ${MONO}; font-size: 8.5pt; white-space: pre-wrap;
           overflow-wrap: anywhere; }
  table.items { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 2mm; }
  table.items th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .3px;
                   border-bottom: 1px solid #000; padding-bottom: .5mm; }
  table.items td { padding: .6mm 0; vertical-align: top; overflow-wrap: anywhere; }
  table.items tbody tr + tr td { border-top: 1px dotted #000; }
  .a-izq { text-align: left; } .a-der { text-align: right; } .a-cen { text-align: center; }
  .totales { margin-top: 1.5mm; padding-top: 1mm; border-top: 1px solid #000; }
  .totales .grande { font-size: 11pt; font-weight: 700; margin-top: .8mm; }
  .barra { margin: 2mm 0; }
  .barra .solida { height: 4mm; background: #000; }
  .barra .franjas { height: 3mm; margin-top: .8mm;
    background: repeating-linear-gradient(90deg,#000 0 .4mm,#fff .4mm .8mm); }
  .pie { margin-top: 2.5mm; padding-top: 1mm; border-top: 1px solid #000;
         text-align: center; font-size: 8pt; }
  .pie p { overflow-wrap: anywhere; }
  /* Margen de corte: la cuchilla queda arriba del final del papel. */
  .corte { height: 12mm; }
</style>
</head>
<body>
  <div class="centro">
    ${encabezado.titulo ? `<div class="marca">${esc(encabezado.titulo)}</div>` : ''}
    ${(encabezado.lineas ?? []).map(l => `<div class="sub">${esc(l)}</div>`).join('')}
  </div>
  ${ticket.titulo ? `<div class="titulo">${esc(ticket.titulo)}</div>` : ''}
  ${datos.map(filaPar).join('')}
  ${bloques.map(bloqueHtml).join('')}
  ${itemsHtml}
  ${totales.length ? `<div class="totales">${totales.map(filaTotal).join('')}</div>` : ''}
  ${ticket.barraPrueba ? '<div class="barra"><div class="solida"></div><div class="franjas"></div></div>' : ''}
  ${pie.length ? `<div class="pie">${pie.map(l => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
  <div class="corte"></div>
</body>
</html>`;
}

/**
 * Le dice al navegador cuánto papel pedir: mide el documento ya pintado y
 * escribe el `@page` definitivo.
 *
 * Va acá y no en el CSS porque el alto de un ticket no se sabe hasta que está
 * armado —depende de cuántos renglones y de cuánto se partió cada nombre— y
 * porque la regla que lo diría en una línea (`size: <ancho>mm auto`) no es CSS
 * válido: el navegador la tira entera y vuelve a carta.
 *
 * `1in = 96px` es exacto por definición en CSS, así que la conversión no es una
 * aproximación. Lo que sí hay que cuidar son dos cosas que se midieron el
 * 2026-08-13, las dos capaces de partir el ticket en dos hojas:
 *
 * 1. **`documentElement.scrollHeight` no sirve para esto**: nunca devuelve menos
 *    que el alto de la ventana. Medido: el mismo ticket daba 691 px dentro de un
 *    marco de 620 px y 900 px en una ventana de 900 px, o sea 33 mm de papel en
 *    blanco de más. El alto del ticket es el del CUERPO, que no depende de por
 *    dónde se lo mire.
 * 2. **El trazado de impresión sale un pelo más alto que el de pantalla**
 *    (redondeo de puntos a píxeles del dispositivo, renglón por renglón). Con el
 *    alto justo, ese pelo manda el margen de corte a una segunda hoja: dos
 *    cortes, el segundo en blanco. La holgura es papel invisible en un rollo; la
 *    segunda hoja se ve siempre.
 *
 * @returns {number|null} el alto en mm que quedó pedido.
 */
const HOLGURA_MM = 4;

export function ajustarAltoDePagina(marco) {
    const doc = marco?.contentDocument;
    if (!doc?.documentElement) return null;

    const ancho = doc.documentElement.dataset.ancho || ANCHO_POR_DEFECTO;
    const alto = doc.body?.getBoundingClientRect().height || doc.body?.scrollHeight;
    if (!alto) return null;
    const mm = Math.ceil((alto / 96) * 25.4) + HOLGURA_MM;

    let regla = doc.getElementById('alto-de-pagina');
    if (!regla) {
        regla = doc.createElement('style');
        regla.id = 'alto-de-pagina';
        doc.head.appendChild(regla);
    }
    regla.textContent = `@page { size: ${ancho}mm ${mm}mm; margin: 0; }`;
    return mm;
}

/**
 * Imprime el documento que ya está pintado en un iframe.
 *
 * Se imprime EL MARCO DE LA VISTA PREVIA y no una copia recién armada: así el
 * papel no puede diferir de lo que el usuario acaba de mirar. Devuelve el
 * motivo del fallo, o null si el diálogo se abrió.
 */
export function imprimirMarco(marco) {
    const ventana = marco?.contentWindow;
    if (!ventana) return 'La vista previa todavía no está lista.';
    try {
        // Se remide en cada impresión: el contenido pudo cambiar desde que se
        // pintó (otro ancho de rollo, otro documento) y un alto viejo cortaría
        // el final o dejaría papel en blanco.
        ajustarAltoDePagina(marco);
        // `focus()` primero: Safari imprime la página de arriba en vez del
        // iframe si el marco no tiene el foco.
        ventana.focus();
        ventana.print();
        return null;
    } catch (err) {
        return err?.message || 'El navegador no abrió el diálogo de impresión.';
    }
}

/**
 * Imprime un ticket sin necesidad de una vista previa en pantalla — para los
 * documentos que se imprimen desde un botón de su propia vista.
 *
 * El iframe se saca después de `afterprint`, no en cuanto vuelve `print()`:
 * quitarlo antes cancela el trabajo en Chrome. El plazo de respaldo existe
 * porque `afterprint` no llega en todos los navegadores.
 */
export function imprimirTicket(ticket) {
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.setAttribute('title', 'Impresión');
    marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:120mm;height:1px;border:0;';
    document.body.appendChild(marco);

    let sacado = false;
    const sacar = () => {
        if (sacado) return;
        sacado = true;
        marco.remove();
    };

    return new Promise((resolve) => {
        marco.onload = () => {
            const error = imprimirMarco(marco);
            marco.contentWindow?.addEventListener('afterprint', sacar);
            setTimeout(sacar, 60_000);
            resolve(error);
        };
        marco.srcdoc = construirTicketHtml(ticket);
    });
}

// ── El camino sin diálogo: la impresora de esta computadora ──────────────────
//
// Reproduce lo que hace la pantalla de venta del sistema de facturación: un
// POST al programa de impresión que corre en la misma computadora. Sirve sólo
// donde ese programa está instalado — las computadoras de sala.
//
// TRES cosas que hay que saber antes de tocar esto:
//
// 1. **`http://localhost` desde una página `https` no es contenido mixto.** La
//    especificación considera confiable a localhost, así que el navegador no lo
//    bloquea. Es lo que permite que esto funcione desde el portal, que vive en
//    https. Los navegadores nuevos pueden PEDIR PERMISO para alcanzar la red
//    local la primera vez: hay que concederlo.
// 2. **La respuesta llega opaca.** Es una petición sin CORS: se sabe si el
//    programa contestó algo, no QUÉ contestó. Un 404 y un 200 se ven igual.
//    Por eso hay que elegir el sistema de la computadora en vez de probar los
//    dos: probar los dos imprimiría dos veces donde ambos existan.
// 3. **No está verificado desde una computadora de escritorio.** El programa no
//    corre en una Mac. Lo que se puede afirmar hoy es la forma del pedido,
//    copiada de la que usa el origen; que imprima se comprueba en una sala.
const RUTA_PROGRAMA = 'http://localhost/impresion_dte/';

/** El cuerpo del ticket en la forma que espera ese programa: diez campos con `|`. */
function comoCamposDelPrograma(ticket) {
    const cuerpo = [
        ...(ticket.datos ?? []).map(([r, v]) => `${r}: ${v}`),
        ...(ticket.bloques ?? []).flatMap(b => [
            b.titulo ?? '',
            b.monoespaciado ?? '',
            b.texto ?? '',
            ...(b.filas ?? []).map(([r, v]) => `${r}: ${v}`),
        ].filter(Boolean)),
        ...(ticket.totales ?? []).map(([r, v]) => `${r}: ${v}`),
    ].join('\n');

    return [
        ticket.encabezado?.titulo ?? '',      // sucursal
        ticket.titulo ?? '',                  // dónde va el cliente
        ...(ticket.encabezado?.lineas ?? ['', '']).slice(0, 2),
        '', '', '',                           // NIT, NRC y un campo que el origen manda vacío
        cuerpo,
        '',                                   // el total en letras
        '',
    ].join('|');
}

/**
 * @returns {Promise<{ok: boolean, detalle: string}>} — `ok` significa que el
 * programa recibió el pedido, NO que el papel salió: eso no se puede saber.
 */
export async function enviarAImpresoraDeLaComputadora(ticket, { sistema = 'linux', impresora = '//localhost/ticket' } = {}) {
    const archivo = sistema === 'windows' ? 'printposwin1.php' : 'printpos1.php';
    const cuerpo = new URLSearchParams({
        datosventa: comoCamposDelPrograma(ticket),
        efectivo: '0',
        cambio: '0',
        headers: (ticket.encabezado?.lineas ?? []).join('|'),
        footers: (ticket.pie ?? []).join('|'),
        ...(sistema === 'windows' ? { shared_printer_pos: impresora } : {}),
    });

    try {
        await fetch(`${RUTA_PROGRAMA}${archivo}`, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: cuerpo.toString(),
            signal: AbortSignal.timeout(8000),
        });
        return {
            ok: true,
            detalle: 'La computadora recibió el pedido de impresión. Si no salió papel, '
                + 'la impresora no está registrada con el nombre esperado.',
        };
    } catch (err) {
        const seCorto = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        return {
            ok: false,
            detalle: seCorto
                ? 'La computadora no contestó en 8 segundos.'
                : 'Esta computadora no tiene el programa de impresión directa. '
                  + 'Es lo normal fuera de las salas: usa el botón de arriba.',
        };
    }
}
