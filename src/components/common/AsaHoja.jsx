import React from 'react';

/**
 * AsaHoja — el tirador de una hoja. Canónico, para TODO lo que entre desde abajo.
 *
 * Era un `<div className="w-9 h-1 rounded-full bg-content-3/40 mx-auto">` repetido
 * en cada sitio que dibujaba una hoja: `HojaMovil`, la de `BarraFlotante` antes de
 * migrar, y las dos que no lo tenían y por eso se veían incompletas
 * (`SelectorTactil`, `LiquidDatePicker`).
 *
 * No es decoración: es **la única señal de que eso se cierra hacia abajo.** En una
 * hoja sin asa, la salida es el fondo —que no se ve— o `Escape`, que en un
 * teléfono no existe. Por eso va acá y no como opción de cada hoja: un elemento
 * que entra desde abajo tiene que decir cómo se sale, y eso no puede depender de
 * que su autor se acuerde.
 *
 * `aria-hidden`: para un lector de pantalla el diálogo ya se anuncia como tal y
 * tiene su botón de cierre; el asa es una afordancia de pulgar y anunciarla
 * sería una parada de foco que no lleva a ninguna parte.
 *
 * ── Y ARRASTRA ────────────────────────────────────────────────────────────
 * Con las props de `useArrastreHoja`, la hoja sigue al dedo y decide al soltar.
 * Un asa que dice "esto se cierra hacia abajo" y después no cumple es peor que
 * ninguna: enseña a no confiar en las demás afordancias.
 *
 * El área agarrable es más grande que el dibujo — 4px de alto no se toman con el
 * pulgar—: `py-2 -my-2` da 20px de zona sin mover el layout, la misma técnica que
 * `CarrilCards` usa para su sombra. Y `touch-none` porque sin él el navegador se
 * queda el gesto vertical para hacer scroll y el arrastre nunca llega.
 */
/**
 * `vertical`: la hoja entra de COSTADO (teléfono acostado), así que el asa se
 * para y se corre al borde izquierdo. Es el mismo elemento con los dos ejes
 * cambiados — el dibujo pasa de 36×4 a 4×36 y la zona agarrable de `py-2 -my-2`
 * a `px-2 -mx-2`. No es un componente nuevo: un asa que dijera "se cierra hacia
 * abajo" en un panel que se cierra hacia la derecha sería la misma afordancia
 * mentirosa que este archivo existe para evitar.
 */
export default function AsaHoja({ className = '', vertical = false, ...gesto }) {
    const agarrable = !!gesto.onPointerDown;
    return (
        // El área táctil es MÁS GRANDE que el dibujo: 4px no se agarran con el
        // pulgar. El `py-2 -my-2` le da 20px de zona sin cambiar el layout,
        // que es la misma técnica que el carril usa para su sombra.
        <div
            aria-hidden="true"
            {...gesto}
            className={`shrink-0 ${vertical ? 'my-auto' : 'mx-auto'} ${agarrable
                ? `cursor-grab active:cursor-grabbing touch-none ${vertical
                    ? 'px-2 -mx-2 py-6 h-max' : 'py-2 -my-2 px-6 w-max'}`
                : vertical ? 'h-9' : 'w-9'} ${className}`}
        >
            <div className={`rounded-full bg-content-3/40 ${vertical
                ? `w-1 ${agarrable ? 'h-9' : 'h-full'}`
                : `h-1 ${agarrable ? 'w-9' : 'w-full'}`}`} />
        </div>
    );
}
