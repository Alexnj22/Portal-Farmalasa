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

// ── Cuánto debe durar ─────────────────────────────────────────────────────
// La referencia de las guías de interfaz coincide bastante: Material pone las
// transiciones de superficie grande en 200-300ms (entrar 225, salir 195, y 375
// para lo "complejo"); las hojas de iOS rondan los 350; y el umbral clásico de
// percepción dice que por encima de 400ms una respuesta empieza a leerse como
// espera, no como movimiento.
//
// Este componente pasó por los dos extremos y los dos se reportaron: 520ms con
// una curva muy adelantada se sintió **apurada** —hacía el 46% del recorrido en
// los primeros 110ms— y 560 con una curva pareja se sintió **lenta**. O sea que
// el problema nunca fue solo el número: es la combinación. 340ms con una curva
// que arranca decidida y se asienta cae dentro de la referencia y resuelve las
// dos quejas.
const ENTRADA_MS = 340;

/**
 * La curva. `cubic-bezier(0.22,1,0.36,1)` es un ease-out muy adelantado: hace el
 * 46% del recorrido en los primeros 110ms, así que aunque dure medio segundo se
 * SIENTE rápida —"la animación es muy rápida al abrir"—. Esta reparte el
 * movimiento de forma más pareja y llega igual de suave, sin arrastrarse.
 */
// Arranca rápido y se asienta: es la "emphasized decelerate" de Material, la
// forma estándar para algo que ENTRA. Una curva pareja (`0.32,0.72,0,1`) se
// siente lenta a esta duración porque nunca da la sensación de haber llegado.
export const CURVA = 'cubic-bezier(0.2,0,0,1)';

/** La de salida arranca más decidida: cerrar es una respuesta, no una invitación. */
const CURVA_SALIDA = 'cubic-bezier(0.3,0,0.8,0.15)';

/** Interpola los cuatro lados: 0 = abierta, 1 = del tamaño del control. */
export function insetEn(vidrio, lados, t) {
    if (!lados) return '';
    const radioA = getComputedStyle(vidrio).borderTopLeftRadius || '0px';
    const radioB = getComputedStyle(vidrio).borderBottomLeftRadius || '0px';
    const r = (a) => `${Math.round(a * t)}px`;
    const ra = t > 0 ? `${Math.round(9999 * t + parseFloat(radioA) * (1 - t))}px` : radioA;
    const rb = t > 0 ? `${Math.round(9999 * t + parseFloat(radioB) * (1 - t))}px` : radioB;
    return `inset(${r(lados.arriba)} ${r(lados.derecha)} ${r(lados.abajo)} ${r(lados.izq)} round ${ra} ${ra} ${rb} ${rb})`;
}

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
    // Entre TODOS los hijos, no solo el primero: el panel lleva además la capa
    // de sombra, y si esa queda primera —como quedó al agregarla— la búsqueda
    // devolvía `null`, todo modal se iba por el camino de `transform` y ese
    // transform, siendo ANCESTRO del vidrio, lo mataba. Un detector que mira
    // "el primer hijo" asume un orden que nadie prometió.
    for (const h of el.children) {
        if (getComputedStyle(h).backdropFilter !== 'none') return h;
    }
    return null;
}
const tope = (n) => Math.max(0, Math.round(n));

function ladosHacia(el, desde) {
    const r = el.getBoundingClientRect();
    return {
        arriba:  tope(desde.y - r.top),
        derecha: tope((r.left + r.width) - (desde.x + desde.w)),
        abajo:   tope((r.top + r.height) - (desde.y + desde.h)),
        izq:     tope(desde.x - r.left),
    };
}

function insetHacia(el, desde) {
    const l = ladosHacia(el, desde);
    // Los CUATRO radios, aunque sean iguales: una transición de `clip-path` solo
    // interpola si las dos formas tienen la misma estructura, y el extremo final
    // lleva cuatro. Con `round 9999px` de un lado y cuatro valores del otro,
    // Safari no interpola — **salta**, que es exactamente "no se ve la gota".
    // Chromium es indulgente y por eso la prueba local no lo mostraba.
    return `inset(${l.arriba}px ${l.derecha}px ${l.abajo}px ${l.izq}px round 9999px 9999px 9999px 9999px)`;
}

