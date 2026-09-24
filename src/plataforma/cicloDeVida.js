// ─────────────────────────────────────────────────────────────────────────────
// ¿La app está a la vista? ¿Alguien la está usando? — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// La sesión se cierra sola por inactividad, se revalida al volver a la
// pestaña y suelta el push al cerrar la página. Las tres cosas le preguntan
// al navegador (`document.visibilityState`, `visibilitychange`, `pagehide`,
// los eventos de mouse y teclado). En la app nativa las mismas preguntas se
// contestan con `AppState` y los toques: su gemelo `cicloDeVida.native.js`
// tendrá esta misma interfaz. Ver `almacen.js` para el porqué.
//
// ── Pares de «escuchar / soltar», no una función que devuelve la baja ──────
//
// `AuthContext` engancha los oyentes en un lugar (`startIdleWatcher`) y los
// quita en OTRO (`stopIdleWatcher`), con la identidad de la función como
// llave. Una interfaz que devolviera «la función para soltar» obligaría a
// guardar esa función en una ref y cambiaría el orden de lo que hoy funciona.
// Estos pares son `addEventListener`/`removeEventListener` con otro nombre:
// misma función, mismo flag de captura, mismo resultado.

/** `document.visibilityState` tal cual: 'visible' | 'hidden'. Se devuelve el
 *  texto y no un booleano porque el código de hoy compara de dos formas
 *  (`!== 'visible'` y `=== 'hidden'`), y no son lo mismo en todos los
 *  navegadores: mudarlas no puede cambiar cuál de las dos se hace. */
export const visibilidad = () => document.visibilityState;

export const escucharVisibilidad = (fn, captura = false) => document.addEventListener('visibilitychange', fn, captura);
export const soltarVisibilidad   = (fn, captura = false) => document.removeEventListener('visibilitychange', fn, captura);

/* Lo que cuenta como «alguien está usando la app». Son los cinco de siempre, y
 * en fase de captura: así los ve aunque un componente detenga el evento. */
const ACTIVIDAD = ['mousemove', 'keydown', 'wheel', 'click', 'touchstart'];
export const escucharActividad = (fn) => ACTIVIDAD.forEach((t) => window.addEventListener(t, fn, true));
export const soltarActividad   = (fn) => ACTIVIDAD.forEach((t) => window.removeEventListener(t, fn, true));

/** La página se va (`pagehide`, no `beforeunload`: éste no dispara en varios
 *  casos de móvil). */
export const escucharSalida = (fn) => window.addEventListener('pagehide', fn);
export const soltarSalida   = (fn) => window.removeEventListener('pagehide', fn);
