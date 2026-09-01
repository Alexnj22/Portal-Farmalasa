// ─── Impresión en rollo (ticketera) ──────────────────────────────────────────
//
// El portal imprimía sólo en hoja: `pedidoPrint.js`, `conteoInventarioPrint.js`
// y `corteZPrint.js` arman un PDF de carta con pdfmake, y `CotizacionesView`
// abre una ventana con `@page{size:letter}`. En la sala no hay impresora de
// hoja: hay una ticketera. Este archivo es el camino al rollo.
//
// ── Cómo lo hace el sistema de facturación (medido el 2026-08-13) ────────────
//
// NO usa el diálogo de impresión del navegador. Pide al servidor el ticket ya
// maquetado y lo manda por HTTP a un **programa que corre en la misma
// computadora de la caja** (`http://localhost/impresion_dte/`, con la ticketera
// registrada como impresora compartida). Ese programa es el que le habla a la
// impresora, así que el cajero nunca ve una ventana: aprieta Enter y sale el
// papel.
//
// **Hay DOS caminos, y el que importa es el segundo:**
//
//   pantalla de venta vieja → `venta.php` (`process=imprimir_fact`) → los diez
//   campos separados por `|` en un solo `datosventa` → `printpos1.php`. La
//   opción TICKET de esa pantalla está comentada en su propio HTML.
//
//   **ticket con datos fiscales** → `_helper_ticket_dte.php`
//   (`process=print_ticket_dte`) → secciones separadas —`encabezado`, `cuerpo`,
//   `pie`, `totales`, `total_letras`, `img`, `qr`, `qr_farmalasa`— →
//   **`printik_pista.php`** en Linux, `printposwin1.php` en Windows. Es el que
//   sale de la ticketera en las salas hoy.
//
// Las secciones del segundo vienen **con códigos de impresora adentro** (ESC/POS:
// centrado, letra chica, doble alto) y las imágenes por URL, que el programa
// descarga. O sea que **ese programa no maqueta: es un caño**. Medido sobre un
// ticket real (factura 351275): **54 columnas** en la letra chica y 40 en la
// normal. El Corte Z del origen sale a 40 porque lo imprime otro reporte, en la
// letra normal — no es el ancho del ticket.
//
// Ese camino tiene dos virtudes —no hay diálogo, y el papel sale al instante— y
// dos defectos: sólo funciona en las computadoras donde ese programa está
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
// 4. **Margen de corte al final.** La cuchilla queda unos centímetros arriba
//    del punto donde deja de salir papel; sin ese margen se lleva la última
//    línea. Y no son «unos milímetros»: con 12 mm el corte seguía comiéndose
//    el final, medido en la sala el 2026-08-17. Hoy son ~17 mm en los dos
//    caminos — la banda `.corte` acá y `SALTOS_DE_CORTE` en el envío directo.

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
 * El valor que va adentro de las barras: mayúsculas y dígitos, nada más.
 *
 * Es el alfabeto que las dos simbologías del rollo aceptan sin cambiar de juego
 * de caracteres, y es lo que lleva un carné (el PIN son 8 alfanuméricos). Vive
 * acá arriba porque la limpian los TRES caminos —el SVG del navegador y los dos
 * de la ticketera—: dos definiciones darían dos códigos distintos para el mismo
 * carné, y eso sólo se vería pasando el papel por el lector.
 */
export const limpiarValorDeBarras = (valor) =>
    String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Las barras como SVG, para el camino del navegador.
 *
 * `await import`: `jsbarcode` sólo hace falta cuando hay un carné que imprimir
 * — es la regla de las librerías pesadas de CLAUDE.md, y este archivo lo
 * importan pantallas que nunca imprimen un código de barras.
 *
 * El SVG se arma ACÁ y a la ventana de impresión viaja ya hecho. Es la misma
 * decisión que tomó el carné de «cambio de código» (`FormNovedad`): una ventana
 * abierta con `window.open('')` hereda el origen del portal, así que un
 * `<script>` adentro del documento impreso vería el `localStorage` entero.
 */
export async function dibujarCodigoDeBarras(valor, simbologia = 'CODE128') {
    const limpio = limpiarValorDeBarras(valor);
    if (!limpio) return '';
    const JsBarcode = (await import('jsbarcode')).default;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, limpio, {
        format: simbologia, width: 2, height: 50, displayValue: false, margin: 0,
    });
    return new XMLSerializer().serializeToString(svg);
}

/**
 * Un código QR como SVG, para la vista previa del navegador.
 *
 * En el rollo lo dibuja la IMPRESORA (`GS ( k`); acá hay que dibujarlo nosotros,
 * porque la ventana de impresión es HTML. Son dos caminos para el mismo código
 * y no hay forma de evitarlo — lo que sí se evita es que digan cosas distintas:
 * los dos salen del mismo `ticket.qr`.
 *
 * `@zxing/library` entra por `await import()` y no estático: ya está en el
 * proyecto porque el login LEE códigos con ella, pero pesa, y una pantalla que
 * nunca imprime un QR no tiene por qué cargarla.
 */
export async function dibujarQR(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return '';
    const { QRCodeWriter, BarcodeFormat, EncodeHintType } = await import('@zxing/library');
    const hints = new Map();
    hints.set(EncodeHintType.ERROR_CORRECTION, 'M');
    hints.set(EncodeHintType.MARGIN, 0);
    const m = new QRCodeWriter().encode(texto, BarcodeFormat.QR_CODE, 0, 0, hints);
    const n = m.getWidth();
    // Un solo <path> con los módulos de cada fila unidos en tiras: un <rect> por
    // módulo son cientos de nodos para dibujar lo mismo.
    let d = '';
    for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
            if (!m.get(x, y)) { x++; continue; }
            let ancho = 0;
            while (x + ancho < n && m.get(x + ancho, y)) ancho++;
            d += `M${x} ${y}h${ancho}v1h-${ancho}z`;
            x += ancho;
        }
    }
    return `<svg viewBox="0 0 ${n} ${n}" width="120" height="120" aria-hidden="true"><path d="${d}"/></svg>`;
}

/**
 * El mismo ticket con las barras de `ticket.codigos` ya dibujadas.
 *
 * `construirTicketHtml` es síncrono —lo llama un `useMemo` para pintar la vista
 * previa— y dibujar un código de barras no lo es, así que el SVG se prepara
 * antes. Un ticket sin códigos vuelve tal cual y **no baja la librería**.
 *
 * Un código que no se pudo dibujar queda con el SVG vacío en vez de tumbar la
 * impresión: en el rollo las barras las dibuja la impresora igual, y el papel
 * sigue llevando el valor escrito debajo.
 */
export async function conCodigosDibujados(ticket) {
    const codigos = ticket?.codigos ?? [];
    const faltaQr = ticket?.qr && ticket?.qrSvg == null;
    if (!faltaQr && (!codigos.length || codigos.every(c => c.svg != null))) return ticket;
    const [dibujados, qrSvg] = await Promise.all([
        Promise.all(codigos.map(async (c) => (
            c.svg != null ? c
                : { ...c, svg: await dibujarCodigoDeBarras(c.valor, c.simbologia).catch(() => '') }
        ))),
        faltaQr ? dibujarQR(ticket.qr).catch(() => '') : Promise.resolve(ticket?.qrSvg ?? ''),
    ]);
    return { ...ticket, codigos: dibujados, qrSvg };
}

/**
 * Cuántos caracteres entran de verdad en un renglón de la VISTA PREVIA.
 *
 * No son las 54 del rollo: el papel imprime en su letra chica y la vista dibuja
 * 8.5pt, que en una monoespaciada avanza 0.6 del tamaño — 1.81 mm por carácter,
 * medido en Chrome sobre la misma pila de fuentes. En el rollo de 80 mm son 40
 * columnas contra 54. La diferencia sólo importa para decidir qué se empareja:
 * el texto es el mismo y ninguno de los dos recorta nada.
 */
const columnasDeLaVista = (cfg) => Math.floor((cfg.mm - 2 * cfg.margen) / 1.81);

/**
 * Los pares de datos, agrupados de a dos por renglón **donde quepan**.
 *
 * El rollo mide 54 columnas y un dato rara vez pasa de 25 (`Sala: Salud 3`):
 * imprimir uno por renglón gasta media hoja en blanco y alarga el papel al
 * doble. Pero un dato largo —`Motivo: Remesa entregada a un cliente`— no puede
 * compartir renglón sin partirse en dos, y un dato partido se lee peor que uno
 * solo. Por eso la regla es «de a dos donde quepan», no «de a dos siempre».
 *
 * La segunda columna arranca **siempre en la mitad del rollo**, no pegada al
 * dato de la izquierda: así los renglones se leen como una tabla en vez de como
 * texto corrido. Ese es el motivo de que el de la izquierda tenga que dejar dos
 * espacios libres — sin ellos las dos columnas se tocan.
 *
 * @returns {Array<Array<[string,string]>>} renglones, de uno o dos pares
 */
