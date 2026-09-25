/**
 * ¿Este aparato guarda su tema aparte del de la computadora?
 *
 * El tema era UNO por usuario y viajaba entre dispositivos, así que el teléfono
 * le imponía el suyo a la computadora del trabajo y al revés. Lo pidió el
 * usuario el 2026-08-20: *«unos les gusta en su teléfono negro liquid glass, y
 * en el trabajo solid por el tema de eficiencia»*. Son dos preferencias
 * distintas, no una sola mal sincronizada.
 *
 * ── Por qué decide el puntero y no el ancho ───────────────────────────────
 * La regla ya estaba escrita en `useCoarsePointer` y en `useLayoutCompacto`:
 * *«lo que decide no es cuánto mide la ventana sino con qué se apunta»*. Una
 * ventana angosta de escritorio sigue teniendo mouse, y un teléfono acostado
 * mide 844px de ancho. Acá pesa todavía más que allá: el ancho cambia al girar
 * el teléfono o al arrastrar el borde de una ventana, y un tema que cambia solo
 * al redimensionar sería un parpadeo, no una preferencia.
 *
 * `(hover: none)` y no `(pointer: coarse)` por consistencia con el resto de los
 * cortes táctiles del proyecto (`TabBarAction`, `ModalShell`, `ConfirmModal`):
 * en la práctica dan lo mismo, y una sola redacción es una sola cosa que
 * mantener.
 *
 * ── Se resuelve UNA vez, a propósito ──────────────────────────────────────
 * No es reactivo. Si alguien enchufa un mouse a una tablet a mitad de sesión,
 * el tema NO salta: cambiar de tema solo es una decisión del usuario, nunca un
 * efecto de haber tocado el hardware. Mismo criterio que `resolveInitialTheme`
 * con `prefers-color-scheme`, que también se resuelve una sola vez.
 *
 * ── Salvedad conocida ─────────────────────────────────────────────────────
 * Son DOS baldes, no tres: una tablet táctil comparte preferencia con el
 * teléfono. Es deliberado — separar tablet de teléfono agrega un tercer estado
 * para un caso que hoy no existe (el kiosco corre en iPad pero sin sesión, así
 * que su tema nunca sale de este navegador).
 *
 * ⚠️ OJO: esto está ESPEJADO en el script inline de `index.html`, que estampa
 * `data-theme` antes del primer pintado. Si cambia la consulta o las claves,
 * hay que cambiarlo en los dos lados — si divergen, el teléfono carga con el
 * tema del escritorio y se ve el salto al montar React.
 */

export const CONSULTA_MOVIL = '(hover: none)';

export const ES_MOVIL = (() => {
    try {
        return !!window.matchMedia?.(CONSULTA_MOVIL).matches;
    } catch {
        return false;   // sin matchMedia se asume escritorio, que es el default histórico
    }
})();

/** La clave de localStorage de ESTE aparato. */
export const CLAVE_TEMA = ES_MOVIL ? 'portal-theme-movil' : 'portal-theme';

/** La columna de `user_dashboard_prefs` que le corresponde a ESTE aparato. */
export const COLUMNA_TEMA = ES_MOVIL ? 'mobile_theme' : 'theme';
