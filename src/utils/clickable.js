// `clickable(fn)` — el contrato de teclado para un elemento que NO es un
// `<button>` pero se comporta como uno.
//
// Existe porque la auditoría del 2026-07-28 encontró **35 controles reales**
// —tarjetas, filas, celdas de calendario, chips de filtro— con `onClick` sobre
// un `<div>`/`<td>`/`<tr>` y nada más: sin `tabIndex`, sin `onKeyDown`, y sin
// ningún control enfocable adentro por el que llegar. Con mouse funcionan; con
// teclado no existen.
//
// Es la misma familia del bug de `LiquidSelect` (v2.157.0) y del botón de
// borrar fecha de `LiquidDatePicker` (v2.178.0): **poner `onClick` —o peor,
// `role="button"`— promete un contrato que el navegador solo cumple gratis con
// el elemento nativo.** Cuando el elemento es un `<div>`, hay que escribirlo.
//
//     <div {...clickable(() => abrir(id))} className="…">
//
// Es una función normal, no un hook, a propósito: la mayoría de estos sitios
// están dentro de un `.map()`, donde un hook no se puede llamar.
//
// **Cuándo NO usarlo:** si el elemento ya contiene un `<button>` o un `<a>`, el
// teclado llega por ahí y agregar otro punto de tabulación estorba en vez de
// ayudar. Y si podés usar un `<button>` de verdad, usalo — esto es para cuando
// no se puede (una fila de tabla, una celda, una tarjeta que envuelve otros
// controles).
// **Devuelve `onClick` además del contrato de teclado, y eso NO es un detalle.**
// La primera versión solo devolvía `role`/`tabIndex`/`onKeyDown`, y el migrador
// que la aplicó reemplazó el `onClick={fn}` de cada sitio por el spread: los 34
// controles quedaron alcanzables con teclado y MUERTOS con mouse. No lo detectó
// el build, ni el lint, ni el gate — solo un clic real en la vista (min/max:
// tocar la caja MIN abría el acordeón de la fila en vez del editor).
// La lección: un helper que RECIBE el handler tiene que cablear los dos caminos,
// porque quien lo aplica va a asumir que reemplaza al `onClick`.
export function clickable(onClick, { disabled = false, label } = {}) {
    if (!onClick || disabled) return {};
    return {
        role: 'button',
        tabIndex: 0,
        onClick,
        ...(label ? { 'aria-label': label } : {}),
        onKeyDown: (e) => {
            // Sin esta guardia, el Enter de un control interno burbujea hasta
            // acá y dispara la acción del contenedor además de la suya. Mismo
            // patrón que en `DataRow` y en el disparador de `LiquidSelect`.
            if (e.target !== e.currentTarget) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            onClick(e);
        },
    };
}
