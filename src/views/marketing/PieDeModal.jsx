import React from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import useMediaQuery from '../../plataforma/useMediaQuery';

/**
 * El pie de un modal con MÁS de dos acciones. `LiquidModal.Footer` en
 * escritorio es `justify-between` sin separación: está hecho para dos hijos
 * (uno a cada lado). Con tres sueltos —«Quitar» con `mr-auto` y dos a la
 * derecha— los de la derecha quedaban pegados (reportado con captura,
 * 2026-10-01). Acá la acción secundaria va sola a la izquierda y el resto en
 * un grupo con su separación.
 *
 * En táctil el pie canónico apila al revés (la principal arriba); el grupo
 * hace lo mismo por dentro para no romper esa jerarquía.
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
