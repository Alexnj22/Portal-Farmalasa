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
 * ── DOS gramáticas, una por material ──────────────────────────────────────
 * **Con vidrio, la gota: `clip-path`.** El vidrio es una lente, así que lo que
 * corresponde es abrir la ventana por la que se mira: el panel está siempre a
 * tamaño real y lo único que crece es el recorte. Y es obligado además de
 * bonito — escalar el panel escala también su `backdrop-filter`, y a
 * `scale(0.14)` los 24px de blur valen ~3, así que el vidrio llegaba al final
 * en vez de estar desde el principio.
 *
 * **Sin vidrio, el deslizamiento: `translate`.** Solid Modern no es "liquid sin
 * blur": es el tema de superficies opacas y rectas, para equipos de pocos
 * recursos. Ahí una gota en píldora es prestada —no hay lente que justifique
 * la forma— y encima cara: recortar obliga a rasterizar cada cuadro.
 * `translate` es de las dos únicas propiedades que el compositor mueve sin
 * repintar nada, y una hoja que sube y baja es exactamente la gramática recta
 * que el tema promete.
 *
 * ── Lo que NO puede diferir: el asa siempre cierra ────────────────────────
 * Hasta v2.293.0 la rama sin vidrio era `transform: scale(0.94) → scale(1)`, y
 * era mala por tres motivos que solo se vieron midiendo:
 *
 * · **Escalar re-rasteriza.** La capa de sombra es HIJA del panel, así que el
 *   `scale` la arrastraba: 18px de difuminado redibujados en cada cuadro. El
 *   camino "barato" pagaba lo caro del otro. `translate` no la deforma: la
 *   mueve ya rasterizada.
 * · **Un zoom del 6% no dice nada** — ni de dónde salió (la gota) ni hacia
 *   dónde se va (el deslizamiento). Era movimiento sin gramática.
 * · **El arrastre quedaba muerto.** El asa reproduce la animación bajo el dedo
 *   leyendo `__gota`, y `__gota` solo se colgaba en la rama del vidrio; medido
 *   en solid, el dedo no despeinaba un cuadro. Un asa que promete "esto se
 *   cierra hacia abajo" y no cumple es peor que no tener asa.
 *
 * Por eso `__gota` se cuelga en LAS DOS ramas, y dice cuál técnica está en
 * juego. La forma de la animación es del material; poder cerrarla con el dedo
 * no se negocia por tema.
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
//
// Y el número sale del TEMA, no de acá: Solid Modern existe para responder
// rápido y ya declara su propio reloj (`--dur-*` al 60% desde el 2026-07-28).
// Esta animación era la única del portal que lo ignoraba, así que el tema
// "rápido" abría sus hojas al mismo ritmo que el expresivo. Los valores de
// abajo son el respaldo para cuando la hoja de estilos todavía no aplicó.
const ENTRADA_MS = 340;
const SALIDA_MS = 240;

/**
 * Las dos duraciones de la gota, según el tema activo.
 *
 * Se leen del elemento raíz en el momento de animar y no por contexto de React:
 * el tema se cambia estampando `data-theme` en `<html>`, así que la hoja de
 * estilos ya es la fuente de verdad y cualquier copia en JS sería una segunda
 * que hay que mantener sincronizada.
 */
export function tiemposGota() {
    return {
        entrada: msDelTema('--gota-entrada', ENTRADA_MS),
        salida: msDelTema('--gota-salida', SALIDA_MS),
    };
}

/**
 * Lee una duración del tema activo y la devuelve en milisegundos.
 *
 * Se lee del elemento raíz en el momento de animar y no por contexto de React:
 * el tema se cambia estampando `data-theme` en `<html>`, así que la hoja de
 * estilos ya es la fuente de verdad y cualquier copia en JS sería una segunda
 * que hay que mantener sincronizada.
 *
 * **La unidad hay que leerla.** El token se escribe `200ms`, pero Lightning CSS
 * lo minifica a `.2s` — es más corto y vale lo mismo en CSS—, así que un
 * `parseFloat` a secas devuelve 0.2 y la transición sale de **0.2
 * milisegundos**: instantánea, indistinguible de no tener animación. En
 * `npm run dev` no pasa (no hay minificador), así que solo aparece contra el
 * build, que es justo donde se probó y se vio.
 *
 * Vive acá y se exporta porque ya no la usa sólo la gota: desde el cableado de
 * §4 (2026-08-06) también la usa la entrada del menú flotante.
 */
export function msDelTema(nombre, respaldo) {
    const bruto = String(getComputedStyle(document.documentElement)
        .getPropertyValue(nombre)).trim();
    const v = parseFloat(bruto);
    if (!Number.isFinite(v) || v <= 0) return respaldo;
    return /ms$/.test(bruto) ? v : /s$/.test(bruto) ? v * 1000 : v;
}