export function emparejarDatos(datos = [], ancho = COLUMNAS_TICKET.chica) {
    const mitad = Math.floor(ancho / 2);
    const largo = ([rot, val]) => `${rot}: ${val}`.length;
    const filas = [];
    for (let i = 0; i < datos.length; i++) {
        const izq = datos[i], der = datos[i + 1];
        if (der && largo(izq) <= mitad - 2 && largo(der) <= ancho - mitad) {
            filas.push([izq, der]);
            i++;
        } else {
            filas.push([izq]);
        }
    }
    return filas;
}

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
 *   codigos      — [{ valor, simbologia, texto?, svg? }, …]  códigos de barras
 *   totales      — [[rótulo, valor, destacado?], …]
 *   pie          — [líneas]
 *   barraPrueba  — true para imprimir la barra de control del cabezal
 */
export function construirTicketHtml(ticket) {
    const cfg = ANCHOS_ROLLO.find(a => a.mm === ticket.ancho) ?? ANCHOS_ROLLO[0];
    const { encabezado = {}, datos = [], bloques = [], items, totales = [], pie = [], codigos = [] } = ticket;

    const filaPar = ([rot, val]) => `
      <div class="par"><span class="rot">${esc(rot)}</span><span class="val">${esc(val)}</span></div>`;

    // Los datos van de a dos por renglón, igual que en el rollo. Pero se
    // emparejan con las columnas de LA VISTA, no con las 54 del papel: la vista
    // dibuja la letra más grande —8.5pt sobre 74 mm de cuerpo son 40 columnas,
    // medido en Chrome— así que un par que entra en el rollo puede no entrar
    // acá, y el valor se parte en dos renglones. Emparejar con el ancho de cada
    // medio es lo que hace que ninguno de los dos parta nada.
    const filasDeDatos = emparejarDatos(datos, columnasDeLaVista(cfg));
    const filaDeDatos = (fila) => `
      <div class="datos">${fila.map(filaPar).join('')}</div>`;

    const filaTotal = ([rot, val, destacado]) => `
      <div class="par ${destacado ? 'grande' : ''}"><span class="rot">${esc(rot)}</span><span class="val">${esc(val)}</span></div>`;

    const bloqueHtml = (b) => `
      <div class="bloque">
        ${b.titulo ? `<div class="btit">${esc(b.titulo)}</div>` : ''}
        ${b.texto ? `<p class="texto ${b.destacado ? 'destacado' : ''}">${esc(b.texto)}</p>` : ''}
        ${b.monoespaciado ? `<pre class="regla">${esc(b.monoespaciado)}</pre>` : ''}
        ${(b.filas ?? []).map(filaPar).join('')}
      </div>`;

    // **El valor NO se escribe.** Ni acá ni en el rollo (ver `HRI_APAGADO`): es
    // una credencial, y la vista previa es lo que se imprime. La leyenda sí va
    // — dice qué simbología es, no qué dice adentro.
    const codigoHtml = (c) => `
      <div class="barras">
        ${c.svg || ''}
        ${c.leyenda ? `<div class="leyenda">${esc(c.leyenda)}</div>` : ''}
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
  /* Las dos columnas de datos. El flex 1 1 0 las parte por la mitad exacta
     —que es donde arranca la segunda columna en el rollo— y min-width:0 deja
     que un valor largo se parta adentro de su mitad en vez de ensancharla.
     (Ojo con los acentos invertidos acá adentro: cortan el literal.) */
  .datos { display: flex; gap: 3mm; }
  .datos > .par { flex: 1 1 0; min-width: 0; }
  .bloque { margin-top: 2mm; }
  .btit { font-weight: 700; text-transform: uppercase; font-size: 8pt;
          letter-spacing: .5px; border-bottom: 1px dotted #000; margin-bottom: .8mm; }
  .texto { overflow-wrap: anywhere; }
  /* El dato por el que existe el papel —un código que alguien va a teclear en su
     teléfono— se lee de un vistazo o no sirve. En el rollo son doble alto Y
     doble ancho; acá el equivalente visual, que es lo que se ve en el diálogo
     del navegador y en la vista previa. */
  .texto.destacado { font-size: 20pt; font-weight: 700; text-align: center;
                     letter-spacing: 2px; margin: 1.2mm 0; }
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
  /* Las barras salen a todo el ancho disponible y nunca escaladas por debajo
     de su tamaño natural: un código de barras encogido pierde los módulos
     angostos y el lector deja de reconocerlo. Si no entra, se ve que no entra. */
  .barras { margin: 2.5mm 0; text-align: center; }
  .barras svg { max-width: 100%; height: auto; }
  .barras .leyenda { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4px; }
  .barra { margin: 2mm 0; }
  .barra .solida { height: 4mm; background: #000; }
  .barra .franjas { height: 3mm; margin-top: .8mm;
    background: repeating-linear-gradient(90deg,#000 0 .4mm,#fff .4mm .8mm); }
  .pie { margin-top: 2.5mm; padding-top: 1mm; border-top: 1px solid #000;
         text-align: center; font-size: 8pt; }
  .pie p { overflow-wrap: anywhere; }
  /* Margen de corte: la cuchilla queda arriba del final del papel, así que sin
     esta banda en blanco el corte se lleva la última línea. 12 mm no
     alcanzaban —medido con papel en la mano el 2026-08-17—, y 35 mm resultaron
     de más una vez que el ticket manda su propio corte: 17 mm es lo mismo que
     manda el camino sin diálogo (SALTOS_DE_CORTE, 2026-08-18). */
  .corte { height: 17mm; }
</style>
</head>
<body>
  <div class="centro">
    ${encabezado.titulo ? `<div class="marca">${esc(encabezado.titulo)}</div>` : ''}
    ${(encabezado.lineas ?? []).map(l => `<div class="sub">${esc(l)}</div>`).join('')}
  </div>
  ${ticket.titulo ? `<div class="titulo">${esc(ticket.titulo)}</div>` : ''}
  ${filasDeDatos.map(filaDeDatos).join('')}
  ${bloques.map(bloqueHtml).join('')}
  ${codigos.map(codigoHtml).join('')}
  ${ticket?.qrSvg ? `<div class="barras">${ticket.qrSvg}</div>` : ''}
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
// Reproduce lo que hace el sistema de facturación al imprimir un ticket: un POST
// al programa de impresión que corre en la misma computadora. Sirve sólo donde
// ese programa está instalado — las computadoras de sala.
//
// **El contrato es el de `print_ticket_dte` (leído de su `js/funciones/util.js`,
// 2026-08-13), no el de la pantalla de venta vieja.** Son dos caminos distintos y
// el primer intento usó el equivocado:
//
//   ticket con datos fiscales →  printik_pista.php   (Linux, las salas)
//                                printposwin1.php    (Windows)
//     parámetros: encabezado · cuerpo · pie · totales · total_letras ·
//                 efectivo · cambio · img · qr · qr_farmalasa
//
//   ticket viejo de la venta  →  printpos1.php, con los diez campos separados
//                                por `|` en un solo `datosventa`
//
// El primero manda **secciones ya maquetadas con códigos de impresora adentro**
// (ESC/POS: centrado, letra chica, doble alto) y las imágenes por URL, que el
// programa descarga. O sea que ese programa **no maqueta nada: es un caño**. Por
// eso el ancho y la posición de cada columna hay que respetarlos acá.
//
// Medido sobre un ticket real (captura del usuario, factura 351275): **54
// columnas** en la letra chica y **40** en la normal; el nombre del producto
// ocupa las columnas 1 a 31 y los importes terminan en 36, 44 y 54.
//
// TRES cosas más que hay que saber antes de tocar esto:
//
// 1. **`http://localhost` desde una página `https` no es contenido mixto.** La
//    especificación considera confiable a localhost. Pero los navegadores nuevos
//    piden **permiso de red local**, y ese permiso es **por sitio**: que el otro
//    sistema imprima desde esa misma computadora no significa que el portal
//    tenga el permiso. Es el primer sospechoso cuando falla en una sala.
// 2. **La respuesta llega opaca.** Es una petición sin CORS: se sabe si el
//    programa contestó algo, no QUÉ contestó. Un 404 y un 200 se ven igual.
//    Por eso hay que elegir el sistema de la computadora en vez de probar los
//    dos: probar los dos imprimiría dos veces donde ambos existan.
// 3. **Las imágenes van vacías.** El origen manda su logo y dos códigos QR por
//    URL; acá no se manda ninguna hasta comprobar que el programa las omite sin
//    romperse cuando llegan vacías. Es lo único de este contrato que no salió de
//    leer su código.
const RUTA_PROGRAMA = 'http://localhost/impresion_dte/';

/**
 * El margen de corte: cuánto papel se hace salir DESPUÉS de la última línea.
 *
 * La cuchilla no está a la altura del cabezal — queda unos centímetros más
 * arriba —, así que lo último que se imprimió todavía está adentro de la
 * impresora cuando uno corta. Sin margen, el corte se lleva el final del
 * ticket.
 *
 * **Cinco saltos no alcanzaban**: con ~15 mm el corte seguía comiéndose la
 * última línea, medido con papel en la mano el 2026-08-17. Es el único papel en
 * blanco que este ticket necesita, y es justo lo que se pagó sacando los
 * renglones vacíos de adentro (v2.654.2).
 *
 * **Doce eran de más.** Se eligieron el 17-08 —cuando el ticket todavía NO
 * mandaba su propia orden de cortar— para que el corte a mano cayera lejos del
 * texto. Desde v2.661.7 el papel se corta solo en el punto que decide el
 * ticket, así que el margen dejó de ser un colchón y pasó a ser exactamente el
 * blanco que se ve abajo. El usuario lo midió con el rollo en la mano el
 * 2026-08-18: sobra la mitad. Seis son ~17 mm, y siguen dejando la última línea
 * afuera de la cuchilla.
 *
 * **Si el corte vuelve a comerse el final, este número SUBE** — es el único que
 * lo separa del filo, y nada más en el archivo lo compensa.
 */
const SALTOS_DE_CORTE = 6;

// Códigos de la impresora, tal como aparecen en el ticket del origen.
const ESC = '\x1b', GS = '\x1d';

// Tamaño de cada módulo del QR, en puntos. Con 6 un código de una dirección
// corta ocupa poco más de dos centímetros — se lee de una y no se come el rollo.
const QR_MODULO = 6;
const CENTRO = `${ESC}a\x01`, IZQUIERDA = `${ESC}a\x00`, DERECHA = `${ESC}a\x02`;
const LETRA_CHICA = `${ESC}!\x01`, LETRA_NORMAL = `${ESC}!\x00`, DOBLE_ALTO = `${ESC}!\x10`;
/**
 * El renglón que alguien va a leer parado frente a la mesa: negrita Y doble
 * alto. `ESC ! n` es un mapa de bits —`0x08` negrita, `0x10` doble alto— así
 * que los dos viajan en un solo código, y es el MISMO comando con el que este
 * ticket ya cambia de letra, o sea el único que está medido en esta impresora.
 * (`ESC E` haría la negrita sola, pero es otro comando y acá hay antecedentes
 * de códigos que el aparato ignora sin avisar — ver `ESC a`.)
 *
 * **Doble alto y no doble ancho**: el ancho lo cambiaría a la mitad de las
 * columnas y `dosColumnas` rellena contando 40. Un total destacado saldría
 * partido, que es peor que un total que no resalta.
 */
const DESTACADO = `${ESC}!\x18`;
/**
 * Lo mismo, y además doble ANCHO (`0x20`). Es para un renglón que está SOLO y
 * centrado —un código que hay que teclear, un número que alguien dicta por
 * teléfono—: ahí no hay nada que alinear contra él, así que la objeción que le
 * prohíbe el doble ancho a un total no aplica. Caben 20 caracteres.
 */
const DESTACADO_GRANDE = `${ESC}!\x38`;
const JUEGO_DE_CARACTERES = `${ESC}R\f`;   // el que usa el origen: latino

// ── El código de barras ─────────────────────────────────────────────────────
//
// El rollo NO puede llevar el SVG que `jsbarcode` dibuja para el carné
// plástico: por los dos caminos de la ticketera viaja texto con códigos ESC/POS
// adentro, así que las barras las dibuja el APARATO (`GS k`), no el portal. En
// el tercer camino —el diálogo del navegador— sí sale el SVG, porque ahí lo que
// se imprime es HTML.
//
// **Cuál simbología lee el lector de la sala se contesta con papel en la mano,
// no acá.** Por eso el ticket acepta las dos y la hoja de prueba imprime una de
// cada una:
//
//   · **CODE128** es la del carné plástico —o sea, la única probada contra los
//     lectores que ya hay en las salas—. Su comando es `GS k I <n> {B <datos>`,
//     donde `n` es un byte de LARGO: con 8 caracteres vale 10, que es un salto
//     de línea. Por el camino directo el ticket viaja dentro de un POST y pasa
//     por PHP, y ese recorrido ya se comió un byte una vez (el `\x00` final de
//     `GS V 66 0`, que colgó la ticketera de Salud 4 y con ella los tickets del
//     sistema de facturación). Por la cola viaja en base64 y no corre ese riesgo.
//   · **CODE39** usa `GS k \x04 <datos> \x00`: sin byte de largo, y su NUL va
//     en MEDIO del ticket, que es la posición que sí sobrevive al pipe. Su
//     alfabeto —mayúsculas y dígitos— cubre lo que lleva un carné. A cambio
//     ocupa casi el doble de ancho por carácter.
//
// Un comando que la impresora no entienda la deja esperando los bytes que le
// faltan y **se traga el trabajo siguiente**. Por eso la primera prueba va por
// la cola de la sala (el agente escribe con `lp -o raw`, sin el programa ajeno
// en el medio) y después se comprueba que el sistema de facturación siga
// imprimiendo. Ver [[project_impresion_en_ticketera_2026_08_13]].
export const SIMBOLOGIAS = ['CODE128', 'CODE39'];

// Alto en puntos (~10 mm a 203 ppp) y ancho de módulo. Con 2 puntos por módulo
// un CODE128 de 8 caracteres mide ~35 mm y un CODE39 ~62 mm: los dos entran en
// el rollo de 80 mm de las salas, y el CODE39 con poco margen — si sale
// partido, lo que baja es este número, no el alto.
//
// **Son el valor por DEFECTO, no el único.** Cada código puede pedir el suyo
// (`alto` y `modulo`), porque no todos se leen en las mismas condiciones: el
// carné se pasa despacio y a la vista, y el de una bolsa se lee de apuro y a
// veces con el papel pegado con cinta. La cuenta para no pasarse del rollo está
// en `trasladoTicket`, que es quien pide el grande.
const BARRAS_ALTO   = 0x50;   // 80 puntos
const BARRAS_MODULO = 0x02;   // 2 puntos por módulo

/**
 * **El valor NO se imprime debajo de las barras. Nunca.**
 *
 * Instrucción del usuario, el 2026-08-20 y en mayúsculas: «no agregues el
 * código abajo del código de barras, JAMÁS lo debes mostrar». Y tiene razón: lo
 * que va adentro de esas barras es una credencial —el carné de papel abre el
 * portal— y escribirla en claro convierte el papel en una contraseña legible
 * desde el otro lado del mostrador. Basta una foto.
 *
 * `GS H 0` lo apaga explícitamente en vez de confiar en el valor por defecto de
 * la impresora: «casi todas arrancan sin el renglón» no es una garantía, y la
 * que lo traiga encendido lo imprimiría sin que nadie se entere hasta ver el
 * papel. El NUL de este comando va en MEDIO del ticket, que es la posición que
 * sobrevive el camino de HTTP + PHP (el que se pierde es el del final — ver
 * `CORTAR_PAPEL`).
 *
 * Consecuencia aceptada: si el lector de una sala no lee la simbología, ese
 * papel no sirve para nada y hay que anularlo e imprimir otro. Es la falla
 * segura — la alternativa era dejar la credencial escrita para poder teclearla.
 */
const HRI_APAGADO   = '\x00';

/**
 * Un código de barras en los bytes que entiende la impresora.
 *
 * Se limpia a mayúsculas y dígitos porque es lo que las DOS simbologías
 * aceptan sin cambiar de juego de caracteres, y porque es exactamente lo que
 * lleva un carné. Un valor con otra cosa adentro no se imprime a medias: se
 * recorta acá, donde todavía se puede ver, en vez de salir mudo en el papel.
 */
function codigoDeBarrasParaElRollo({
    valor, simbologia = 'CODE128', alto = BARRAS_ALTO, modulo = BARRAS_MODULO,
}) {
    const limpio = limpiarValorDeBarras(valor);
    if (!limpio) return '';
    // Los dos van como BYTE, no como número: `GS h n` y `GS w n` esperan un
    // carácter. Y se acotan a lo que la impresora admite —un valor fuera de
    // rango no da error: imprime cualquier cosa o se traga el trabajo.
    const byte = (n, min, max) => String.fromCharCode(Math.max(min, Math.min(max, Number(n) | 0)));
    const ajustes = `${GS}h${byte(alto, 1, 255)}${GS}w${byte(modulo, 2, 6)}${GS}H${HRI_APAGADO}`;
    const comando = simbologia === 'CODE39'
        ? `${GS}k\x04${limpio}\x00`
        : `${GS}k\x49${String.fromCharCode(limpio.length + 2)}{B${limpio}`;
    return CENTRO + ajustes + comando;
}

/**
 * Un código QR en los bytes que entiende la impresora — **sólo por la cola**.
 *
 * `GS ( k` es una familia de cinco comandos y **todos llevan un NUL adentro**
 * (el byte alto del largo). Por el camino directo —HTTP + PHP hasta el programa
 * de la caja— ese cero se pierde, la impresora se queda esperando el parámetro
 * que falta y se come el trabajo siguiente. Es exactamente lo que colgó la
 * ticketera de Salud 4 con `GS V 66 0`, y por eso este comando NO se emite por
 * ese camino: ahí el QR viaja como URL en el campo `qr`, que es lo que el
 * sistema de facturación ya hace y por eso está probado.
 *
 * Por la cola los bytes van en base64 y el NUL sobrevive intacto.
 *
 * Los cuatro pasos son fijos y en este orden: modelo, tamaño de módulo, nivel
 * de corrección, guardar los datos, imprimir. Saltarse el primero deja el
 * modelo en el que la impresora traiga de fábrica, que no es el mismo en todas.
 */
function qrParaElRollo(valor, { modulo = QR_MODULO } = {}) {
    const texto = String(valor ?? '').trim();
    if (!texto) return '';
    // Un QR de más de 300 caracteres sale ilegible en 80 mm de papel: los
    // módulos quedan por debajo de lo que resuelve un teléfono. Se descarta acá
    // en vez de imprimir un cuadrito que nadie puede leer.
    if (texto.length > 300) return '';

    const k = (datos) => {
        const n = datos.length;
        return `${GS}(k${String.fromCharCode(n & 0xFF)}${String.fromCharCode((n >> 8) & 0xFF)}${datos}`;
    };
    const modeloDos   = k('1\x41\x32\x00');
    const tamano      = k('1\x43' + String.fromCharCode(Math.max(1, Math.min(16, modulo))));
    // Nivel M: aguanta ~15% del código tapado. En un papel que se dobla y se
    // guarda en un bolsillo, el mínimo es poco.
    const correccion  = k('1\x45\x31');
    const guardar     = `${GS}(k${String.fromCharCode((texto.length + 3) & 0xFF)}${String.fromCharCode(((texto.length + 3) >> 8) & 0xFF)}1\x50\x30${texto}`;
    const imprimir    = k('1\x51\x30');

    return CENTRO + modeloDos + tamano + correccion + guardar + imprimir + IZQUIERDA;
}

/**
 * La orden de cortar el papel: `GS V '1'`, corte parcial.
 *
 * **Sólo la lleva el ticket que viaja a la cola de la sala**, y ésa es toda la
 * regla. Los dos caminos no son iguales:
 *
 *   · **Camino directo** (`printik_pista.php`, la computadora de la caja): ese
 *     programa **ya manda el corte por su cuenta** —`chr(29).chr(86)."1"`
 *     después del pie, junto con el pulso del cajón, leído en su código el
 *     2026-08-18—. Un corte del portal acá se SUMA al suyo, no lo reemplaza.
 *   · **Camino de la cola** (el agente de la caja): `lp -o raw` entrega los
 *     bytes tal cual, sin driver que agregue nada. Ahí **nadie manda el corte**,
 *     así que el papel salía entero y había que arrancarlo a mano. Es el camino
 *     por el que imprime hoy quien manda desde el teléfono o desde otra
 *     computadora — o sea, el que el usuario reportó sin cortar el 2026-08-18.
 *
 * **Corte parcial y no total**: deja una pestaña, así el ticket queda colgando
 * en vez de caerse al piso mientras nadie lo está esperando. Es el mismo que
 * usan los tickets del sistema de facturación en esas salas.
 *
 * **Va DESPUÉS de los `SALTOS_DE_CORTE`, no en su lugar.** La cuchilla está
 * unos centímetros arriba del cabezal: cortar sin esos saltos parte texto que
 * todavía está adentro de la máquina.
 *
 * **Tres bytes y ninguno en cero, y eso no es estética.** `GS V 66 0` (el
 * intento de v2.661.5) son cuatro y el último es un NUL: por el camino de HTTP
 * + PHP ese cero se pierde, la impresora se queda esperando el parámetro que
 * falta y **se come el trabajo siguiente** — colgó la ticketera de Salud 4 y
 * con ella los tickets de facturación. `GS V 1` está medido en esa misma
 * ticketera escribiendo directo al dispositivo (v2.661.7): corta, y el otro
 * sistema sigue imprimiendo después. Por eso también queda descartado
 * `GS V 0` —corte total, pero termina en `\x00`—, aunque por la cola los bytes
 * viajen en base64 y un NUL sí sobreviva: un solo comando de corte para los dos
 * caminos es una cosa menos que se puede desincronizar.
 *
 * **Y por eso el agente sigue con `CORTAR=0`.** Su corte opcional (`GS V 0`) es
 * de cuando el ticket no traía el suyo; encenderlo ahora corta dos veces.
 */
const CORTAR_PAPEL = `${GS}V1`;

/**
 * Columnas del ticket del origen, contadas sobre un ticket real.
 *
 * `FIN_*` es la columna donde TERMINA cada importe, medida en la línea
 * `FLUCONAZOL 150MG X 2 CAPS. MK   2.00    8.05   16.10  `: la cantidad cierra
 * en 36, el precio en 44 y el importe en 52 — con dos columnas de margen a la
 * derecha, que es por qué el renglón mide 54 y el último número no llega al
 * borde.
 *
 * Con UNA sola línea de muestra no se puede saber si el origen alinea ese último
 * importe a la derecha en 52 o a la izquierda en un campo de 7; acá se eligió a
 * la derecha, que es lo correcto para una columna de dinero y deja el margen
 * igual. Es la única decisión de este bloque que no salió de medir.
 */
// `grande` es el ancho a doble ancho: la mitad de `normal`, porque cada
// carácter ocupa dos columnas. No es una preferencia, es aritmética del aparato.
export const COLUMNAS_TICKET = { chica: 54, normal: 40, grande: 20 };
const FIN_NOMBRE = 31, FIN_CANT = 36, FIN_PU = 44, FIN_TOTAL = 52;

const aDerecha = (texto, hasta) => String(texto).padStart(hasta).slice(-hasta);
const regla = (n = COLUMNAS_TICKET.chica) => '_'.repeat(n);

/** Un renglón con el rótulo a la izquierda y el valor pegado a la derecha. */
function dosColumnas(izq, der, ancho = COLUMNAS_TICKET.chica) {
    const i = String(izq ?? ''), d = String(der ?? '');
    const hueco = Math.max(1, ancho - i.length - d.length);
    return `${i}${' '.repeat(hueco)}${d}`.slice(0, ancho);
}

/**
 * El rollo no lee UTF-8. Medido en la caja de Salud 3 (2026-08-14, primer ticket
 * que salió del portal): «IMPRESIÓN» imprimió `IMPRESIŁN`, «NUÑEZ» imprimió
 * `NUÆEZ` y el `·` de los separadores imprimió `™`. La ticketera interpreta un
 * codepage de un byte y el portal manda dos bytes por carácter acentuado, así que
 * **todo lo que no sea ASCII sale mal** — y sale mal en silencio, porque el papel
 * no puede quejarse.
 *
 * Se transcribe a ASCII en vez de negociar un codepage porque es exactamente lo
 * que hace el sistema de facturación: sus encabezados y pies configurados no
 * tienen un solo acento («COMO LE ATENDIMOS HOY?», «DESPUES DE 3 DIAS»). O sea
 * que es la solución ya probada en este hardware, no una que haya que verificar.
 * Si algún día hace falta la ñ de verdad, el camino es `ESC t n` + escribir el
 * cuerpo en ese codepage, y **se decide con papel en la mano**, no leyendo.
 */
function soloASCII(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca las tildes, deja la letra
        .replace(/[·•]/g, '-')
        .replace(/[—–]/g, '-')
        .replace(/[“”«»]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[°º]/g, 'o').replace(/ª/g, 'a')
        .replace(/€/g, 'EUR')
        // Lo que quede fuera de ASCII se ve, en vez de salir como una letra ajena
        // que parece intencional. El rango ARRANCA en \x00 a propósito y por eso
        // la regla va apagada acá: los códigos ESC/POS son caracteres de control
        // —`\x1b`, `\f`, `\x01`— y son justo lo que NO hay que tocar.
        // eslint-disable-next-line no-control-regex
        .replace(/[^\x00-\x7E]/g, '?');
}

/** Parte un nombre en renglones de a lo sumo `ancho`, sin cortar palabras. */
function enRenglones(texto, ancho) {
    const palabras = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
    const renglones = [];
    let actual = '';
    for (const p of palabras) {
        if (!actual) actual = p.slice(0, ancho);
        else if (actual.length + 1 + p.length <= ancho) actual += ` ${p}`;
        else { renglones.push(actual); actual = p.slice(0, ancho); }
    }
    if (actual) renglones.push(actual);
    return renglones.length ? renglones : [''];
}

/**
 * Una línea de producto en las columnas del origen. El nombre que no entra en 31
 * caracteres **sigue en el renglón de abajo** —así lo hace el origen: su
 * «FLUCONAZOL 150MG X 2 CAPS. MK» continuaba con «CAJA»—, nunca se recorta.
 *
 * Con cuatro columnas usa la geometría medida del origen. Con cualquier otra
 * cantidad cae a rótulo-izquierda / valor-derecha, que es lo único que se puede
 * alinear sin inventar posiciones.
 */
function filaDeItem(celdas) {
    if (celdas.length !== 4) return [dosColumnas(celdas[0], celdas[celdas.length - 1])];
    const [nombre, cant, pu, total] = celdas;
    const [primera, ...resto] = enRenglones(nombre, FIN_NOMBRE);
    const linea = primera.padEnd(FIN_NOMBRE)
        + aDerecha(cant, FIN_CANT - FIN_NOMBRE)
        + aDerecha(pu, FIN_PU - FIN_CANT)
        + aDerecha(total, FIN_TOTAL - FIN_PU);
    return [linea, ...resto];
}

/**
 * Los datos de arriba, de a dos por renglón donde quepan (ver `emparejarDatos`).
 *
 * Cada renglón sale **rellenado hasta las 54 columnas**, y no es cosmético: el
 * ticket se imprime con el centrado puesto desde el encabezado, y un renglón de
 * 40 caracteres centrado arranca siete columnas más adentro que uno de 54. Con
 * el relleno, centrar deja de mover nada y las dos columnas quedan a plomo.
 * Es lo mismo que hacen los totales, por lo mismo.
 */
function renglonesDeDatos(datos, ancho = COLUMNAS_TICKET.chica) {
    const mitad = Math.floor(ancho / 2);
    const texto = ([rot, val]) => `${rot}: ${val}`;
    return emparejarDatos(datos, ancho).flatMap((fila) => (
        fila.length === 2
            ? [(texto(fila[0]).padEnd(mitad) + texto(fila[1])).padEnd(ancho)]
            // Uno solo y no entra: se parte por palabras, nunca se recorta —
            // el que se recorta en silencio es un dato perdido.
            : enRenglones(texto(fila[0]), ancho).map(l => l.padEnd(ancho))
    ));
}

/** El encabezado de la tabla, en las mismas posiciones que sus datos. */
function encabezadoDeItems(columnas) {
    if (columnas.length !== 4) return dosColumnas(columnas[0]?.label, columnas[columnas.length - 1]?.label);
    const [c1, c2, c3, c4] = columnas.map(c => c.label ?? '');
    return c1.padEnd(FIN_NOMBRE)
        + aDerecha(c2, FIN_CANT - FIN_NOMBRE)
        + aDerecha(c3, FIN_PU - FIN_CANT)
        + aDerecha(c4, FIN_TOTAL - FIN_PU);
}

/**
 * El ticket en las secciones que espera el programa de impresión, con sus
 * códigos. Devuelve exactamente las claves que manda el origen.
 *
 * ── Un código de impresora NO va en su propio renglón ────────────────────────
 * `\x1b a \x01` no imprime nada, pero el `\n` que lo sigue sí: **sale un
 * renglón en blanco**. Había cuatro —antes de los datos, antes de la tabla,
 * antes de los totales y después— y en un papel de veinte renglones eso es una
 * quinta parte del rollo gastada en nada. Cada código viaja pegado al renglón
 * que le toca mandar.
 */
export function seccionesParaElPrograma(ticket) {
    const { encabezado = {}, datos = [], bloques = [], items, totales = [], pie = [], codigos = [] } = ticket;

    // El nombre de la farmacia sale en letra grande; de la regla para abajo,
    // todo en chica. Cuando no hay líneas de encabezado —la etiqueta de una
    // bolsa no lleva ninguna— el cambio de letra viaja con la regla: en su
    // propio renglón sería un renglón vacío.
    const lineasDeEncabezado = (encabezado.lineas ?? []).filter(Boolean);
    const cabeza = [
        JUEGO_DE_CARACTERES + CENTRO + DOBLE_ALTO + (encabezado.titulo ?? ''),
        ...(lineasDeEncabezado.length ? [LETRA_CHICA + lineasDeEncabezado.join('\n')] : []),
        LETRA_CHICA + regla(),
        (ticket.titulo ?? '').toUpperCase(),
    ].filter(Boolean).join('\n') + '\n';

    const medio = [
        // El centrado y la letra chica ya vienen puestos del encabezado.
        ...renglonesDeDatos(datos),
        regla(),
        ...bloques.flatMap(b => [
            b.titulo ?? '',
            // La prosa se parte ACÁ, en palabras. Si se manda entera, la parte la
            // impresora en la columna donde se le acaba el papel y corta a mitad
            // de palabra: en el primer ticket real salió «…ES EL ANCHO DE EST /
            // A IMPRESORA.». El aparato no sabe qué es una palabra.
            // `destacado` sube el texto a doble alto Y doble ancho. Acá sí va el
            // doble ancho —que `dosColumnas` no puede usar, porque rellena
            // contando 40 columnas—: este renglón está solo y centrado, así que
            // no hay nada que alinear contra él. A cambio caben 20 caracteres,
            // que es el ancho con el que se parte.
            ...(b.texto
                ? (b.destacado
                    ? [DESTACADO_GRANDE + enRenglones(b.texto, COLUMNAS_TICKET.grande).join('\n') + LETRA_CHICA]
                    : enRenglones(b.texto, COLUMNAS_TICKET.chica))
                : []),
            b.monoespaciado ?? '',
            ...(b.filas ?? []).map(([r, v]) => dosColumnas(r, v)),
        ].filter(Boolean)),
        ...(items ? [
            IZQUIERDA + encabezadoDeItems(items.columnas),
            regla(),
            ...items.filas.flatMap(filaDeItem),
            regla(),
        ] : []),
        ...(totales.length ? [
            // Rellenados por nosotros, no alineados por el aparato. En el ticket
            // del 14-08 los totales salieron centrados pese al `ESC a 2`, y el
            // renglón sobrante de un nombre largo salió indentado pese al
            // `ESC a 0`: lo único que se alineó bien fue la tabla de items, que
            // es justo la que se rellena con espacios acá. Un `dosColumnas` sin
            // espacios al final se ve igual esté centrado o alineado a la
            // derecha, así que deja de depender de quién decida la alineación.
            // El cambio a letra normal viaja con el primer total: en su propio
            // renglón imprimía uno vacío. Y no hace falta volver a letra chica
            // al final — la sección del pie la vuelve a pedir ella misma.
            //
            // El destacado se IMPRIME (pedido del usuario, 2026-08-18: «que se
            // vea un poco más»). El HTML lo pintaba desde el primer día —clase
            // `grande`— y el rollo se lo comía: los tres totales salían iguales,
            // así que en el papel de la sala la cifra que alguien cuenta con las
            // manos no se distinguía de las dos que la explican. Es el mismo
            // dato con dos salidas, y una lo decía y la otra no.
            //
            // El reset va al final del MISMO renglón, no en el siguiente: un
            // código solo se lleva un renglón de rollo.
            ...totales.map(([r, v, destacado], i) => (i === 0 ? DERECHA + LETRA_NORMAL : '')
                + (destacado ? DESTACADO : '')
                + dosColumnas(r, v, COLUMNAS_TICKET.normal)
                + (destacado ? LETRA_NORMAL : '')),
        ] : []),
        /* Los códigos de barras van AL FINAL, después de la tabla (pedido del
         * usuario, 2026-08-24: «pasa el código de barras para el final»).
         *
         * No cambia ningún ticket de los que ya existen: hoy **ninguno lleva
         * códigos Y tabla a la vez** —el carné y la hoja de prueba tienen
         * códigos y no tienen items; la bolsa y el vale al revés—, así que el
         * único que se mueve es el del traslado, que es el que lo pidió.
         *
         * Y ahí abajo es donde sirve: quien pasa el lector no tiene que buscar
         * las barras en medio del papel, las encuentra en el borde. La leyenda
         * queda soportada por si algún día un código la necesita — el del
         * traslado NO la manda, a propósito.
         *
         * El comando NO lleva `\n` adelante: viaja pegado al renglón que le
         * toca, por lo mismo que los cambios de letra (un código solo se
         * llevaría un renglón de rollo). */
        ...codigos.flatMap(c => [
            codigoDeBarrasParaElRollo(c),
            ...(c.leyenda ? [c.leyenda] : []),
        ].filter(Boolean)),
    ].join('\n') + '\n';

    return {
        encabezado: soloASCII(cabeza),
        cuerpo: soloASCII(medio),
        // El origen manda acá sólo los códigos y pone las cifras en el cuerpo.
        totales: DOBLE_ALTO + LETRA_NORMAL,
        total_letras: CENTRO,
        // El `\n` después de los códigos es **un renglón en blanco a propósito**,
        // el único del ticket: separa el total —la cifra que alguien va a contar
        // con las manos— del pie, que en el rollo salía pegado abajo. En la
        // vista previa ese corte lo hace una línea, que el papel térmico no
        // puede pagar. No sacarlo creyendo que es de los cuatro que se quitaron
        // en v2.654.2: aquéllos eran códigos sueltos que nadie pidió.
        //
        // Los saltos del final son el margen de corte (ver SALTOS_DE_CORTE): la
        // cuchilla queda arriba del punto donde deja de salir papel.
        // El `\n` de adelante sólo va si HAY pie: separa el total —la cifra que
        // alguien va a contar con las manos— de lo que viene abajo, y sin pie no
        // separa nada. Se vio en el ticket de traslado, que desde el 2026-08-24
        // no lleva pie: era un renglón en blanco de más en cada papel.
        pie: soloASCII(LETRA_CHICA + CENTRO + (pie.length ? '\n' + pie.join('\n') : ''))
            + '\n'.repeat(SALTOS_DE_CORTE),
        img: '',
        // Por ESTE camino el QR va como URL: el programa de la caja lo dibuja,
        // que es lo que el sistema de facturación ya hace. Los bytes ESC/POS
        // NO pueden ir acá — llevan NUL y el NUL se pierde en el trayecto.
        qr: String(ticket?.qr ?? ''),
        qr_farmalasa: '',
    };
}

/**
 * El ticket como los bytes que se le mandan a la impresora, en una sola cadena.
 *
 * Es lo que viaja a la cola de la sala para que el agente de la caja lo tubee a
 * `lp -d <impresora> -o raw`. **La maquetación se queda acá**: el agente es un
 * caño, igual que el programa del sistema de facturación. Si supiera de
 * columnas habría dos maquetadores que mantener parecidos, y la diferencia sólo
 * se vería en el papel.
 *
 * Arranca con `ESC @` —inicializar— para que el estado de letra que dejó el
 * trabajo anterior no se cuele en éste: la cola imprime tickets seguidos y el
 * segundo saldría con la letra del primero.
 *
 * `totales` y `total_letras` de `seccionesParaElPrograma` NO se concatenan: son
 * sólo códigos de tamaño que el origen aplica antes de imprimir cifras que su
 * programa arma aparte. Acá las cifras ya vienen dentro de `cuerpo`.
 *
 * Y cierra con `CORTAR_PAPEL`, que es lo único que este camino tiene de más
 * que las secciones del camino directo: por acá no hay programa ajeno que lo
 * agregue después (ver la constante).
 */
export function textoParaElRollo(ticket) {
    const s = seccionesParaElPrograma(ticket);
    // El QR va acá y no dentro de las secciones, por lo mismo que el corte: es
    // lo ÚNICO que se emite distinto según el camino. Entre el cuerpo y el pie,
    // que es donde el programa de la caja pone el suyo.
    return `${ESC}@` + s.encabezado + s.cuerpo + qrParaElRollo(ticket?.qr) + s.pie + CORTAR_PAPEL;
}

/**
 * Los mismos bytes, en base64, para que puedan viajar dentro de un JSON.
 *
 * **Un ticket no es un texto: es un flujo de bytes.** `LETRA_NORMAL` es
 * `ESC ! \x00` e `IZQUIERDA` es `ESC a \x00`, así que todo ticket lleva al
 * menos un NUL — y un NUL no cabe ni en un JSON ni en una columna `text` de
 * Postgres. La cola de las salas guardaba texto y por eso rechazaba **todos**
 * los documentos con 400 «unsupported Unicode escape sequence»: no fallaba uno,
 * fallaban todos, y el portal lo leía como «esta sala no tiene caja» y caía al
 * diálogo del navegador. O sea que el papel salía en la computadora de quien
 * apretaba el botón, que es exactamente lo que la cola existe para evitar.
 *
 * `charCodeAt & 0xFF` y no `TextEncoder`: el rollo lee UN byte por carácter y
 * el ticket ya viene transcrito a ASCII por `soloASCII`. Con UTF-8, cada
 * acentuada saldría como dos bytes y el papel volvería a mostrar letras ajenas
 * —que es el bug que `soloASCII` arregló midiendo papel en Salud 3—.
 */
export function ticketEnBase64(texto) {
    let bytes = '';
    for (let i = 0; i < texto.length; i++) {
        bytes += String.fromCharCode(texto.charCodeAt(i) & 0xFF);
    }
    return btoa(bytes);
}

// La regla de columnas —que NO es el `regla()` de más arriba, el separador de
// guiones bajos del ticket—: un renglón de EXACTAMENTE n caracteres, con un dígito
// cada 10. Se imprimen tres —32, 40 y 48— y el papel contesta cuál es el ancho
// real: el que llega justo al borde sin partirse es la capacidad de la
// impresora. Es la única forma honesta de saberlo; el modelo declarado y lo que
// sale del rollo no siempre coinciden, y la pantalla no puede medirlo.
//
// Vive acá y no en la pantalla de prueba porque la usan DOS papeles: el que se
// imprime en esta computadora y el que se manda a la caja de una sala. Dos
// definiciones de la regla serían dos instrumentos de medir distintos, y la
// diferencia sólo se vería comparando dos papeles.
export const reglaDeColumnas = (n) => Array.from({ length: n }, (_, i) => {
    const c = i + 1;
    if (c % 10 === 0) return String((c / 10) % 10);
    if (c % 5 === 0) return '+';
    return '-';
}).join('');

const dosDigitos = (n) => String(n).padStart(2, '0');
export const fechaHora = (d) => `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()}`
    + ` ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;

/**
 * El valor que se imprime en las barras de prueba.
 *
 * Ocho caracteres, como el código de un carné real: el ancho que ocupa el
 * código depende de cuántos son, así que probar con tres no contestaría si el
 * de verdad entra en el rollo. Se lee igual a ojo, para que quien pase el
 * lector pueda comparar lo que salió en la pantalla con lo que imprimió.
 */
export const VALOR_DE_PRUEBA_DE_BARRAS = 'PRUEBA12';

/**
 * Las dos barras de prueba: la misma cadena en las dos simbologías.
 *
 * Se imprimen JUNTAS y no una a la vez porque la pregunta no es «¿imprime?»
 * sino «¿cuál de las dos lee el lector de la sala?», y eso se contesta pasando
 * el lector por las dos en el mismo papel. La leyenda dice cuál es cuál: sin
 * ella, quien está frente a la ticketera no puede reportar cuál funcionó.
 */
export const codigosDePrueba = (valor = VALOR_DE_PRUEBA_DE_BARRAS) => SIMBOLOGIAS.map(sim => ({
    valor, simbologia: sim, leyenda: sim,
}));

/**
 * El papel que prueba UNA caja de sala, mandado por su cola.
 *
 * Existe porque hasta el 2026-08-19 no había forma de probar el agente desde el
 * portal: el único botón de la pantalla de impresión usa el camino directo, o
 * sea que después de actualizar una caja no se podía saber si imprimía sin
 * gastar un documento de verdad. Eso fue lo que hizo parecer un problema del
 * agente lo que era un problema del orden de la cascada (ver
 * `imprimirDocumento`).
 *
 * Lleva la regla porque **el ancho del rollo se mide en la caja, no acá**: cada
 * sala tiene su impresora y este papel es el que puede contestarlo sin que
 * nadie viaje.
 *
 * Dice a qué caja se mandó, para que quien esté frente a la ticketera sepa si
 * el papel que tiene en la mano es el que apretó alguien más — y quién.
 */
export function construirTicketDePruebaDeCaja({
    caja = '', sala = '', quien = '', version = '', ancho = ANCHO_POR_DEFECTO, ahora = new Date(),
} = {}) {
    return {
        ancho,
        titulo: 'Prueba de la caja',
        datos: [
            ['Caja', caja || '—'],
            ['Sala', sala || '—'],
            ['La mandó', quien || '—'],
            ['Fecha', fechaHora(ahora)],
            ...(version ? [['Portal', `v${version}`]] : []),
        ],
        bloques: [
            {
                titulo: 'Cuántas letras entran',
                texto: 'El renglón más largo que NO se parta en dos es el ancho de esta impresora.',
                monoespaciado: `32:\n${reglaDeColumnas(32)}\n40:\n${reglaDeColumnas(40)}`
                    + `\n48:\n${reglaDeColumnas(48)}`,
            },
            {
                titulo: 'Codigos de barras',
                texto: 'Pasa el lector por los dos y anota cual reconoce.',
            },
        ],
        codigos: codigosDePrueba(),
        barraPrueba: true,
        pie: [
            'Si este papel salió, esta caja imprime lo que',
            'se le manda desde cualquier computadora o telefono.',
            'Es una prueba: no es un comprobante.',
        ],
    };
}

/**
 * ¿El navegador tiene prohibido alcanzar la red local de esta computadora?
 *
 * Existe porque sin esto **«no hay programa» y «el navegador me bloqueó» se ven
 * exactamente iguales**: una petición sin CORS que no llega rechaza con el mismo
 * `TypeError` en los dos casos. El primero es lo normal fuera de una sala; el
 * segundo puede pasar DENTRO de una sala, con el programa andando, y mandaría a
 * buscar el problema al lugar equivocado.
 *
 * `permissions.query` lanza con un nombre que el navegador no conoce, así que el
 * `catch` es el camino normal en cualquier navegador que no implemente el
 * permiso, no un error.
 *
 * @returns {Promise<'granted'|'denied'|'prompt'|null>} null = no se sabe.
 */
export async function permisoDeRedLocal() {
    try {
        const p = await navigator.permissions.query({ name: 'local-network-access' });
        return p.state;
    } catch {
        return null;
    }
}

/**
 * Comprueba qué contesta esta computadora, antes de gastar papel.
 *
 * El truco es una asimetría del navegador que sí sirve para distinguir: una
 * petición sin CORS **resuelve** cuando algo contestó —aunque conteste 404, el
 * contenido es ilegible pero la conexión existió— y **rechaza** cuando no hay
 * nadie escuchando. Con eso alcanza para separar las dos preguntas que hasta
 * ahora se veían iguales: ¿hay un servidor en esta computadora?, ¿y me deja el
 * navegador hablarle?
 *
 * Lo que NO puede decir: si el programa de impresión está bien instalado. Un 404
 * y un 200 se ven idénticos, así que «contesta» significa «hay un servidor web
 * ahí», no «el programa existe». Por eso se prueba la CARPETA y no el archivo:
 * un GET al archivo podría hacerlo imprimir un ticket vacío.
 *
 * Y tampoco distingue un tercer caso, que fue el que de verdad pasó (2026-08-14,
 * caja de Salud 3): que el pedido **no haya salido nunca**. La CSP del portal no
 * incluía `http://localhost` en `connect-src`, así que el navegador lo cortaba
 * antes de tocar la red — con el mismo `TypeError` que «no hay nadie ahí». Se ve
 * en la consola del navegador, no acá; por eso el motivo ahora viaja en el
 * resultado en vez de morir en un `catch` vacío. Si alguna vez las tres vuelven
 * a decir «no contesta» mientras `curl` entra desde esa misma computadora, mirar
 * primero `vercel.json`.
 *
 * @returns {Promise<Array<{que: string, url: string, contesta: boolean, motivo?: string}>>}
 */
export async function comprobarLaConexion() {
    const destinos = [
        { que: 'Servidor web de esta computadora', url: 'http://localhost/' },
        { que: 'Carpeta del programa de impresión', url: `${RUTA_PROGRAMA}` },
        { que: 'Sistema de impresión del equipo', url: 'http://localhost:631/' },
    ];
    return await Promise.all(destinos.map(async (d) => {
        try {
            await fetch(d.url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000) });
            return { ...d, contesta: true };
        } catch (err) {
            return { ...d, contesta: false, motivo: `${err?.name ?? 'Error'}: ${err?.message ?? 'sin detalle'}` };
        }
    }));
}

