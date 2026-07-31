import { useCallback, useRef } from 'react';

/**
 * El asa ARRASTRA: la hoja sigue al dedo y decide al soltar.
 *
 * Sin esto el asa dice "esto se cierra hacia abajo" y después no cumple — una
 * afordancia que miente es peor que ninguna, porque enseña a no confiar en las
 * demás. Con el gesto, cerrar deja de ser "encontrar el botón" y pasa a ser lo
 * que la mano ya iba a hacer.
 *
 * ── Se mueve el elemento del VIDRIO, nunca su envoltorio ──────────────────
 * Es la misma regla que ya mordió siete veces: `transform` en un ANCESTRO crea
 * un backdrop root y el `backdrop-filter` del hijo deja de pintar. Arrastrando el
 * envoltorio, la hoja perdería el vidrio justo mientras el dedo la mueve — el
 * momento en que más se mira. Se arrastra el mismo elemento que lleva el
 * material, cuyo `transform` PROPIO no rompe nada.
 *
 * ── Durante el arrastre no hay transición ─────────────────────────────────
 * El seguimiento tiene que ser cuadro a cuadro: una transición acá se lee como
 * lag, y en un gesto directo el lag es lo único que hace que se sienta barato.
 * La transición vuelve al soltar, que es cuando sí hay una animación que contar.
 *
 * ── Solo hacia abajo, y con resistencia arriba ────────────────────────────
 * Tirar hacia arriba no tiene a dónde ir: la hoja ya está tope. Se permite un
 * poco con resistencia (la raíz del desplazamiento) porque un tope duro se
 * siente roto; es el mismo gesto elástico que hace iOS al final de una lista.
 *
 * ── El umbral es distancia O velocidad ────────────────────────────────────
 * Solo por distancia, un tirón corto y rápido —que es cómo la gente cierra de
 * verdad— no alcanzaría y la hoja volvería sola, que se lee como que el gesto
 * falló. Cierra si pasó de 1/4 del alto **o** si iba a más de 0.5 px/ms.
 */

const UMBRAL_FRACCION = 0.25;
const UMBRAL_VELOCIDAD = 0.5;   // px por ms
const RESISTENCIA_ARRIBA = 0.35;

function objetivoVidrio(el) {
    if (!el) return null;
    if (getComputedStyle(el).backdropFilter !== 'none') return el;
    const h = el.firstElementChild;
    return (h && getComputedStyle(h).backdropFilter !== 'none') ? h : el;
}

/**
 * @param {object} o
 *   refPanel  – el envoltorio de la hoja (se resuelve solo cuál lleva el vidrio)
 *   alCerrar  – se llama cuando el gesto decide cerrar
 *   activo    – false lo apaga (reduced-motion, o no es una hoja)
 * @returns props para el asa: `{ onPointerDown }`
 */
export function useArrastreHoja({ refPanel, alCerrar, activo = true }) {
    const est = useRef(null);

    const alBajar = useCallback((e) => {
        if (!activo || e.button > 0) return;
        const panel = refPanel.current;
        const el = objetivoVidrio(panel);
        if (!el) return;

        const alto = el.getBoundingClientRect().height;
        est.current = { y0: e.clientY, t0: performance.now(), yPrev: e.clientY, tPrev: performance.now(), v: 0, alto, el };
        el.style.transition = 'none';
        e.currentTarget.setPointerCapture?.(e.pointerId);

        const alMover = (ev) => {
            const s = est.current; if (!s) return;
            const ahora = performance.now();
            const dt = ahora - s.tPrev;
            if (dt > 0) s.v = (ev.clientY - s.yPrev) / dt;
            s.yPrev = ev.clientY; s.tPrev = ahora;

            const d = ev.clientY - s.y0;
            const y = d >= 0 ? d : -((-d) ** RESISTENCIA_ARRIBA) * 3;
            s.el.style.transform = `translateY(${y}px)`;
        };

        const alSoltar = () => {
            const s = est.current; if (!s) return;
            est.current = null;
            window.removeEventListener('pointermove', alMover);
            window.removeEventListener('pointerup', alSoltar);
            window.removeEventListener('pointercancel', alSoltar);

            const d = s.yPrev - s.y0;
            const cierra = d > s.alto * UMBRAL_FRACCION || s.v > UMBRAL_VELOCIDAD;

            if (cierra) {
                // Termina el recorrido que el dedo empezó: sale por abajo y recién
                // ahí se avisa. Cerrar en el momento del `up` cortaba el gesto a
                // mitad de camino, que es justo lo que se siente barato.
                s.el.style.transition = 'transform 200ms cubic-bezier(0.4,0,1,1)';
                s.el.style.transform = `translateY(${s.alto}px)`;
                setTimeout(() => {
                    s.el.style.transition = ''; s.el.style.transform = '';
                    alCerrar?.();
                }, 190);
                return;
            }
            // Vuelve a su sitio. Un poco más lenta y con más rebote que la salida:
            // volver es la confirmación de que NO pasó nada, y ahí la suavidad es
            // el mensaje.
            s.el.style.transition = 'transform 320ms cubic-bezier(0.22,1,0.36,1)';
            s.el.style.transform = '';
            const limpiar = () => { s.el.style.transition = ''; };
            s.el.addEventListener('transitionend', limpiar, { once: true });
        };

        window.addEventListener('pointermove', alMover);
        window.addEventListener('pointerup', alSoltar);
        window.addEventListener('pointercancel', alSoltar);
    }, [refPanel, alCerrar, activo]);

    return activo ? { onPointerDown: alBajar } : {};
}