/**
 * Fuerza que el navegador FIJE el estilo actual como punto de partida.
 *
 * Se hacía con `void el.offsetWidth`, y eso fuerza *layout* — que en Chromium y
 * en el WebKit de pruebas alcanza, pero **en el Safari de iOS no siempre**: una
 * transición necesita que el estilo COMPUTADO esté recalculado, y leer una
 * medida geométrica no lo garantiza. Cuando no queda fijado, el navegador junta
 * el estado inicial y el final en uno solo y salta al valor final: la animación
 * "no se ve, solo desaparece".
 *
 * Leer la propiedad que se va a animar del `getComputedStyle` sí obliga al
 * recálculo de estilo, que es lo que hace falta. Se lee también `offsetWidth`
 * porque hay casos donde el layout todavía está sucio.
 */
function fijarEstilo(el, prop) {
    void el.offsetWidth;
    void getComputedStyle(el)[prop];
}

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
// La de salida NO puede ser trasera. `cubic-bezier(0.3,0,0.8,0.15)` dejaba el
// recorrido casi entero para el final —medido: a los 224ms de 240 iba por el 53%,
// y ahí ya se desmonta—, así que lo único que se veía era la hoja desapareciendo.
// Esta reparte y llega: es la estándar de Material para lo que sale.
const CURVA_SALIDA = 'cubic-bezier(0.4,0,0.2,1)';

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
 * El elemento que hay que recortar: **el que lleva el material**, no su
 * envoltorio.
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
 *
 * Devuelve `null` cuando no hay vidrio en ningún lado, y ese `null` es la
 * bifurcación: sin blur que preservar se desliza el panel entero, que es más
 * barato y además la gramática recta del tema.
 */
function elVidrio(el) {
    if (!el) return null;
    if (getComputedStyle(el).backdropFilter !== 'none') return el;
    // Entre TODOS los hijos, no solo el primero: el panel lleva además la capa
    // de sombra, y si esa queda primera —como quedó al agregarla— la búsqueda
    // devolvía `null`, todo modal se iba por el otro camino y ese `transform`,
    // siendo ANCESTRO del vidrio, lo mataba. Un detector que mira "el primer
    // hijo" asume un orden que nadie prometió.
    for (const h of el.children) {
        if (getComputedStyle(h).backdropFilter !== 'none') return h;
    }
    return null;
}

/**
 * El descriptor que dejó la animación de entrada, buscándolo hacia ARRIBA.
 *
 * `useGotaApertura` lo cuelga del elemento que anima, y cuál es depende de la
 * técnica: con vidrio es la hoja misma, deslizando es el envoltorio de
 * `ModalShell` —que es quien lleva la capa de sombra y tiene que viajar con
 * ella—. `useArrastreHoja`, en cambio, solo conoce la hoja.
 *
 * Antes cada uno resolvía el elemento por su cuenta con una copia de la misma
 * función, y las copias ya habían divergido (una devolvía `null` donde la otra
 * devolvía `el`). Buscar el descriptor en vez de recalcular el elemento saca
 * del medio la posibilidad de que discrepen: hay una sola verdad y la escribió
 * quien animó.
 */
