import { useLayoutEffect, useRef } from 'react';
import { leerUltimoToque } from './ultimoToque';

/**
 * La gota: un diálogo NACE del control que lo abrió, y vuelve a él al cerrarse.
 *
 * Vivía dentro de `HojaMovil`, así que solo la tenían las hojas. Pero el gesto no
 * es de las hojas: es de **cualquier cosa que se abra por un toque** —una alerta
 * centrada, el ⌘K, un selector—, y decir de dónde salió vale igual en las tres
 * posiciones. Por eso ahora es un hook que usa `ModalShell`, y lo hereda todo el
 * portal sin que ningún llamador pida nada.
 *
 * ── Dos técnicas, y la condición no es el tema ────────────────────────────
 * **Con vidrio: `clip-path`.** Escalar el panel escala también su
 * `backdrop-filter` —a `scale(0.14)` los 24px de blur valen ~3—, así que el
 * vidrio llegaba al final en vez de estar desde el principio. Recortando, el
 * panel está siempre a tamaño real y lo único que crece es la ventana por la que
 * se lo ve.
 *
 * **Sin vidrio: `transform`.** En los temas sólidos no hay `backdrop-filter` que
 * preservar, así que desaparece la única razón por la que `clip-path` valía la
 * pena y queda su costo: obliga a rasterizar cada cuadro. `transform` + `opacity`
 * son las dos propiedades que el compositor mueve sin repintar nada.
 *
 * La condición es **si el elemento tiene vidrio**, no cómo se llama el tema: así
 * no hay una lista que actualizar cuando aparezca el quinto, y la regla se lee
 * sola — *si no hay blur que preservar, usá lo barato*.
 *
 * ── El origen se congela ──────────────────────────────────────────────────
 * Al cerrar hay que volver al mismo sitio del que se salió, y para entonces
 * `leerUltimoToque()` ya devuelve el toque que CERRÓ —el fondo, o el botón de
 * cancelar—, no el que abrió.
 */

const ENTRADA_MS = 520;

/**
 * El elemento que hay que recortar: **el que lleva el vidrio**, no su envoltorio.
 *
 * `clip-path` en un ANCESTRO crea un backdrop root, igual que `transform` y que
 * `opacity`. Medido: con el clip en el envoltorio de `ModalShell`, el texto de la
 * lista se leía nítido a través de la hoja durante toda la apertura y el vidrio
 * aparecía al terminar. En cambio el clip PROPIO no rompe nada — por eso la
 * primera versión, que vivía dentro de `HojaMovil`, funcionaba.
 *
 * Es la séptima vez que esta familia de reglas muerde en el proyecto, y la
 * primera por `clip-path`. La forma de no volver a pisarla: animar siempre el
 * elemento que tiene el material, nunca uno que lo contenga.
 */
function objetivoVidrio(el) {
    if (!el) return null;
    if (getComputedStyle(el).backdropFilter !== 'none') return el;
    const h = el.firstElementChild;
    if (h && getComputedStyle(h).backdropFilter !== 'none') return h;
    return null;
}
const tope = (n) => Math.max(0, Math.round(n));

function insetHacia(el, desde) {
    const r = el.getBoundingClientRect();
    return `inset(${tope(desde.y - r.top)}px ${tope((r.left + r.width) - (desde.x + desde.w))}px `
        + `${tope((r.top + r.height) - (desde.y + desde.h))}px ${tope(desde.x - r.left)}px round 9999px)`;
}

/**
 * @param {object} opciones
 *   ref            – el elemento que se anima (el que lleva el material)
 *   activo         – false lo apaga entero (reduced-motion, o el llamador se anima solo)
 *   cerrando       – la salida
 *   salidaMs       – cuánto dura la salida
 */
