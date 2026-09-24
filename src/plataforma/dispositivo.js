// ─────────────────────────────────────────────────────────────────────────────
// ¿En qué clase de dispositivo corre esto? — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// La sesión dura distinto en una app instalada que en una pestaña (ver
// `detectarClaseDispositivo` en `AuthContext`). En el navegador, «app» es la
// PWA agregada a inicio o el build de Capacitor. En la app nativa la
// respuesta es siempre sí: su gemelo `dispositivo.native.js` devolverá `true`.
// Ver `almacen.js` para el porqué.

/** PWA instalada (`display-mode: standalone`, o `navigator.standalone` en iOS)
 *  o build nativo de Capacitor. Puede lanzar si el navegador no tiene
 *  `matchMedia`: quien la llama ya lo atrapa, y así sigue. */
export function esAppInstalada() {
    const instalada = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    const nativo = !!(window.Capacitor?.isNativePlatform?.());
    return instalada || nativo;
}