/**
 * @returns {Promise<{ok: boolean, detalle: string, direccion: string, motivo?: string}>}
 * `ok` significa que el programa recibió el pedido, NO que el papel salió: eso no
 * se puede saber.
 */
export async function enviarAImpresoraDeLaComputadora(ticket, { sistema = 'linux', impresora = '//localhost/ticket' } = {}) {
    const archivo = sistema === 'windows' ? 'printposwin1.php' : 'printik_pista.php';
    const cuerpo = new URLSearchParams({
        ...seccionesParaElPrograma(ticket),
        efectivo: '0',
        cambio: '0',
        // El origen sólo manda el nombre de la impresora en Windows: en Linux el
        // programa ya sabe a cuál escribir.
        ...(sistema === 'windows' ? { shared_printer_pos: impresora } : {}),
    });

    const direccion = `${RUTA_PROGRAMA}${archivo}`;

    try {
        await fetch(direccion, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: cuerpo.toString(),
            signal: AbortSignal.timeout(8000),
        });
        return {
            ok: true,
            direccion,
            detalle: 'La computadora recibió el pedido. Si no salió papel, la impresora no está '
                + 'registrada con el nombre esperado — la prueba de verdad es el papel, no este aviso.',
        };
    } catch (err) {
        // El aviso dice lo que PASÓ y ofrece las causas posibles, en vez de
        // elegir una: el navegador rechaza igual cuando no hay nada escuchando y
        // cuando él mismo bloqueó la salida a la red local. Dar por sentada la
        // primera manda a buscar el problema al lugar equivocado justo en el caso
        // que importa — una sala con el programa andando.
        const motivo = `${err?.name ?? 'Error'}: ${err?.message ?? 'sin detalle'}`;

        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
            return {
                ok: false, direccion, motivo,
                detalle: 'La computadora no contestó en 8 segundos. Si es una computadora de sala, '
                    + 'el programa de impresión está detenido o colgado.',
            };
        }
        if (await permisoDeRedLocal() === 'denied') {
            return {
                ok: false, direccion, motivo,
                detalle: 'El navegador tiene bloqueado el acceso a la red local de esta computadora. '
                    + 'Hay que permitirlo en el candado de la barra de direcciones y volver a intentar.',
            };
        }
        return {
            ok: false, direccion, motivo,
            detalle: 'Nadie contestó en esa dirección. En una computadora que no es de sala es lo '
                + 'esperado: no tiene el programa de impresión directa, y el papel sale con el botón '
                + 'de arriba. Si ES una de sala, abre esa dirección en una pestaña de esa misma '
                + 'computadora: si tampoco responde ahí, el programa no está corriendo.',
        };
    }
}