export function useGotaApertura({ ref, activo = true, cerrando = false, salidaMs = 180 }) {
    // El origen se lee AL ABRIR, dentro del efecto — no al montar.
    // `ModalShell` no se desmonta entre aperturas: vive mientras viva la vista.
    // Congelarlo en el primer render lo dejaba en `null` para siempre, porque en
    // ese momento el usuario todavía no había tocado nada. (En `HojaMovil` no se
    // notaba porque esa SÍ se remonta en cada apertura, y por eso el bug apareció
    // recién al subir la gota al canónico.)
    //
    // Se guarda en un ref para que la SALIDA vuelva al mismo sitio: al cerrar,
    // `leerUltimoToque()` ya devuelve el toque que cerró, no el que abrió.
    const origen = useRef(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !activo || cerrando) return undefined;
        const desde = leerUltimoToque();
        origen.current = desde;
        if (!desde) return undefined;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return undefined;

        // El recorte va sobre el elemento con vidrio; el `transform` puede ir en
        // el envoltorio porque en ese camino no hay blur que preservar.
        const vidrio = objetivoVidrio(el);

        if (!vidrio) {
            el.style.transformOrigin =
                `${Math.round(desde.x + desde.w / 2 - r.left)}px ${Math.round(desde.y + desde.h / 2 - r.top)}px`;
            el.style.transition = 'none';
            el.style.transform = 'scale(0.94)';
            el.style.opacity = '0';
            void el.offsetWidth;
            el.style.transition = 'transform 240ms cubic-bezier(0.22,1,0.36,1), opacity 160ms ease-out';
            el.style.transform = 'scale(1)';
            el.style.opacity = '1';
            return () => { el.style.transform = ''; el.style.opacity = ''; el.style.transition = ''; };
        }

        vidrio.style.transition = 'none';
        vidrio.style.clipPath = insetHacia(vidrio, desde);
        // La sombra entra CON la forma, no después. Antes se apagaba entera
        // durante la gota y volvía al final, así que se veía puesta encima en vez
        // de crecer con la hoja.
        const sombra = el.querySelector('[data-sombra-hoja]');
        if (sombra) { sombra.style.transition = 'none'; sombra.style.opacity = '0'; }

        // Fuerza el reflujo: sin esto el navegador junta el estado inicial y el
        // final en un solo estilo computado y no hay transición que interpolar.
        void vidrio.offsetWidth;

        vidrio.style.transition = `clip-path ${ENTRADA_MS}ms cubic-bezier(0.22,1,0.36,1)`;
        // El radio final se LEE del elemento: en los temas de vidrio son 28px y en
        // `solid` el token baja a 12, así que escribirlo lo rompía en la mitad.
        const radio = getComputedStyle(vidrio).borderTopLeftRadius || '0px';
        const abajo = getComputedStyle(vidrio).borderBottomLeftRadius || '0px';
        vidrio.style.clipPath = `inset(0px 0px 0px 0px round ${radio} ${radio} ${abajo} ${abajo})`;
        if (sombra) {
            sombra.style.transition = `opacity ${ENTRADA_MS}ms cubic-bezier(0.22,1,0.36,1)`;
            sombra.style.opacity = '1';
        }

        // El clip se retira al terminar: dejarlo puesto recortaría cualquier
        // sombra o popover que el panel quiera sacar fuera de su caja.
        const alTerminar = () => {
            vidrio.style.clipPath = ''; vidrio.style.transition = '';
            if (sombra) { sombra.style.transition = ''; sombra.style.opacity = ''; }
        };
        vidrio.addEventListener('transitionend', alTerminar, { once: true });
        return () => vidrio.removeEventListener('transitionend', alTerminar);
    }, [ref, activo, cerrando]);

    // ── La salida: la misma gota al revés ─────────────────────────────────
    // Más rápida que la entrada a propósito: abrir es una invitación y admite
    // demorarse; cerrar es una respuesta, y cualquier demora ahí se siente lenta.
    useLayoutEffect(() => {
        const el = ref.current;
        const desde = origen.current;
        if (!el || !cerrando || !desde || !activo) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const vidrio = objetivoVidrio(el);
        if (!vidrio) {
            el.style.transition = `transform ${salidaMs}ms cubic-bezier(0.4,0,1,1), opacity ${salidaMs}ms ease-in`;
            el.style.transform = 'scale(0.96)';
            el.style.opacity = '0';
            return;
        }
        const sombra = el.querySelector('[data-sombra-hoja]');
        if (sombra) {
            sombra.style.transition = `opacity ${salidaMs}ms ease-in`;
            sombra.style.opacity = '0';
        }
        vidrio.style.transition = `clip-path ${salidaMs}ms cubic-bezier(0.4,0,0.6,1)`;
        vidrio.style.clipPath = insetHacia(vidrio, desde);
    }, [ref, cerrando, salidaMs, activo]);
}
