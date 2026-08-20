/**
 * El escape del scroll de una baldosa — 2026-08-20.
 *
 * Contexto, porque son DOS reportes opuestos del mismo usuario sobre la misma
 * tecla y quien lea sólo uno la vuelve a mover:
 *
 * · 14-ago (v2.604.2): «si scroleo y se acaba el scroll interno, hace scroll
 *   externo, así que se mueve». Se puso `overscroll-contain` en los scrollers
 *   del tablero. Correcto para lo que pedía: revisar una lista no debe mover
 *   el tablero debajo del puntero.
 * · 20-ago: «en inicio no puedo escrolear bien, solo escrolea internamente, si
 *   quiero escrolear todo debo salir y buscar otro lugar. lo mismo en android.
 *   en iphone si funciona bien».
 *
 * No se contradicen: `overscroll-behavior: contain` no distingue el
 * encadenamiento ACCIDENTAL —el que ocurre a mitad de un gesto, cuando la
 * lista se acaba— del DELIBERADO —el gesto que empieza con la lista ya en su
 * tope y quiere mover la página—. Los apaga a los dos, y como las baldosas
 * cubren el Inicio entero, no queda dónde agarrar la página.
 *
 * Y por eso el iPhone «funciona bien»: WebKit no bloquea el encadenamiento de
 * un scroller anidado como lo hace Chrome, así que ahí el segundo gesto SÍ
 * mueve la página. El modelo que el usuario ya validó es ese, y es el que se
 * reproduce acá — no se elige entre los dos reportes, se cumplen los dos:
 *
 *   dentro del gesto  → contenido (reporte del 14)
 *   gesto que EMPIEZA en el borde → encadena (reporte del 20)
 *
 * El táctil no pasa por acá: se resuelve en CSS (`index.css`, §scroll del
 * tablero), porque en un dedo no hay forma de saber la dirección antes de que
 * el navegador ya haya elegido a quién scrollear, y porque el comportamiento
 * que se busca en el dedo es exactamente el del iPhone: encadenar siempre.
 */

/* Los scrollers del tablero se marcan con la clase de Tailwind, que es lo que
   el gate `scroll-encadenado` ya exige: así no hay una segunda lista que
   mantener y el que agregue un widget queda cubierto sin escribir nada. */
const SELECTOR = '.overscroll-contain';

/* Hueco entre dos eventos de rueda que ya no es el mismo gesto. Un trackpad
   con inercia emite cada ~16ms mientras el dedo va y sigue emitiendo mientras
   frena; 200ms deja pasar la inercia como continuación y trata como gesto
   nuevo al empujón siguiente. */
const PAUSA_ENTRE_GESTOS_MS = 200;

const MARGEN_PX = 1;   // el scrollTop fraccionario de un zoom no es un borde

function enElBorde(el, haciaAbajo) {
  return haciaAbajo
    ? el.scrollTop + el.clientHeight >= el.scrollHeight - MARGEN_PX
    : el.scrollTop <= MARGEN_PX;
}

/**
 * Instala el escape sobre `raiz` (la rejilla de widgets). Devuelve la función
 * de limpieza.
 */
export function permitirEscapeDelScroll(raiz) {
  if (!raiz) return () => {};

  let ultimaRueda = -Infinity;

  const alRodar = (e) => {
    const el = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
    if (!el || !raiz.contains(el)) return;

    const gestoNuevo = e.timeStamp - ultimaRueda > PAUSA_ENTRE_GESTOS_MS;
    ultimaRueda = e.timeStamp;

    // ── La decisión se toma UNA vez y dura todo el gesto ──────────────────
    // Reponer `contain` en cada evento de continuación parece lo prudente y
    // rompe justo lo que se vino a arreglar: una rueda emite decenas de eventos
    // por empujón, así que el segundo ya volvería a trabar el gesto que acababa
    // de habilitarse. Y no hace falta: si el gesto EMPEZÓ con lista por
    // recorrer, quedó en `contain`, y ahí sigue cuando la lista se acabe a
    // mitad de camino — que es exactamente el reporte del 14-ago.
    //
    // Además compra tolerancia al reloj del compositor: el primer evento de un
    // gesto puede aplicarse con el valor viejo (el oyente es `passive`, así que
    // el scroll no lo espera). Con la decisión sostenida, los eventos que
    // siguen ya llevan el valor nuevo y el gesto se completa igual.
    if (!gestoNuevo) return;

    // Gesto nuevo: la pregunta es si esta baldosa tiene algo que ofrecer en la
    // dirección que se pide. Si no —no scrollea, o ya está en ese tope—, el
    // gesto es para la página y se la deja pasar.
    const sinNadaQueRecorrer = el.scrollHeight <= el.clientHeight + MARGEN_PX;
    el.style.overscrollBehavior =
      (sinNadaQueRecorrer || enElBorde(el, e.deltaY > 0)) ? 'auto' : 'contain';
  };

  /* `capture: true` porque los eventos de rueda de un hijo llegan al ancestro
     igual, pero se quiere decidir ANTES de que nadie los detenga. `passive`
     porque nunca se hace `preventDefault`: sólo se cambia una propiedad que el
     navegador lee al empezar a scrollear. */
  raiz.addEventListener('wheel', alRodar, { passive: true, capture: true });
  return () => raiz.removeEventListener('wheel', alRodar, { capture: true });
}
