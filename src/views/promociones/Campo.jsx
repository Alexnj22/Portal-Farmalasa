import React from 'react';

/**
 * El rótulo de los controles que no traen el suyo (`LiquidSelect`, el de fecha).
 *
 * ── Por qué vive acá y no copiado en cada pantalla ────────────────────────
 * Estuvo escrito **siete veces** dentro del módulo, y el 2026-09-05 eso costó
 * dos defectos el mismo día:
 *
 * 1. El de la forma: `LiquidDatePicker` termina en `basis-[140px]` —su ANCHO
 *    cuando vive en una fila— y las siete copias lo envolvían en un
 *    `flex flex-col`, donde `flex-basis` manda sobre el eje **vertical**. El
 *    control declara `h-[max(40px,var(--tap-min))]` y computaba **140px de
 *    alto**. Hubo que corregir las siete a mano.
 * 2. El de la corrección: al pegar el comentario que explica (1) en las siete,
 *    en **dos** quedó fuera de las llaves de JSX — y ahí `/* … *\/` no es un
 *    comentario, es TEXTO. Liquidación y la matriz de laboratorio salieron a
 *    producción con un párrafo de código pintado arriba de la pantalla.
 *
 * O sea: la copia no falló por ser copia, falló porque **arreglar siete cosas
 * a mano tiene siete oportunidades de equivocarse**. Escrito una vez, el
 * arreglo llega solo.
 *
 * `space-y-1` en BLOQUE y no `flex flex-col` es justo lo de (1): en un
 * contenedor `block`, `flex-basis` no aplica.
 *
 * `items-end` en la fila que lo contiene NO alcanza para alinear: el rótulo
 * ocupa alto propio, así que una fila sin él deja las columnas arrancando a
 * alturas distintas.
 *
 * @param rotulo  El texto de arriba.
 * @param falta   Marca el asterisco de requerido.
 */
export default function Campo({ rotulo, falta = false, children }) {
    return (
        <div className="space-y-1 min-w-0">
            <span className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                {rotulo}
                {falta && <span className="text-danger" aria-label="requerido">*</span>}
            </span>
            {children}
        </div>
    );
}
