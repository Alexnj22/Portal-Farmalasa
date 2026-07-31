import { useCallback, useRef } from 'react';
import { insetEn, CURVA, descriptorGota, tiemposGota } from './gotaApertura';

/**
 * El asa ARRASTRA: la hoja sigue al dedo y decide al soltar.
 *
 * Sin esto el asa dice "esto se cierra hacia abajo" y después no cumple — una
 * afordancia que miente es peor que ninguna, porque enseña a no confiar en las
 * demás. Con el gesto, cerrar deja de ser "encontrar el botón" y pasa a ser lo
 * que la mano ya iba a hacer.
 *
 * ── El dedo maneja LA ANIMACIÓN DE ENTRADA, hacia atrás ───────────────────
 * Y no un desplazamiento aparte. La primera versión arrastraba siempre con
 * `transform: translateY`, incluso donde la entrada era la gota: al soltar se
 * peleaban dos animaciones sobre el mismo elemento —el `transform` volviendo a
 * cero y el `clip-path` cerrando— y lo que se veía era el deslizamiento, no la
 * gota: *"en vez de cerrarse en forma de gota, se desliza el asa con la card
 * para abajo"*.
 *
 * Ahora el desplazamiento del dedo alimenta **la técnica con la que esa hoja
 * entró**, que `useGotaApertura` deja anotada en `__gota`:
 *
 * · `gota` (temas con vidrio) → un avance de 0 a 1 sobre el recorte de entrada.
 * · `deslizar` (temas sólidos) → los píxeles del dedo, tal cual, sobre el mismo
 *   `translate` que usó la entrada.
 *
 * En los dos casos arrastrar ES previsualizar el cierre, soltar solo decide si
 * el avance sigue o vuelve, y nunca hay dos cosas animándose a la vez. Que la
 * forma cambie por tema es correcto; que el asa cierre no depende del tema.
 *
 * El descriptor lo cuelga `useGotaApertura` del elemento que animó —que no
 * siempre es esta hoja: deslizando es el envoltorio, porque tiene que llevarse
 * la sombra—, así que se lo busca hacia arriba con `descriptorGota`. Pasarlo
 * por contexto obligaría a cada hoja a reenviarlo, y una prop de reenvío es una
 * prop que se olvida.
 *
 * ── Durante el arrastre no hay transición ─────────────────────────────────
 * El seguimiento tiene que ser cuadro a cuadro: una transición acá se lee como
 * lag, y en un gesto directo el lag es lo único que hace que se sienta barato.
 * La transición vuelve al soltar, que es cuando sí hay una animación que contar.
 *
 * ── Solo hacia abajo ──────────────────────────────────────────────────────
 * Tirar hacia arriba no tiene a dónde ir: la hoja ya está abierta del todo, y el
 * avance se topa en 0. Antes se permitía un rebote elástico, pero eso era un
 * `transform` sobre una hoja de vidrio, o sea el bug de siempre.
 *
 * ── Al soltar para cerrar, sigue la MISMA animación ───────────────────────
 * Nunca una tercera. Se deja el avance donde lo dejó el dedo y `useGotaApertura`
 * continúa desde ahí: la gota vuelve al control que la abrió, el deslizamiento
 * termina de bajar. Tener una animación para abrir y otra distinta para cerrar
 * hace que el cierre se lea como de otra pieza.
 *
 * ── El umbral es distancia O velocidad ────────────────────────────────────
 * Solo por distancia, un tirón corto y rápido —que es cómo la gente cierra de
 * verdad— no alcanzaría y la hoja volvería sola, que se lee como que el gesto
 * falló. Cierra si pasó de 1/4 del alto **o** si iba a más de 0.5 px/ms.
 */

const UMBRAL_FRACCION = 0.25;
const UMBRAL_VELOCIDAD = 0.5;   // px por ms

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
        // El descriptor lo escribió quien animó, y trae consigo el elemento que
        // hay que mover. Antes se recalculaba acá con una copia de la función de
        // `gotaApertura`, las copias divergieron, y el resultado fue que en los
        // temas sólidos el dedo buscaba el descriptor en un elemento donde nadie
        // lo había colgado: el asa no hacía absolutamente nada.
        const gota = descriptorGota(panel);
        const el = gota?.el;
        if (!el) return;

        const alto = el.getBoundingClientRect().height;
        const sombra = gota.sombra || null;
        est.current = { y0: e.clientY, tPrev: performance.now(), yPrev: e.clientY, v: 0, alto, el, sombra,
            tecnica: gota.tecnica, lados: gota.lados, t: 0,
            rSombra: sombra ? sombra.getBoundingClientRect() : { width: 1, height: 1 } };
        el.style.transition = 'none';
        if (sombra) sombra.style.transition = 'none';
        e.currentTarget.setPointerCapture?.(e.pointerId);

        const alMover = (ev) => {
            const s = est.current; if (!s) return;
            const ahora = performance.now();
            const dt = ahora - s.tPrev;
            if (dt > 0) s.v = (ev.clientY - s.yPrev) / dt;
            s.yPrev = ev.clientY; s.tPrev = ahora;

            const d = Math.max(0, ev.clientY - s.y0);

            // ── Deslizando: los píxeles del dedo, sin traducir ────────────
            // Nada de opacidad ni de radio acompañando: en el tema pensado para
            // equipos de pocos recursos, el gesto es UNA propiedad compuesta y
            // el compositor no repinta un solo píxel mientras dura.
            if (s.tecnica === 'deslizar') {
                s.el.style.transform = `translate3d(0, ${d}px, 0)`;
                return;
            }

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
            // Vuelve a abrirse del todo con el mismo tiempo que la apertura —que
            // es lo que esto es: abrir de nuevo—. Sale del tema, así que en Solid
            // vuelve rápido igual que abre rápido.
            const VUELTA = tiemposGota().entrada;

            if (s.tecnica === 'deslizar') {
                s.el.style.transition = `transform ${VUELTA}ms ${CURVA}`;
                s.el.style.transform = 'translate3d(0, 0, 0)';
                const soltar = (ev) => {
                    // Por objetivo además de por propiedad: `transitionend`
                    // burbujea y cualquier botón del contenido transiciona
                    // `transform`.
                    if (ev && (ev.target !== s.el || ev.propertyName !== 'transform')) return;
                    // El `transform` se RETIRA, no se deja en identidad: mientras
                    // esté puesto, el panel es el bloque contenedor de todo
                    // `position: fixed` que tenga adentro —y adentro hay
                    // `LiquidSelect`, que se posiciona así—.
                    s.el.style.transform = ''; s.el.style.transition = '';
                    s.el.removeEventListener('transitionend', soltar);
                };
                s.el.addEventListener('transitionend', soltar);
                return;
            }

            s.el.style.transition = `clip-path ${VUELTA}ms ${CURVA}`;
            s.el.style.clipPath = insetEn(s.el, s.lados, 0);
            if (s.sombra) {
                s.sombra.style.transition = `transform ${VUELTA}ms ${CURVA}, opacity ${VUELTA}ms ease-out`;
                s.sombra.style.transform = 'translate(0px, 0px) scale(1, 1)';
                s.sombra.style.borderRadius = '';
                s.sombra.style.opacity = '1';
            }
            const limpiar = (ev) => {
                if (ev && (ev.target !== s.el || ev.propertyName !== 'clip-path')) return;
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
