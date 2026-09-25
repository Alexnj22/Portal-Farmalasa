import { useEffect, useRef, useState } from 'react';

/**
 * useAnclaje — un panel flotante medido contra el botón que lo abre.
 *
 * Devuelve la ref que va en el disparador y la caja `{top, right}` con la que
 * posicionar el panel. Va SIEMPRE por portal al `body`: dentro de la píldora de
 * filtros —que tiene su propio `overflow` y alto fijo de 52px— un panel queda
 * recortado.
 *
 * Cierra con Escape, con un clic afuera, y se reposiciona si la ventana cambia
 * de tamaño o la página scrollea (`capture: true`, porque el scroll que importa
 * suele ser el de un contenedor interno y ese no burbujea).
 *
 * Salió de `FilterBar.PanelDesborde` el 2026-08-05, al aparecer el segundo y el
 * tercer panel de la misma píldora («otros» y los borradores de MIN·MAX).
 * Copiarlo hubiera dado tres popovers hermanos que se cierran con gestos
 * distintos, que es como se ve un control cuando en realidad son tres.
 *
 * `cerrar` tiene que ser estable (`useCallback`) — es dependencia del efecto.
 * El panel debe llevar `data-panel={id}` con el mismo `id` que se pasa acá:
 * es lo que distingue "un clic adentro del panel" de "un clic afuera", y sin
 * eso el panel se cierra al tocar cualquier cosa que tenga adentro.
 */
export default function useAnclaje(abierto, cerrar, id) {
    const btnRef = useRef(null);
    const [caja, setCaja] = useState(null);

    useEffect(() => {
        if (!abierto) return undefined;
        const medir = () => {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setCaja({ top: r.bottom + 8, right: window.innerWidth - r.right });
        };
        medir();
        const alTeclear = e => { if (e.key === 'Escape') cerrar(); };
        const alClic = e => {
            if (!btnRef.current?.contains(e.target) && !e.target.closest?.(`[data-panel="${id}"]`)) cerrar();
        };
        window.addEventListener('keydown', alTeclear);
        window.addEventListener('resize', medir);
        window.addEventListener('scroll', medir, true);
        document.addEventListener('mousedown', alClic);
        return () => {
            window.removeEventListener('keydown', alTeclear);
            window.removeEventListener('resize', medir);
            window.removeEventListener('scroll', medir, true);
            document.removeEventListener('mousedown', alClic);
        };
    }, [abierto, cerrar, id]);

    return { btnRef, caja };
}
