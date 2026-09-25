/**
 * El dueño del gesto de scroll en el Inicio — 2026-08-20 / 2026-08-21.
 *
 * Contexto, porque son TRES reportes del mismo usuario sobre la misma tecla y
 * quien lea sólo uno la vuelve a mover:
 *
 * · 14-ago (v2.604.2): «si scroleo y se acaba el scroll interno, hace scroll
 *   externo, así que se mueve». Se puso `overscroll-contain` en los scrollers
 *   del tablero. Correcto para lo que pedía: revisar una lista no debe mover
 *   el tablero debajo del puntero.
 * · 20-ago: «en inicio no puedo escrolear bien, solo escrolea internamente, si
 *   quiero escrolear todo debo salir y buscar otro lugar. lo mismo en android.
 *   en iphone si funciona bien».
 * · 21-ago: «si hago scroll en el body y paso por un widget que tiene scroll
 *   interno, también hace scroll, no debería».
 *
 * Los tres son la misma pregunta —¿de quién es ESTE gesto?— contestada en tres
 * momentos distintos, y `overscroll-behavior` sólo sabe contestar el tercero de
 * ellos (qué pasa AL LLEGAR al borde). Por eso hace falta esto:
 *
 *   el gesto EMPIEZA sobre una lista con recorrido  → es de la lista, y sigue
 *     siéndolo aunque la lista se acabe a mitad     (reporte del 14)
 *   el gesto EMPIEZA sobre una lista en su tope     → es de la página
 *                                                    (reporte del 20)
 *   el gesto EMPIEZA sobre la página                → es de la página ENTERA,
 *     y ninguna baldosa que le pase por debajo se lo puede quitar
 *                                                    (reporte del 21)
 *
 * ── Por qué el tercero necesita más que `overscroll-behavior` ───────────────
 * Porque el robo no ocurre en un borde: ocurre porque el navegador vuelve a
 * elegir a quién scrollear en cada evento, mirando qué hay bajo el puntero. Y
 * el puntero está quieto: es la PÁGINA la que se mueve y le mete la baldosa
 * debajo. Medido en Chrome (headless, `mouse.wheel`), un gesto de 2,000px que
 * empieza sobre el fondo: la página recibe 900 y la baldosa se queda con 1,100.
 * A 16ms, a 50ms y a 120ms entre eventos por igual — el «scroll latching» de
 * Chrome no lo cubre.
 *
 * La herramienta que sí lo cubre es el hit-testing: una baldosa con
 * `pointer-events: none` no es candidata a recibir la rueda, y el navegador
 * scrollea el ancestro con su física nativa —sin `preventDefault`, sin mover
 * `scrollTop` a mano, sin perder un píxel del gesto (medido: 2,000 de 2,000)—.
 * Por eso el gesto de la página se marca en la REJILLA con un atributo y el
 * resto lo hace una regla de CSS (`index.css`, §scroll del tablero).
 *
 * El táctil no pasa por acá: se resuelve en CSS, porque en un dedo no hay forma
 * de saber la dirección antes de que el navegador ya haya elegido a quién
 * scrollear, y porque el comportamiento que se busca en el dedo es el del
 * iPhone: encadenar siempre.
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

/* Mientras esto esté puesto en la rejilla, sus baldosas no reciben la rueda.
   Se quita sola al terminar el gesto — nunca queda puesta en reposo, porque
   también apagaría el clic dentro de las listas. */
const MARCA_PAGINA = 'data-gesto-de-la-pagina';

const MARGEN_PX = 1;   // el scrollTop fraccionario de un zoom no es un borde

function enElBorde(el, haciaAbajo) {
  return haciaAbajo
    ? el.scrollTop + el.clientHeight >= el.scrollHeight - MARGEN_PX
    : el.scrollTop <= MARGEN_PX;
}

/**
 * Instala el dueño del gesto sobre `raiz` (la rejilla de widgets). Devuelve la
 * función de limpieza.
 */
