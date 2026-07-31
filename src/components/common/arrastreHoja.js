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
 * ── Al soltar para cerrar, cierra con LA GOTA ─────────────────────────────
 * No deslizando hacia abajo. Deslizar es otra animación que la de entrada, y
 * tener dos gramáticas para el mismo objeto —una para abrir, otra para cerrar—
 * hace que el cierre se lea como de otra pieza. Se suelta el `transform` con una
 * transición corta y `useGotaApertura` hace el recorrido inverso: el mismo camino
 * que la hoja hizo al abrirse, de vuelta al control que la abrió.
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
    // Entre TODOS los hijos: el panel lleva además la capa de sombra, y mirar
    // solo el primero asume un orden que nadie prometió.
    for (const h of el.children) {
        if (getComputedStyle(h).backdropFilter !== 'none') return h;
    }
    return el;
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
        // La sombra viaja CON la hoja. Clavada en su sitio dejaba una banda en el
        // lugar viejo mientras el dedo bajaba la hoja: un corte a la vista.
        //
        // Se busca en el PADRE y no dentro: la capa es HERMANA de la hoja —vive
        // en el panel de `ModalShell`—, así que `panel.querySelector` no la
        // encontraba nunca y la sombra se quedaba quieta. `refPanel` acá recibe
        // la hoja, no el panel; el nombre venía de antes de que la sombra
        // existiera.
        const sombra = (panel.parentElement || panel).querySelector('[data-sombra-hoja]');
        est.current = { y0: e.clientY, t0: performance.now(), yPrev: e.clientY, tPrev: performance.now(), v: 0, alto, el, sombra, panel };
        el.style.transition = 'none';
        if (sombra) sombra.style.transition = 'none';
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
            if (s.sombra) {
                s.sombra.style.transform = `translateY(${y}px)`;
                // Y se va apagando: a medida que la hoja baja, lo que separa deja
                // de haber. Mantenerla al 100% con la hoja a medio camino se lee
                // como una sombra flotando sola.
                s.sombra.style.opacity = String(Math.max(0, 1 - Math.max(0, y) / s.alto));
            }
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
                // Cierra con LA GOTA, no deslizando. Deslizar hacia abajo es otra
                // animación que la de entrada, y tener dos gramáticas para el
                // mismo objeto —una para abrir, otra para cerrar— hace que el
                // cierre se sienta de otra pieza. Se suelta el `transform` y se
                // deja que `useGotaApertura` haga el recorrido inverso, que es
                // exactamente el mismo camino que hizo al abrirse.
                //
                // El `transform` se retira con transición para que el salto del
                // sitio arrastrado al sitio de reposo no se vea: los dos
                // movimientos se solapan y se leen como uno.
                s.el.style.transition = 'transform 160ms cubic-bezier(0.22,1,0.36,1)';
                s.el.style.transform = '';
                if (s.sombra) { s.sombra.style.transition = 'none'; s.sombra.style.transform = ''; }
                alCerrar?.();
                setTimeout(() => { s.el.style.transition = ''; }, 200);
                return;
            }
            // Vuelve a su sitio. Un poco más lenta y con más rebote que la salida:
            // volver es la confirmación de que NO pasó nada, y ahí la suavidad es
            // el mensaje.
            s.el.style.transition = 'transform 320ms cubic-bezier(0.22,1,0.36,1)';
            s.el.style.transform = '';
            if (s.sombra) {
                s.sombra.style.transition = 'transform 320ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease-out';
                s.sombra.style.transform = ''; s.sombra.style.opacity = '';
            }
            const limpiar = () => {
                s.el.style.transition = '';
                if (s.sombra) s.sombra.style.transition = '';
            };
            s.el.addEventListener('transitionend', limpiar, { once: true });
        };

        window.addEventListener('pointermove', alMover);
        window.addEventListener('pointerup', alSoltar);
        window.addEventListener('pointercancel', alSoltar);
    }, [refPanel, alCerrar, activo]);

    return activo ? { onPointerDown: alBajar } : {};
}
