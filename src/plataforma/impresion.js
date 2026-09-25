// ─────────────────────────────────────────────────────────────────────────────
// Imprimir con el navegador — la versión de la WEB.
// ─────────────────────────────────────────────────────────────────────────────
//
// `utils/ticketPrint.js` arma el TICKET (el texto del rollo de 54 columnas, el
// HTML de la vista previa) y sigue siendo el único punto de entrada para
// imprimir (`imprimirDocumento`, CLAUDE.md). Lo que vive acá es lo que sólo
// existe en un navegador: dibujar el código de barras como SVG, imprimir un
// iframe con el diálogo del sistema y preguntar el permiso de red local. En la
// app nativa el rollo irá por Bluetooth con el MISMO texto. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.

/** Un código de barras como SVG serializado. `limpio` ya pasó por
 *  `limpiarValorDeBarras` (eso es regla del ticket, no del navegador). */
export async function svgDeCodigoDeBarras(limpio, simbologia) {
    const JsBarcode = (await import('jsbarcode')).default;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, limpio, {
        format: simbologia, width: 2, height: 50, displayValue: false, margin: 0,
    });
    return new XMLSerializer().serializeToString(svg);
}

const HOLGURA_MM = 4;

/**
 * Pide al marco una página del alto justo de lo que tiene pintado (en mm, más
 * una holgura), para que el rollo no salga cortado ni con papel en blanco.
 * @returns {number|null} el alto en mm que quedó pedido.
 */
export function ajustarAltoDelMarco(marco, anchoPorDefecto) {
    const doc = marco?.contentDocument;
    if (!doc?.documentElement) return null;

    const ancho = doc.documentElement.dataset.ancho || anchoPorDefecto;
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
 * Imprime el documento que ya está pintado en un iframe. Devuelve el motivo
 * del fallo, o null si el diálogo se abrió.
 */
export function imprimirMarco(marco, anchoPorDefecto) {
    const ventana = marco?.contentWindow;
    if (!ventana) return 'La vista previa todavía no está lista.';
    try {
        // Se remide en cada impresión: el contenido pudo cambiar desde que se
        // pintó (otro ancho de rollo, otro documento) y un alto viejo cortaría
        // el final o dejaría papel en blanco.
        ajustarAltoDelMarco(marco, anchoPorDefecto);
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
 * Imprime un HTML sin vista previa en pantalla, en un iframe fuera de la vista.
 *
 * El iframe se saca después de `afterprint`, no en cuanto vuelve `print()`:
 * quitarlo antes cancela el trabajo en Chrome. El plazo de respaldo existe
 * porque `afterprint` no llega en todos los navegadores.
 */
export function imprimirHtmlSinVista(html, anchoPorDefecto) {
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
            const error = imprimirMarco(marco, anchoPorDefecto);
            marco.contentWindow?.addEventListener('afterprint', sacar);
            setTimeout(sacar, 60_000);
            resolve(error);
        };
        marco.srcdoc = html;
    });
}

/**
 * El permiso de red local del navegador (el que deja hablarle al programa de
 * impresión de ESTA computadora). `permissions.query` lanza con un nombre que el
 * navegador no conoce, así que el `catch` es el camino normal, no un error.
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