// ── Los ajustes de ESTA computadora ─────────────────────────────────────────
//
// El ancho del rollo y el sistema son de la MÁQUINA, no de la cuenta ni de la
// sucursal: la ticketera está conectada a un equipo concreto y la de la sala de
// al lado puede ser otra. Por eso viven en el navegador de ese equipo y no en la
// base — guardarlos en los dos lados es la forma segura de que se desincronicen.
//
// Y viven ACÁ, no en la pantalla de prueba, porque **toda** pantalla que imprima
// los necesita: una segunda copia del `localStorage.getItem` sería una segunda
// definición de cuál es el ancho por defecto, y sólo se notaría en el papel.
const LS_AJUSTES = 'portal-impresion';

export function leerAjustesDeImpresion() {
    try {
        const g = JSON.parse(localStorage.getItem(LS_AJUSTES) || '{}');
        return {
            ancho: ANCHOS_ROLLO.some(a => a.mm === g.ancho) ? g.ancho : ANCHO_POR_DEFECTO,
            sistema: g.sistema === 'windows' ? 'windows' : 'linux',
        };
    } catch {
        return { ancho: ANCHO_POR_DEFECTO, sistema: 'linux' };
    }
}

export function guardarAjustesDeImpresion(ajustes) {
    try { localStorage.setItem(LS_AJUSTES, JSON.stringify(ajustes)); } catch { /* modo privado o sin cuota */ }
    return ajustes;
}

