/**
 * El rectángulo de lo último que el usuario tocó.
 *
 * Existe para que la apertura "en gota" de `HojaMovil` sea **canónica y no
 * opt-in**. La primera versión pedía el rectángulo por prop, así que solo la
 * tenían las hojas de `BarraFlotante` —las únicas que se acordaron de pasarlo— y
 * todos los demás modales del portal se abrían sin ella. Este proyecto ya tiene
 * escrita esa lección con el `buscador` de `FilterBar`, que **1 de 22 vistas**
 * pasaba: una prop opcional es una prop que alguien va a olvidar.
 *
 * Se escucha `pointerdown` en fase de CAPTURA porque para cuando el `click`
 * llega al handler que abre el modal, React ya puede haber re-renderizado y el
 * botón haber cambiado de sitio o desaparecido. En captura se mide antes de que
 * nadie reaccione.
 *
 * Solo puntero: con teclado no hay un "de dónde" físico —el foco no es un gesto
 * espacial— así que ahí `leerUltimoToque()` devuelve null y la hoja entra sin
 * gota. Es correcto: la animación cuenta de dónde salió algo, y si no salió de
 * ningún lado, inventarlo sería ruido.
 */

let ultimo = null;

if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (e) => {
        // El objetivo real es el control, no el ícono de adentro: sin esto la
        // gota nace del SVG de 18px y no del botón de 44, y el gesto se lee como
        // si saliera de un punto en vez de del control que se tocó.
        const ctrl = e.target?.closest?.('button, [role="button"], a[href], summary');
        const el = ctrl || e.target;
        const r = el?.getBoundingClientRect?.();
        ultimo = (r && r.width && r.height)
            ? { x: r.left, y: r.top, w: r.width, h: r.height, t: performance.now() }
            : null;
    }, true);
}

// La ventana de validez. Un modal que se abre medio segundo después de un toque
// salió de ese toque; uno que aparece a los diez segundos —un aviso de sesión
// por vencer, el resultado de un cron— no salió de ningún lado, y hacerlo nacer
// del último botón tocado contaría algo falso.
const VIGENCIA_MS = 1200;

export function leerUltimoToque() {
    if (!ultimo) return null;
    return performance.now() - ultimo.t <= VIGENCIA_MS ? ultimo : null;
}
