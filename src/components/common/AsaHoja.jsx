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
 */
export default function AsaHoja({ className = '' }) {
    return (
        <div
            aria-hidden="true"
            className={`w-9 h-1 rounded-full bg-content-3/40 mx-auto shrink-0 ${className}`}
        />
    );
}