/**
 * **Este es el que llama una pantalla.** Los otros dos son las mitades.
 *
 * El ancho y el sistema salen de los ajustes de esta computadora; `ticket.ancho`
 * los pisa si la pantalla tiene un motivo para elegirlo.
 *
 * `soloDirecta` es para los papeles que salen SOLOS, sin que nadie haya
 * apretado «imprimir»: al confirmar un corte, por ejemplo. Ahí el respaldo del
 * diálogo no sirve y estorba — quien confirma desde el teléfono se encontraría
 * con una ventana de impresión que no pidió.
 *
 * `soloCola` es para cuando alguien ELIGIÓ la sala. Ahí la cascada deja de ser
 * una ayuda y pasa a ser una traición: si la cola rechaza y el papel sale en la
 * computadora de quien apretó el botón, esa persona se queda esperando en la
 * otra punta un papel que nunca va a llegar, y el aviso dijo que salió. Con
 * esto, un rechazo se REPORTA en vez de imprimirse en otro lado.
 *
 * ── El orden: la caja de la sala PRIMERO ───────────────────────────────────
 *
 * Hasta el 2026-08-19 se intentaba primero el camino directo de esta
 * computadora, y eso fallaba justo donde tenía que funcionar. Medido en Salud 4
 * ese día: en la computadora de la caja el programa del otro sistema **sí
 * contesta** —por eso ese sistema imprime—, su respuesta llega **opaca**, y el
 * portal daba el trabajo por impreso. No encolaba nada y no salía papel. La
 * cola de esa sala tenía 8 documentos del día de la instalación y **ninguno en
 * las 24 horas siguientes**, mientras las otras cinco salas encolaban 14, 14,
 * 14, 16 y 11: las salas donde el portal funcionaba eran las que imprimían
 * desde una computadora SIN ese programa.
 *
 * O sea que el camino que no se puede verificar iba adelante del que sí, y
 * ganaba siempre en el único lugar donde importa. Un acuse ilegible no puede
 * decidir: hoy el orden es el de la **evidencia decreciente**.
 *
 *   1. **La caja de la sala**, si esa sala tiene una registrada — el agente
 *      contesta si el comando funcionó y llega en dos segundos (medido: 1.7).
 *      En la computadora de la caja los dos caminos terminan en la MISMA
 *      ticketera, así que preferir el que acusa recibo no cuesta nada.
 *   2. **Esta computadora**, para la sala que no tiene caja registrada — el
 *      papel sale al instante, pero «recibido» no es «salió».
 *   3. **El diálogo del navegador**, el respaldo de siempre.
 *
 * `encolar_impresion` rechaza cuando esa sala no tiene ninguna caja registrada,
 * así que llegar al paso 2 significa que la cola no era un camino, no que se
 * prefirió el otro. Y no puede imprimir dos veces: cada paso corre sólo cuando
 * el anterior fue rechazado.
 *
 * **Lo que sí cambia al poner la cola primero**: una caja registrada pero
 * apagada ya no deja pasar al camino directo — el documento queda esperando en
 * su cola y sale cuando la caja despierta. Es a propósito: ese documento es de
 * ESA sala y ahí tiene que salir, y esperar es mejor que imprimirlo en la
 * computadora de quien apretó el botón. Pero el aviso dice «sale en unos
 * segundos», que con la caja apagada no es cierto; quién está latiendo se ve en
 * Sistema → Prueba de impresión.
 *
 * Lo que sigue sin poder prometerse es el paso 2: la respuesta del programa de
 * la caja es opaca por construcción (ver `enviarAImpresoraDeLaComputadora`).
 * Por el paso 1, en cambio, `ok` significa que el agente escribió.
 *
 * @returns {Promise<{via: 'directa'|'cola'|'dialogo', ok: boolean, detalle: string}>}
 */