export function descriptorGota(desde) {
    for (let n = desde; n; n = n.parentElement) {
        if (n.__gota) return n.__gota;
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
    // Sembrar el punto de partida: si el `transform` está en `none`, Safari no
    // siempre interpola desde ahí —y encima `transform-origin` cambiaría a la vez
    // que el transform, lo que produce un salto en vez de un recorrido—. Con la
    // identidad explícita y el estilo fijado, los dos extremos son del mismo tipo.
    if (ms) {
        sombra.style.transition = 'none';
        sombra.style.transformOrigin = '0 0';
        sombra.style.transform = 'translate(0px, 0px) scale(1, 1)';
        fijarEstilo(sombra, 'transform');
    }
    const anchoDestino = Math.max(1, r.width - l.izq - l.derecha);
    const altoDestino  = Math.max(1, r.height - l.arriba - l.abajo);
    sombra.style.transformOrigin = '0 0';
    // El RADIO también. Sin esto la capa conserva sus 32px de esquina superior y,
    // al escalarla, el radio se encoge con ella: sobre una caja del tamaño de un
    // botón queda casi recta y se lee como un **recuadro** acompañando a la gota.
    // Fue exactamente lo reportado. Con `50%` el borde es siempre una elipse,
    // escale lo que escale.
    sombra.style.transition = ms
        ? `transform ${ms}ms ${curva}, border-radius ${ms}ms ${curva}, opacity ${ms}ms ease-out`
        : 'none';
    sombra.style.borderRadius = '50%';
    sombra.style.transform =
        `translate(${l.izq}px, ${l.arriba}px) scale(${anchoDestino / r.width}, ${altoDestino / r.height})`;
    sombra.style.opacity = ms ? '0' : '1';
}

/**
 * El deslizamiento, para el camino sin vidrio.
 *
 * Una hoja inferior sale por abajo y vuelve por abajo: el recorrido es su propio
 * alto, más un margen para que la sombra de arriba también quede fuera de
 * cuadro. Un diálogo CENTRADO no tiene borde del que venir, así que se le da el
 * mínimo que igual comunica presencia —8px y un fundido corto—; empujarlo media
 * pantalla lo convertiría en otra cosa.
 *
 * La sombra de arriba delata a la hoja: `[data-sombra-hoja]` solo lo rendea
 * `ModalShell` cuando `align === "bottom"`, así que preguntar por ella es
 * preguntar "¿esto es una hoja?" sin agregar una prop que alguien tenga que
 * acordarse de pasar.
 */
function deslizamientoDe(el, r) {
    const esHoja = !!el.querySelector('[data-sombra-hoja]');
    if (!esHoja) return { esHoja: false, eje: 'y', conFundido: true, recorrido: 8, fuera: 'translate3d(0, 8px, 0)' };
    // El eje lo declara `ModalShell` en el envoltorio: con el teléfono acostado
    // la hoja entra por el costado, no por abajo, y una salida vertical la haría
    // irse hacia un borde que no es el suyo.
    const eje = el.dataset?.eje === 'x' ? 'x' : 'y';
    // En px y no en `100%`: el arrastre trabaja en píxeles —es lo que mide un
    // dedo— y mezclar unidades obliga al navegador a interpolar por matriz. Con
    // la misma unidad en los dos extremos, soltar el dedo continúa el número que
    // ya venía en vez de reiniciar la cuenta.
    const recorrido = Math.ceil(eje === 'x' ? r.width : r.height) + 48;
    return {
        esHoja: true, eje, conFundido: false, recorrido,
        fuera: eje === 'x' ? `translate3d(${recorrido}px, 0, 0)` : `translate3d(0, ${recorrido}px, 0)`,
    };
}

/**
 * Se retira el `transform` al llegar, y no es cosmético: **un ancestro con
 * `transform` es el bloque contenedor de todo `position: fixed` que tenga
 * adentro**. Los popovers de `LiquidSelect` —que es justo lo que vive dentro de
 * la hoja de filtros— se posicionan así. Dejarlo puesto los anclaría al panel.
 * Es la misma familia de reglas que ya mordió por `clip-path` y por `opacity`.
 */
function limpiarDeslizamiento(el) {
    el.style.transform = '';
    el.style.opacity = '';
    el.style.transition = '';
}

function soltarSombra(sombra, ms, curva) {
    if (!sombra) return;
    sombra.style.transition = `transform ${ms}ms ${curva}, border-radius ${ms}ms ${curva}, opacity ${ms}ms ease-out`;
    sombra.style.transform = 'translate(0px, 0px) scale(1, 1)';
    sombra.style.borderRadius = '';
    sombra.style.opacity = '1';
}

/**
 * @param {object} opciones
 *   ref            – el elemento que se anima (el que lleva el material)
 *   activo         – false lo apaga entero (reduced-motion, o el llamador se anima solo)
 *   cerrando       – la salida
 *
 * La duración ya no se recibe: la pone el tema (`tiemposGota()`). Pasarla por
 * prop obligaba a que `ModalShell` supiera de temas para reenviar un número que
 * la hoja de estilos ya declara.
 */
export function useGotaApertura({ ref, activo = true, cerrando = false }) {
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

        const vidrio = elVidrio(el);
        const { entrada } = tiemposGota();

        // ── Sin vidrio: DESLIZAR el panel entero ──────────────────────────
        // El panel y no la hoja: la capa de sombra es hija del panel, y una hoja
        // que sube dejando su sombra clavada arriba es justo el corte a la vista
        // que esa capa existe para evitar. Moviéndolos juntos la sombra viaja ya
        // rasterizada — el compositor la traslada, no la vuelve a pintar.
        if (!vidrio) {
            const desliza = deslizamientoDe(el, r);
            el.__gota = { tecnica: 'deslizar', el, ...desliza };
            el.style.transition = 'none';
            el.style.transform = desliza.fuera;
            if (desliza.conFundido) el.style.opacity = '0';
            fijarEstilo(el, 'transform');
            el.style.transition = `transform ${entrada}ms ${CURVA}`
                + (desliza.conFundido ? `, opacity ${Math.round(entrada * 0.7)}ms ease-out` : '');
            el.style.transform = 'translate3d(0, 0, 0)';
            if (desliza.conFundido) el.style.opacity = '1';
            // Filtrando por propiedad **y por objetivo**. `transitionend` BURBUJEA,
            // y `transform` es la propiedad más transicionada de la app —cada
            // botón del contenido la lleva—, así que el primer hover o el primer
            // reveal de adentro terminaba una transición ajena, el evento subía
            // hasta acá y esto borraba el desplazamiento a los pocos milisegundos.
            // Medido: `panelTransform` ya estaba en `none` a los 57ms de una
            // animación de 200. Con `clip-path` el filtro por propiedad alcanzaba
            // porque nadie más la anima; con `transform` no alcanza ni de lejos.
            const alLlegar = (ev) => {
                if (ev && (ev.target !== el || ev.propertyName !== 'transform')) return;
                limpiarDeslizamiento(el);
                el.removeEventListener('transitionend', alLlegar);
            };
            el.addEventListener('transitionend', alLlegar);
            return () => el.removeEventListener('transitionend', alLlegar);
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
        // El `eje` también en la rama del vidrio: la gota en sí es
        // direccional-agnóstica —el recorte sale del rectángulo del control, esté
        // donde esté— pero el ARRASTRE necesita saber si el dedo cuenta en X o en
        // Y. Sin esto, en un panel lateral el gesto se leería en el eje
        // equivocado y arrastrar hacia el borde no cerraría nada.
        vidrio.__gota = {
            tecnica: 'gota', el: vidrio, lados: ladosIniciales.current, sombra,
            eje: el.dataset?.eje === 'x' ? 'x' : 'y',
        };
        transformarSombra(sombra, vidrio, desde, 0, '', ladosIniciales.current);

        // Fuerza el reflujo: sin esto el navegador junta el estado inicial y el
        // final en un solo estilo computado y no hay transición que interpolar.
        fijarEstilo(vidrio, 'clipPath');

        vidrio.style.transition = `clip-path ${entrada}ms ${CURVA}`;
        // El radio final se LEE del elemento: en los temas de vidrio son 28px y en
        // `solid` el token baja a 12, así que escribirlo lo rompía en la mitad.
        const radio = getComputedStyle(vidrio).borderTopLeftRadius || '0px';
        const abajo = getComputedStyle(vidrio).borderBottomLeftRadius || '0px';
        vidrio.style.clipPath = `inset(0px 0px 0px 0px round ${radio} ${radio} ${abajo} ${abajo})`;
        soltarSombra(sombra, entrada, CURVA);

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
            // `ev.target` además de la propiedad: el evento burbujea, así que sin
            // esto un descendiente que animara `clip-path` cancelaría la gota.
            // Hoy no hay ninguno, pero es la misma trampa que sí mordió con
            // `transform` en la rama de deslizamiento.
            if (ev && (ev.target !== vidrio || ev.propertyName !== 'clip-path')) return;
            vidrio.style.clipPath = ''; vidrio.style.transition = '';
            if (sombra) {
                sombra.style.transition = ''; sombra.style.opacity = '';
                sombra.style.transform = ''; sombra.style.borderRadius = '';
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
        const vidrio = elVidrio(el);
        const salidaMs = tiemposGota().salida;

        // ── Sin vidrio: se va por donde vino ──────────────────────────────
        if (!vidrio) {
            // El recorrido GUARDADO, no uno recalculado: entre abrir y cerrar la
            // hoja pudo cambiar de alto (se eligió un filtro, se plegó una
            // sección), y entonces la salida viajaría una distancia distinta de
            // la que viajó la entrada. Es la misma razón por la que la gota
            // guarda su recorte en vez de volver a medirlo.
            const desliza = el.__gota?.tecnica === 'deslizar' ? el.__gota : deslizamientoDe(el, r);
            // Se fija el estado actual antes de pedir la transición. Si el dedo
            // ya movió la hoja, ese desplazamiento ES el punto de partida y la
            // salida lo continúa; si no, el punto de partida es la identidad.
            // Sin fijarlo, el navegador puede juntar los dos y saltar al final —
            // el mismo defecto que en Safari hacía "no se ve, solo desaparece".
            if (!el.style.transform) el.style.transform = 'translate3d(0, 0, 0)';
            fijarEstilo(el, 'transform');
            el.style.transition = `transform ${salidaMs}ms ${CURVA_SALIDA}`
                + (desliza.conFundido ? `, opacity ${salidaMs}ms ease-in` : '');
            el.style.transform = desliza.fuera;
            if (desliza.conFundido) el.style.opacity = '0';
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
            fijarEstilo(vidrio, 'clipPath');
        }

        vidrio.style.transition = `clip-path ${salidaMs}ms ${CURVA_SALIDA}`;
        // El MISMO recorte con el que entró, no uno recalculado.
        vidrio.style.clipPath = recorteInicial.current || insetHacia(vidrio, desde);
    }, [ref, cerrando, activo]);
}
