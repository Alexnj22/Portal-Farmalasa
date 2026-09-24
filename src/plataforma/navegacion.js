// ─────────────────────────────────────────────────────────────────────────────
// Ir a otra pantalla desde la lógica — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// Casi toda la navegación vive en las pantallas (React Router). Esto es para
// el caso raro en que la LÓGICA manda a otro lado —el clic en una
// notificación del sistema operativo, que no pasa por ningún componente—.
// En el navegador es cambiar la dirección entera; en la app nativa, su gemelo
// le pedirá la ruta al navegador de pantallas. Ver `almacen.js`.

/** `window.location.href = ruta` — carga la página completa, como hoy. */
export function irA(ruta) {
    window.location.href = ruta;
}