/**
 * La capa de datos de la cola, bajada JUNTO con este archivo.
 *
 * Sigue siendo un `import()` —no tiene por qué viajar en el chunk de una vista
 * que quizá nunca imprima— pero **se pide al cargar este módulo y no al
 * imprimir**, y esa diferencia es el bug del 21-ago-2026.
 *
 * Los diálogos que escriben plata ya bajaban `ticketPrint` y `bolsaComprobante`
 * al ABRIR, justamente para que un despliegue en el medio no los dejara sin
 * papel (ver el comentario de `SalidaDeBolsa`). Éste era el tercer chunk de la
 * cadena y no lo prevenía nadie: tras un despliegue su hash ya no existe, el
 * `import()` devuelve el `index.html` del SPA, tira, `main.jsx` recarga la
 * página — y para entonces la salida ya está escrita. Medido: la remesa
 * REM-1013 (21-ago 16:14, seis segundos después de un despliegue) quedó
 * registrada, `bolsas.etiqueta_version` subió a 3 y en `cola_impresion` no hay
 * ni el vale ni la etiqueta. Ninguno de los dos papeles salió y no hubo aviso.
 *
 * Al pedirlo acá arriba viaja con `ticketPrint`, así que el precalentamiento
 * que ya hacen los diálogos lo cubre **sin que ninguna pantalla tenga que
 * acordarse** — que es la única forma de que no se olvide en la próxima.
 *
 * Si falla se olvida la promesa: el siguiente intento vuelve a pedirlo en vez
 * de quedar roto para siempre.
 */
