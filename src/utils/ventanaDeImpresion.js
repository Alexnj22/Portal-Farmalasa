// ═══════════════════════════════════════════════════════════════════════════
// La ventana en blanco donde el portal arma un papel.
//
// ── Por qué existe: `noopener` devuelve `null`, SIEMPRE ───────────────────
// Cinco sitios del portal abrían así la ventana de impresión:
//
//     const win = window.open('', '_blank', 'width=1000,height=900,noopener');
//
// y `window.open` con `noopener` entre los rasgos **devuelve `null` por
// especificación**, en todos los navegadores. Medido con Playwright sobre
// Chromium y WebKit: `null` en los dos, y el `sinNoopener` de al lado devuelve
// el objeto. O sea que la ventana se abre —en blanco— y el que la abrió no
// tiene con qué escribirle.
//
// El daño es que ninguno de los cinco lo decía. Tres se iban por un
// `if (!win) return` (las bitácoras del mes y la cotización: **no pasa nada**,
// ni un aviso), uno lanzaba un `TypeError` sobre `null.document` (la boleta de
// pago) y el del carné llegaba a un toast que culpaba al navegador —«el
// navegador bloqueó la ventana de impresión»— por algo que había pedido el
// código. Un mensaje que nombra al culpable equivocado es peor que ninguno:
// manda a revisar la configuración del navegador.
//
// `noopener` tampoco servía para lo que parecía. Una ventana abierta con
// `window.open('')` **hereda el origen del portal** —eso no lo cambia ningún
// rasgo—, así que la protección real es que el documento no lleve ni un
// `<script>`, que es lo que ya hacen todos. Lo que `noopener` sí hace es
// cortarle al hijo la referencia al padre, y eso se consigue igual con
// `win.opener = null` después de escribirlo, sin perder el handle.
//
// ── Y la ventana se abre SINCRÓNICA dentro del gesto ──────────────────────
// Después de un `await` el bloqueador de emergentes la mata: la activación del
// usuario es transitoria. Por eso esto son DOS funciones y no una — se abre
// primero, se buscan los datos después, y recién entonces se escribe.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_BLOQUEADA = 'El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes de este sitio y vuelve a intentarlo.';

/**
 * Abre la ventana en blanco. Llamar SINCRÓNICA dentro del manejador del clic.
 * @returns {Window|null} `null` sólo si el navegador la bloqueó de verdad.
 */
export function abrirVentanaDeImpresion({ ancho, alto } = {}) {
    const rasgos = [];
    if (ancho) rasgos.push(`width=${ancho}`);
    if (alto) rasgos.push(`height=${alto}`);
    try {
        return window.open('', '_blank', rasgos.join(',')) || null;
    } catch {
        return null;
    }
}

/**
 * Escribe el papel en la ventana y manda a imprimir.
 *
 * El retardo no es cosmético: sin él Safari imprime antes de aplicar el CSS y
 * sale el HTML crudo.
 *
 * @returns {{ok: boolean, motivo?: string}}
 */
export function escribirEImprimir(win, html, { retardo = 400, imprimir = true } = {}) {
    if (!win) return { ok: false, motivo: VENTANA_BLOQUEADA };
    try {
        win.document.write(html);
        win.document.close();
        // Lo que `noopener` prometía, pero conservando el handle.
        try { win.opener = null; } catch { /* otro origen: no pasa */ }
        win.focus();
        if (imprimir) setTimeout(() => { try { win.print(); } catch { /* la cerraron */ } }, retardo);
        return { ok: true };
    } catch (err) {
        try { win.close(); } catch { /* ya no está */ }
        return { ok: false, motivo: err?.message || 'No se pudo armar el papel.' };
    }
}
