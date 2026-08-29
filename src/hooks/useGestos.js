/**
 * Arrastrar, pellizcar y girar con los dedos — un solo juego de gestos.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El editor de documentos se sentía «torpe» en el teléfono (usuario,
 * 2026-08-29): no se podía pellizcar para acercar ni girar con dos dedos. Un
 * teléfono sin pellizco no se siente lento, se siente ROTO — es el gesto que
 * todo el mundo prueba primero, y cuando no pasa nada la conclusión no es «esto
 * no lo soporta», es «la pantalla se colgó».
 *
 * ── Un solo tipo de evento, y por eso funciona igual con el ratón ───────────
 *
 * `pointer*` unifica dedo, ratón y lápiz. Con `touch*` habría que escribir dos
 * caminos y mantenerlos iguales, que es como divergen. Y `setPointerCapture`
 * es lo que hace que el gesto siga al dedo aunque se salga del elemento: sin
 * eso, un arrastre rápido se suelta solo a mitad de camino.
 *
 * ── Lo que este hook NO decide ──────────────────────────────────────────────
 *
 * No sabe qué se está moviendo. Devuelve el CAMBIO —cuánto se movió, cuánto se
 * agrandó, cuánto giró y alrededor de qué punto— y quien lo usa decide qué
 * hacer con eso. Así el mismo hook sirve para mover una foto, una capa o un
 * mapa, y la matemática del pellizco se escribe una sola vez.
 *
 * ── `touch-action: none` es obligatorio en el elemento ─────────────────────
 *
 * Sin él, el navegador se queda con el gesto para desplazar la página y los
 * eventos de movimiento dejan de llegar a mitad del arrastre. No se pone acá
 * porque es una decisión de estilo del contenedor, pero sin eso este hook
 * parece roto en un teléfono y funciona perfecto en el escritorio — que es la
 * peor combinación posible para darse cuenta.
 */
import { useEffect, useRef } from 'react';

const distancia = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angulo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
const medio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * @param {React.RefObject} ref        el elemento que recibe los gestos
 * @param {object} manejadores
 * @param {(g:{dx:number,dy:number,escala:number,giro:number,centro:{x:number,y:number},dedos:number})=>void}
 *        manejadores.alMover  el cambio DESDE EL CUADRO ANTERIOR (no acumulado)
 * @param {()=>void}   [manejadores.alEmpezar]
 * @param {()=>void}   [manejadores.alTerminar]
 * @param {boolean}    [manejadores.activo]  apagar sin desmontar (por ejemplo,
 *        mientras se arrastra una esquina, que tiene su propio gesto)
 */
export default function useGestos(ref, { alMover, alEmpezar, alTerminar, activo = true }) {
    // En refs y no en estado: un gesto emite decenas de eventos por segundo y
    // cada `setState` sería un render que llega tarde para el siguiente evento.
    const punteros = useRef(new Map());
    const previo = useRef(null);
    const cb = useRef({ alMover, alEmpezar, alTerminar });
    cb.current = { alMover, alEmpezar, alTerminar };

    useEffect(() => {
        const el = ref.current;
        if (!el || !activo) return undefined;

        const puntos = () => [...punteros.current.values()];

        const abajo = (e) => {
            el.setPointerCapture?.(e.pointerId);
            punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            previo.current = null;                 // el gesto se re-mide al cambiar de dedos
            if (punteros.current.size === 1) cb.current.alEmpezar?.();
        };

        const mover = (e) => {
            if (!punteros.current.has(e.pointerId)) return;
            punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = puntos();

            /* Un dedo: sólo se arrastra. Dos: se arrastra, se acerca y se gira a
             * la vez — que es como se siente natural, no un modo por gesto. Con
             * tres o más se toman los dos primeros: soltar el gesto porque
             * apoyaste la palma es peor que seguir con dos. */
            const ahora = p.length >= 2
                ? { centro: medio(p[0], p[1]), dist: distancia(p[0], p[1]), ang: angulo(p[0], p[1]) }
                : { centro: p[0], dist: null, ang: null };

            const antes = previo.current;
            previo.current = ahora;
            if (!antes) return;                    // el primer cuadro sólo fija el origen

            /* El giro se acota a ±90° por cuadro: cuando el ángulo cruza el
             * corte de -180/180 el salto es de casi 360, y sin este freno la
             * imagen pega un tirón completo en un solo cuadro. */
            let giro = 0;
            if (ahora.ang != null && antes.ang != null) {
                giro = ahora.ang - antes.ang;
                if (giro > 180) giro -= 360;
                if (giro < -180) giro += 360;
            }

            cb.current.alMover?.({
                dx: ahora.centro.x - antes.centro.x,
                dy: ahora.centro.y - antes.centro.y,
                escala: (ahora.dist && antes.dist) ? ahora.dist / antes.dist : 1,
                giro,
                centro: ahora.centro,
                dedos: p.length,
            });
        };

        const arriba = (e) => {
            punteros.current.delete(e.pointerId);
            previo.current = null;
            if (punteros.current.size === 0) cb.current.alTerminar?.();
        };

        el.addEventListener('pointerdown', abajo);
        el.addEventListener('pointermove', mover);
        el.addEventListener('pointerup', arriba);
        el.addEventListener('pointercancel', arriba);
        el.addEventListener('pointerleave', arriba);
        return () => {
            el.removeEventListener('pointerdown', abajo);
            el.removeEventListener('pointermove', mover);
            el.removeEventListener('pointerup', arriba);
            el.removeEventListener('pointercancel', arriba);
            el.removeEventListener('pointerleave', arriba);
            punteros.current.clear();
            previo.current = null;
        };
    }, [ref, activo]);
}

/**
 * La rueda del ratón como pellizco.
 *
 * En una computadora no hay dos dedos, y el gesto equivalente que todo el mundo
 * prueba es la rueda. Va aparte porque `wheel` necesita `passive: false` para
 * poder frenar el desplazamiento de la página, y mezclarlo con los punteros
 * escondería ese detalle.
 */
export function useRueda(ref, alAcercar, activo = true) {
    const cb = useRef(alAcercar);
    cb.current = alAcercar;
    useEffect(() => {
        const el = ref.current;
        if (!el || !activo) return undefined;
        const rueda = (e) => {
            e.preventDefault();
            // Exponencial y no lineal: así un paso hacia adentro y otro hacia
            // afuera vuelven exactamente al mismo tamaño.
            cb.current(Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
        };
        el.addEventListener('wheel', rueda, { passive: false });
        return () => el.removeEventListener('wheel', rueda);
    }, [ref, activo]);
}
