import React from 'react';
import LiquidModal from './LiquidModal';
import useMediaQuery from '../../plataforma/useMediaQuery';

/**
 * El pie de un `LiquidModal` con MÁS de dos acciones, o con un texto a la
 * izquierda y dos botones a la derecha.
 *
 * `LiquidModal.Footer` en escritorio es `justify-between` SIN separación: está
 * hecho para dos hijos, uno a cada lado. Con tres sueltos —un texto o un
 * «Quitar» con `mr-auto` y dos botones— los de la derecha quedaban pegados,
 * sin un píxel entre ellos (reportado con captura el 2026-10-01, en Marketing;
 * el mismo patrón estaba en Promociones). Acá lo de la izquierda va solo y el
 * resto en un grupo con `gap-2`.
 *
 * En táctil el pie canónico apila al revés (la principal arriba, a ancho
 * completo); el grupo hace lo mismo por dentro para no romper esa jerarquía.
 * Distribución resuelve lo mismo con un contenedor propio adentro del pie: las
 * dos formas dan el mismo resultado; ésta no hay que reescribirla en cada uso.
 */
export default function PieDeModal({ izquierda = null, children }) {
    const enTactil = useMediaQuery('(hover: none)');
    return (
        <LiquidModal.Footer>
            {izquierda || <span aria-hidden />}
            <div className={enTactil ? 'flex flex-col-reverse gap-2' : 'flex items-center gap-2'}>
                {children}
            </div>
        </LiquidModal.Footer>
    );
}