/**
 * La sombra no se puede RECORTAR con la forma —un `clip-path` se comería
 * justamente lo que cae fuera de la caja, que es toda la sombra—, así que lo que
 * se mueve es la capa entera hasta el rectángulo del control.
 *
 * **Con `transform`, no con `top/right/bottom/left`.** Esos cuatro son
 * propiedades de LAYOUT: cambiarlas obliga al navegador a recalcular posición y
 * repintar en cada cuadro, y encima esta capa proyecta un `box-shadow` de 44px de
 * difuminado sobre 430px de ancho — repintar eso 60 veces por segundo es de lo
 * más caro que se puede pedir en un teléfono. `transform` y `opacity` son las dos
 * únicas propiedades que el compositor mueve sin volver a pintar nada.
 *
 * La capa no lleva vidrio, así que escalarla no tiene el problema del
 * `backdrop-filter`: acá el `transform` es gratis y correcto.
 */
function transformarSombra(sombra, el, desde, ms, curva, ladosGuardados) {
    if (!sombra) return;
    const l = ladosGuardados || ladosHacia(el, desde);
    const r = sombra.getBoundingClientRect();
    const anchoDestino = Math.max(1, r.width - l.izq - l.derecha);
    const altoDestino  = Math.max(1, r.height - l.arriba - l.abajo);
    sombra.style.transformOrigin = '0 0';
    sombra.style.transition = ms
        ? `transform ${ms}ms ${curva}, opacity ${ms}ms ease-out`
        : 'none';
    sombra.style.transform =
        `translate(${l.izq}px, ${l.arriba}px) scale(${anchoDestino / r.width}, ${altoDestino / r.height})`;
    sombra.style.opacity = ms ? '0' : '1';
}

