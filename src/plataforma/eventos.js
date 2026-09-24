// ─────────────────────────────────────────────────────────────────────────────
// Avisos entre partes del portal — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// El store le avisa a pantallas que no conoce («se actualizó el historial»,
// «cambió un evento de este empleado») con un evento sobre `window`. En una
// app nativa no hay `window`: su gemelo `eventos.native.js` va a ser un
// emisor en memoria con la misma interfaz. Ver `almacen.js` para el porqué.
//
// Acá se sigue usando `window` y `CustomEvent`, y no un emisor propio, por una
// razón concreta: las pantallas que ESCUCHAN (`addEventListener` en vistas y
// componentes) no se tocan en esta fase. Si el emisor cambiara, el aviso
// dejaría de llegarles sin ningún error. Así, quien emite con `emitir` y quien
// escucha con `window.addEventListener` siguen hablando el mismo idioma.

/** `window.dispatchEvent(new CustomEvent(nombre, { detail }))`. */
export function emitir(nombre, detalle) {
    window.dispatchEvent(
        detalle === undefined ? new CustomEvent(nombre) : new CustomEvent(nombre, { detail: detalle }),
    );
}

/** Escucha un aviso; devuelve la función que deja de escucharlo. La función
 *  recibe el `detail`, no el evento: es lo único que la lógica necesita. */
export function escuchar(nombre, alRecibir) {
    const manejador = (e) => alRecibir(e?.detail);
    window.addEventListener(nombre, manejador);
    return () => window.removeEventListener(nombre, manejador);
}
