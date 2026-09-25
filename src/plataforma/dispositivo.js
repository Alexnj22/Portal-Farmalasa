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

/**
 * ¿Es un teléfono, una tablet o la app nativa? Por user-agent, y con el caso de
 * los iPad modernos, que en Safari se presentan como una Mac: la única forma de
 * distinguirlos es la pantalla táctil. (Antes vivía en `utils/helpers.js`.)
 */
export function esMovilOApp() {
    if (typeof window === 'undefined') return false;

    // 1. Detectar si está corriendo como App Nativa (Capacitor)
    if (window.Capacitor?.isNativePlatform()) return true;

    // 2. Detectar Celulares y Tablets por User Agent
    const ua = navigator.userAgent;
    const isMobile = /Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua);
    const isTablet = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua);

    // 3. Detectar iPads modernos (iOS 13+ finge ser una Mac en Safari, la única forma de saberlo es por la pantalla táctil)
    const isModernIPad = navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform);

    return isMobile || isTablet || isModernIPad;
}
