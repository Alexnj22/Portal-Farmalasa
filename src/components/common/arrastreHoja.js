import { useCallback, useRef } from 'react';
import { insetEn, CURVA } from './gotaApertura';

/**
 * El asa ARRASTRA: la hoja sigue al dedo y decide al soltar.
 *
 * Sin esto el asa dice "esto se cierra hacia abajo" y después no cumple — una
 * afordancia que miente es peor que ninguna, porque enseña a no confiar en las
 * demás. Con el gesto, cerrar deja de ser "encontrar el botón" y pasa a ser lo
 * que la mano ya iba a hacer.
 *
 * ── El dedo maneja LA GOTA, no un desplazamiento ──────────────────────────
 * La primera versión arrastraba con `transform: translateY`. Funcionaba como
 * gesto, pero al soltar se peleaban dos animaciones sobre el mismo elemento —el
 * `transform` volviendo a cero y el `clip-path` cerrando— y lo que se veía era el
 * deslizamiento, no la gota: *"en vez de cerrarse en forma de gota, se desliza el
 * asa con la card para abajo"*.
 *
 * Ahora el dedo mueve **la misma animación de apertura, hacia atrás**. El
 * desplazamiento se convierte en un avance de 0 a 1 sobre el recorte que uso la
 * entrada, así que arrastrar ES previsualizar el cierre. Soltar solo decide si
 * ese avance sigue hasta 1 o vuelve a 0 — nunca hay dos cosas animándose, y no
 * queda ningún `transform` que pudiera romper el vidrio.
 *
 * Los lados de la entrada los deja `useGotaApertura` colgados del elemento
 * (`__gota`): pasarlos por contexto obligaría a cada hoja a reenviarlos, y una
 * prop de reenvío es una prop que se olvida.
 *
 * ── Durante el arrastre no hay transición ─────────────────────────────────
 * El seguimiento tiene que ser cuadro a cuadro: una transición acá se lee como
 * lag, y en un gesto directo el lag es lo único que hace que se sienta barato.
 * La transición vuelve al soltar, que es cuando sí hay una animación que contar.
 *
 * ── Solo hacia abajo ──────────────────────────────────────────────────────
 * Tirar hacia arriba no tiene a dónde ir: la hoja ya está abierta del todo, y el
 * avance se topa en 0. Antes se permitía un rebote elástico, pero eso era un
 * `transform`; con el recorte manejando el gesto, "más abierta que abierta" no
 * existe como forma.
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
        const gota = el.__gota;
        // Sin los lados de la entrada no hay gota que reproducir: se deja pasar
        // el gesto en vez de inventar una animación distinta.
        if (!gota?.lados) return;
        const sombra = gota.sombra || (panel.parentElement || panel).querySelector('[data-sombra-hoja]');
        est.current = { y0: e.clientY, tPrev: performance.now(), yPrev: e.clientY, v: 0, alto, el, sombra,
            lados: gota.lados, t: 0, rSombra: sombra ? sombra.getBoundingClientRect() : { width: 1, height: 1 } };
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
            // El recorrido útil es 60% del alto: con el 100%, cerrar exigía
            // arrastrar la hoja entera y el gesto se sentía pesado.
            const t = Math.max(0, Math.min(1, d / (s.alto * 0.6)));
            s.t = t;
            s.el.style.clipPath = insetEn(s.el, s.lados, t);
            if (s.sombra) {
                // `transform` y no los cuatro lados: son propiedades de layout y
                // repintar una sombra de 44px de difuminado en cada cuadro del
                // gesto es justo lo que hace que se sienta pesado.
                const l = s.lados, R = s.rSombra;
                const sx = Math.max(0.01, (R.width - (l.izq + l.derecha) * t) / R.width);
                const sy = Math.max(0.01, (R.height - (l.arriba + l.abajo) * t) / R.height);
                s.sombra.style.transformOrigin = '0 0';
                s.sombra.style.borderRadius = t > 0.02 ? '50%' : '';
                s.sombra.style.transform = `translate(${l.izq * t}px, ${l.arriba * t}px) scale(${sx}, ${sy})`;
                s.sombra.style.opacity = String(1 - t);
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
                // El avance que ya hizo el dedo se conserva: `alCerrar` dispara la
                // salida de `useGotaApertura`, que sigue desde donde quedó hasta
                // el control. No se toca el recorte acá o habría un salto.
                alCerrar?.();
                return;
            }
            // Vuelve a abrirse del todo. Un poco más lenta que el cierre: volver
            // es la confirmación de que NO pasó nada, y ahí la suavidad es el
            // mensaje.
            const VUELTA = 340;
            s.el.style.transition = `clip-path ${VUELTA}ms ${CURVA}`;
            s.el.style.clipPath = insetEn(s.el, s.lados, 0);
            if (s.sombra) {
                s.sombra.style.transition = `transform ${VUELTA}ms ${CURVA}, opacity ${VUELTA}ms ease-out`;
                s.sombra.style.transform = 'translate(0px, 0px) scale(1, 1)';
                s.sombra.style.borderRadius = '';
                s.sombra.style.opacity = '1';
            }
            const limpiar = (ev) => {
                if (ev && ev.propertyName !== 'clip-path') return;
                s.el.style.transition = ''; s.el.style.clipPath = '';
                if (s.sombra) s.sombra.style.transition = '';
                s.el.removeEventListener('transitionend', limpiar);
            };
            s.el.addEventListener('transitionend', limpiar);
        };

        window.addEventListener('pointermove', alMover);
        window.addEventListener('pointerup', alSoltar);
        window.addEventListener('pointercancel', alSoltar);
    }, [refPanel, alCerrar, activo]);

    return activo ? { onPointerDown: alBajar } : {};
}
