// ── Llevar a quien llena hasta el campo que falta (2026-11-14) ──────────────
//
// Un aviso «Falta el último día que trabajó» al pie de un formulario largo no
// dice DÓNDE está ese campo: había que subir y buscarlo. Esto lo encuentra por
// su `data-campo`, lo centra, le da el foco y lo hace destellar un momento.
//
// El campo se marca en el marcado (`<div data-campo="ultimoDiaLaborado">`),
// no con un ref: el aviso vive en el pie del modal y el campo en otro
// componente, y lo único que comparten es el DOM.

const DESTELLO_MS = 1600;

/**
 * @param {string} campo  el valor de `data-campo`
 * @param {ParentNode} [raiz]  dónde buscarlo (por defecto, todo el documento)
 * @returns {boolean} si lo encontró
 */
export function irAlCampo(campo, raiz = typeof document !== 'undefined' ? document : null) {
    if (!campo || !raiz) return false;
    // Primero el contenedor marcado; si no, el control por su `name` (los
    // `PortalInput`/`PortalTextarea` ya lo llevan) y su envoltura.
    const clave = CSS.escape(String(campo));
    const porNombre = raiz.querySelector(`[name="${clave}"]`);
    const el = raiz.querySelector(`[data-campo="${clave}"]`)
        || porNombre?.closest('[data-campo]') || porNombre?.parentElement || null;
    if (!el) return false;
    const quieto = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'center' });
    const foco = porNombre && el.contains(porNombre) ? porNombre : el.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    // Sin `preventScroll` el foco salta de golpe y le gana al desplazamiento suave.
    foco?.focus?.({ preventScroll: true });
    el.setAttribute('data-destello', '');
    setTimeout(() => el.removeAttribute('data-destello'), DESTELLO_MS);
    return true;
}