let colaPromise = null;
function cargarLaCola() {
    if (!colaPromise) {
        colaPromise = import('../data/impresion')
            .catch((err) => { colaPromise = null; throw err; });
    }
    return colaPromise;
}
// Se adelanta al momento de imprimir. El `catch` es para que un fallo acá no
// quede como promesa sin capturar: `cargarLaCola()` lo va a volver a intentar.
cargarLaCola().catch(() => {});

export async function imprimirDocumento(
    ticket,
    { forzarDialogo = false, soloDirecta = false, soloCola = false, sala = null, tituloDeCola = null } = {},
) {
    const { ancho, sistema } = leerAjustesDeImpresion();
    // Las barras del camino del navegador se dibujan ANTES de elegir camino: si
    // se dibujaran sólo en la rama del diálogo, el ticket que sale por el rollo
    // y el que sale por el navegador dejarían de ser el mismo documento. Con un
    // ticket sin códigos no baja nada.
    const doc = await conCodigosDibujados({ ancho, ...ticket });

    if (!forzarDialogo) {
        if (sala != null) {
            const { encolarImpresion } = await cargarLaCola();
            const { error } = await encolarImpresion({
                branchId: sala,
                /* Cómo se llama el trabajo en la lista de la caja.
                 *
                 * Normalmente es el título del ticket, que es el mismo texto que
                 * sale impreso. Pero hay papeles que NO llevan título impreso —el
                 * ticket de traslado, que dice de dónde a dónde en sus propios
                 * renglones y no lo repite arriba— y ésos caían en «Documento»:
                 * una lista de cinco «Documento» no deja ver cuál no salió. */
                titulo: tituloDeCola || ticket?.titulo || 'Documento',
                contenidoB64: ticketEnBase64(textoParaElRollo(doc)),
            });
            if (!error) {
                return {
                    via: 'cola', ok: true,
                    detalle: 'Se mandó a la caja de la sala. Sale en unos segundos.',
                };
            }
            // Sin una caja registrada la función rechaza a propósito: una
            // cola que nadie lee es papel que nunca sale. Se sigue a los otros
            // dos caminos — salvo que la sala la haya elegido una persona.
            if (soloCola) {
                return {
                    via: 'cola', ok: false,
                    detalle: 'Esa sala no tiene una caja que reciba el documento. '
                        + 'Elige otra o imprímelo en esta computadora.',
                };
            }
        }

        const r = await enviarAImpresoraDeLaComputadora(doc, { sistema });
        if (r.ok) return { via: 'directa', ok: true, detalle: r.detalle };

        if (soloDirecta) return { via: 'directa', ok: false, detalle: r.detalle };
    }

    const error = await imprimirTicket(doc);
    return error
        ? { via: 'dialogo', ok: false, detalle: error }
        : { via: 'dialogo', ok: true, detalle: 'Se abrió el diálogo de impresión.' };
}