export function permitirEscapeDelScroll(raiz) {
  if (!raiz) return () => {};

  let ultimaRueda = -Infinity;
  let finDelGesto = null;

  const soltarLaPagina = () => raiz.removeAttribute(MARCA_PAGINA);

  const tomarLaPagina = () => raiz.setAttribute(MARCA_PAGINA, '');

  /* No hay evento de «fin de rueda»: el gesto termina cuando deja de llegar.
     Se reprograma en cada evento, así que la marca vive exactamente lo que
     dure el gesto y ni un milisegundo más. */
  const programarElFin = () => {
    clearTimeout(finDelGesto);
    finDelGesto = setTimeout(soltarLaPagina, PAUSA_ENTRE_GESTOS_MS);
  };

  /* Con la marca puesta, `e.target` ya NO es la baldosa —para eso está la
     marca—, así que preguntarle a él de quién es el gesto nuevo se contestaría
     solo que «de la página» para siempre. Se quita la marca y se rehace el
     hit-test contra la geometría real. Sucede como mucho una vez por empujón, y
     sólo en el borde entre un gesto y el siguiente. */
  const bajoElPuntero = (e) => {
    if (!raiz.hasAttribute(MARCA_PAGINA)) return e.target;
    soltarLaPagina();
    return document.elementFromPoint?.(e.clientX, e.clientY) || e.target;
  };

  const alRodar = (e) => {
    const gestoNuevo = e.timeStamp - ultimaRueda > PAUSA_ENTRE_GESTOS_MS;
    ultimaRueda = e.timeStamp;
    programarElFin();

    // ── La decisión se toma UNA vez y dura todo el gesto ──────────────────
    // Rehacerla en cada evento parece lo prudente y rompe justo lo que se vino
    // a arreglar: una rueda emite decenas de eventos por empujón, así que el
    // segundo ya desharía lo que decidió el primero. Y no hace falta: si el
    // gesto EMPEZÓ con lista por recorrer, quedó en `contain`, y ahí sigue
    // cuando la lista se acabe a mitad de camino — que es exactamente el
    // reporte del 14-ago.
    //
    // Además compra tolerancia al reloj del compositor: el primer evento de un
    // gesto puede aplicarse con el valor viejo (el oyente es `passive`, así que
    // el scroll no lo espera). Con la decisión sostenida, los eventos que
    // siguen ya llevan el valor nuevo y el gesto se completa igual.
    if (!gestoNuevo) return;

    const objetivo = bajoElPuntero(e);
    const el = objetivo instanceof Element ? objetivo.closest(SELECTOR) : null;
    const baldosa = el && raiz.contains(el) ? el : null;

    // Gesto que empieza fuera de toda baldosa: es de la página, y ninguna
    // baldosa que le pase por debajo se lo puede quitar (reporte del 21-ago).
    if (!baldosa) { tomarLaPagina(); return; }

    // Empieza sobre una baldosa: ¿tiene algo que ofrecer en la dirección que se
    // pide? Si no —no scrollea, o ya está en ese tope—, el gesto es para la
    // página; y como el puntero está sobre la baldosa, dejarla en `auto` no
    // alcanza: hay que sacarla del camino igual que en el caso de arriba.
    const sinNadaQueRecorrer = baldosa.scrollHeight <= baldosa.clientHeight + MARGEN_PX;
    const esSuyo = !(sinNadaQueRecorrer || enElBorde(baldosa, e.deltaY > 0));

    baldosa.style.overscrollBehavior = esSuyo ? 'contain' : 'auto';
    if (esSuyo) soltarLaPagina(); else tomarLaPagina();
  };

  /* En `window` y no en la rejilla, porque el gesto que hay que reconocer es
     justamente el que EMPIEZA fuera de ella: un oyente colgado de la rejilla no
     ve nacer nada. `capture` para decidir antes de que nadie lo detenga, y
     `passive` porque nunca se hace `preventDefault` — el scroll lo sigue
     haciendo el navegador con su física, acá sólo se elige a quién. */
  window.addEventListener('wheel', alRodar, { passive: true, capture: true });
  return () => {
    window.removeEventListener('wheel', alRodar, { capture: true });
    clearTimeout(finDelGesto);
    soltarLaPagina();
  };
}