function soltarSombra(sombra, ms, curva) {
    if (!sombra) return;
    sombra.style.transition = `transform ${ms}ms ${curva}, opacity ${ms}ms ease-out`;
    sombra.style.transform = 'translate(0px, 0px) scale(1, 1)';
    sombra.style.opacity = '1';
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
    //
    // Y se guarda **el recorte exacto que usó la entrada**, no solo el
    // rectángulo. Recalcularlo al cerrar daba otro resultado —medido: la entrada
    // arrancaba en `inset(156 85 23 285)` y la salida terminaba en
    // `inset(0 80 22 268)`, o sea sin encogerse verticalmente— porque entre
    // abrir y cerrar cambia lo que hay alrededor. Reproducir la cadena guardada
    // hace la simetría exacta por construcción, en vez de depender de que dos
    // cálculos separados coincidan.
    const origen = useRef(null);
    const recorteInicial = useRef(null);
    const ladosIniciales = useRef(null);

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
        recorteInicial.current = insetHacia(vidrio, desde);
        vidrio.style.clipPath = recorteInicial.current;
        // La sombra entra CON la forma, no después. Antes se apagaba entera
        // durante la gota y volvía al final, así que se veía puesta encima en vez
        // de crecer con la hoja.
        const sombra = el.querySelector('[data-sombra-hoja]');
        ladosIniciales.current = ladosHacia(vidrio, desde);
        // Se cuelgan del propio elemento para que el ARRASTRE pueda reproducir la
        // misma gota bajo el dedo. Pasarlos por contexto obligaría a que cada
        // hoja los reenvíe, y una prop de reenvío es una prop que se olvida.
        vidrio.__gota = { lados: ladosIniciales.current, sombra };
        transformarSombra(sombra, vidrio, desde, 0, '', ladosIniciales.current);

        // Fuerza el reflujo: sin esto el navegador junta el estado inicial y el
        // final en un solo estilo computado y no hay transición que interpolar.
        void vidrio.offsetWidth;

        vidrio.style.transition = `clip-path ${ENTRADA_MS}ms ${CURVA}`;
        // El radio final se LEE del elemento: en los temas de vidrio son 28px y en
        // `solid` el token baja a 12, así que escribirlo lo rompía en la mitad.
        const radio = getComputedStyle(vidrio).borderTopLeftRadius || '0px';
        const abajo = getComputedStyle(vidrio).borderBottomLeftRadius || '0px';
        vidrio.style.clipPath = `inset(0px 0px 0px 0px round ${radio} ${radio} ${abajo} ${abajo})`;
        soltarSombra(sombra, ENTRADA_MS, CURVA);

        // El clip se retira al terminar: dejarlo puesto recortaría cualquier
        // sombra o popover que el panel quiera sacar fuera de su caja.
        //
        // **Filtrando por `propertyName`**, y esa palabra era todo el bug: la hoja
        // lleva `data-surface`, y en `index.css` esa superficie declara
        // `transition: transform, …` con varias propiedades. Al abrirse, la
        // primera de ELLAS en terminar disparaba este handler y borraba el
        // recorte a los pocos milisegundos — la gota arrancaba y se cortaba sola.
        // Se veía como que solo la sombra hacía el efecto, porque la sombra es
        // otro elemento y no tiene transiciones que compitan.
        const alTerminar = (ev) => {
            if (ev && ev.propertyName !== 'clip-path') return;
            vidrio.style.clipPath = ''; vidrio.style.transition = '';
            if (sombra) {
                sombra.style.transition = ''; sombra.style.opacity = '';
                sombra.style.transform = '';
            }
            vidrio.removeEventListener('transitionend', alTerminar);
        };
        // Sin `once`: con el filtro por propiedad, los `transitionend` ajenos ya
        // no cuentan, así que el listener tiene que seguir vivo hasta el que sí.
        vidrio.addEventListener('transitionend', alTerminar);
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
        // La sombra hace el mismo recorrido, encogiéndose hasta el control.
        const sombra = el.querySelector('[data-sombra-hoja]');
        // El arrastre pudo dejarla desplazada: se suelta antes de encogerla, o el
        // recorrido saldría desde el sitio equivocado.
        if (sombra) { sombra.style.transform = ''; }
        transformarSombra(sombra, vidrio, desde, salidaMs, CURVA_SALIDA, ladosIniciales.current);

        // ── Sembrar el estado inicial SOLO si no hay ninguno ──────────────
        // Al terminar la entrada el clip se retira (`clipPath = ''`), así que al
        // cerrar la transición iría de `none` a `inset(...)` — y `none` no es una
        // forma: no hay nada que interpolar y el navegador salta al valor final.
        // Por eso se siembra el recorte abierto antes de transicionar.
        //
        // **Pero solo si hace falta.** Cuando el cierre viene de un arrastre, el
        // dedo ya dejó un recorte a mitad de camino, y sembrar el abierto lo
        // descartaba: filmado, el gesto llevaba la hoja a `inset(139 76 20 254)`
        // y a los 165ms SALTABA de vuelta a `5 3 1 10` para recomenzar. Si ya hay
        // una forma, se sigue desde ella — que es lo que hace que soltar el dedo
        // continúe el gesto en vez de reiniciarlo.
        if (getComputedStyle(vidrio).clipPath === 'none') {
            const radioA = getComputedStyle(vidrio).borderTopLeftRadius || '0px';
            const radioB = getComputedStyle(vidrio).borderBottomLeftRadius || '0px';
            vidrio.style.transition = 'none';
            vidrio.style.clipPath = `inset(0px 0px 0px 0px round ${radioA} ${radioA} ${radioB} ${radioB})`;
            void vidrio.offsetWidth;
        }

        vidrio.style.transition = `clip-path ${salidaMs}ms ${CURVA_SALIDA}`;
        // El MISMO recorte con el que entró, no uno recalculado.
        vidrio.style.clipPath = recorteInicial.current || insetHacia(vidrio, desde);
    }, [ref, cerrando, salidaMs, activo]);
}
