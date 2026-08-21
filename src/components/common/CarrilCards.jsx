import React, { memo, Children, isValidElement, cloneElement, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * CarrilCards — la fila de tarjetas de métrica de una vista. UNA sola fila.
 *
 * ── Por qué existe (2026-07-30, aprobado sobre mockup) ────────────────────
 * Las `StatCard` vivían en un `flex-wrap`, y eso hacía dos cosas mal:
 *
 * · **Envolvían.** Medido antes: Ventas daba 1, 2, 3 y 4 tarjetas por fila entre
 *   1280 y 1920px; Personal 2, 3, 4 o 5. La misma vista se veía distinta en cada
 *   monitor, y la fila empujaba la tabla hacia abajo un alto distinto cada vez.
 * · **La tarjeta huérfana de la última fila crecía hasta llenarla sola.** En
 *   Personal a 1920px había cuatro de 172px y **una de 726**.
 *
 * Acá no envuelven: entran las que quepan y el resto se alcanza deslizando. El
 * alto de la fila es constante, que es lo que hace que la vista se vea igual en
 * todas partes.
 *
 * ── El sobrante NO se tira: asoma la siguiente ────────────────────────────
 * La pista ocupa TODO el carril, así que lo que queda después de las tarjetas
 * enteras se ve como el borde de la próxima. Un asomo dice "hay más" mejor que
 * las flechas solas — y las flechas, además, no siempre están.
 *
 * ── Las flechas FLOTAN, no ocupan ─────────────────────────────────────────
 * En el flujo se comían 64px de los 438 disponibles a 1512px: media tarjeta.
 * Flotando sobre el borde no cuestan ancho, y es donde el ojo las busca.
 * Aparecen solo si hay algo que deslizar, y cada una se apaga en su extremo.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <CarrilCards>
 *       <StatCard … />
 *       <StatCard … />
 *   </CarrilCards>
 *
 * `compacta` se le inyecta a cada hija: el carril es quien sabe el ancho real,
 * y bajo 176px la línea de detalle se corta a mitad de palabra.
 *
 * ── La sombra necesita aire DENTRO de la pista ────────────────────────────
 * `overflow-x: auto` no es un eje: en cuanto un eje deja de ser `visible` el
 * otro pasa a `auto` solo. O sea que la pista también recorta ARRIBA y ABAJO, y
 * la sombra de la tarjeta salía con un canto recto. Se veía como si las
 * tarjetas estuvieran metidas en una caja.
 *
 * **El aire hay que medirlo, no estimarlo.** El primer intento le puso 10px y
 * seguía cortada: la sombra real es `0 8px 32px`, o sea que baja **40px** por
 * debajo de la tarjeta y sube 24 — y al pasar el mouse crece a `0 16px 40px`,
 * que son 56. `pt-6 pb-14` cubre los dos casos y `-mt-6 -mb-14` se los devuelve
 * al layout: la fila mide lo mismo que antes.
 *
 * Y ojo con la MÁSCARA, que es la que hacía el corte más visible: `mask-image`
 * recorta al border-box igual que un `overflow: hidden`. Todo lo que la sombra
 * pintaba fuera de la caja de la pista desaparecía de golpe, así que el canto
 * recto cruzaba el ancho entero de la fila y no solo el de una tarjeta. Padding
 * suficiente lo resuelve para los dos: el recorte cae donde ya no hay sombra.
 *
 * ── Y horizontalmente NO se recorta: se deja de recortar ──────────────────
 * A los lados el mismo problema, pero ahí la solución no es padding: agrandar la
 * caja hacia la derecha la metería por debajo de la píldora y le robaría los
 * clics del borde. Lo que se hace es **no clipear cuando no hace falta**: si
 * todo entra, la pista va `overflow-visible` y las sombras respiran. El clip
 * solo existe cuando hay algo que deslizar — y justo entonces la máscara ya
 * desvanece los dos bordes, así que el corte no se puede ver.
 *
 * Por eso la medición corre en `useLayoutEffect` y no en `useEffect`: decide el
 * `overflow` del primer pintado, y con el efecto normal se alcanzaba a ver un
 * cuadro de tarjetas desbordadas antes de que se corrigiera.
 *
 * ── El borde se DESVANECE, no corta ───────────────────────────────────────
 * La tarjeta que asoma quedaba rebanada con un canto recto, como si la vista se
 * hubiera roto ahí. Se descartaron dos caminos antes del que quedó:
 *
 * · **Una cortina de color** no sirve: el fondo del portal es un gradiente, así
 *   que tendría que adivinar qué color tapar y en cualquier otra pantalla se
 *   vería como una mancha.
 * · **Una franja con `backdrop-filter`** —escarchar el canto en vez de taparlo—
 *   se escribió y se midió: **no pinta nada**. `div.group/table`, que envuelve
 *   toda vista, tiene `transform`, y un ancestro con transform mata el
 *   `backdrop-filter` de todo lo que cuelga de él. Cuarta vez que muerde.
 *
 * Queda la máscara sobre la propia pista, que desvanece las tarjetas por alfa.
 * Lo que normalmente lo impide es que `mask-image` crea un *backdrop root* y
 * dejaría sin vidrio a lo de adentro — acá no cuesta nada: **las tarjetas del
 * carril no tienen `backdrop-filter`** (medido: `none` en las cuatro vistas con
 * carril), y bajo ese `transform` tampoco podrían tenerlo.
 *
 * Va en `style` y no en una clase porque Lightning CSS colapsa los prefijos
 * `-webkit-` escritos a mano, y `-webkit-mask-*` sigue siendo obligatorio en
 * Safari; React emite las dos propiedades tal cual desde el objeto.
 */

// El umbral bajo el cual la tarjeta suelta su línea de detalle. Ver `StatCard`.
const ANCHO_CON_DETALLE = 176;

// El cupo de §17.0. De las cuatro medidas canónicas de `StatCard` —148, 200, 8
// y cinco— las tres primeras viven en clases y ésta vivía sólo en prosa, así que
// era la única que se podía romper sin que nada avisara: Observaciones llegó a
// dibujar 1 + una tarjeta POR CÓDIGO de anomalía, o sea un carril cuyo largo lo
// decidía el dato (2026-07-31).
//
// El aviso va en dev y no en un gate porque el conteo real sólo existe en
// tiempo de ejecución: un `.map()` sobre datos no se puede contar leyendo el
// JSX. Y avisa en vez de recortar — quedarse con cinco escondería métricas en
// silencio, que es peor que un carril largo.
const CUPO = 5;

// El desvanecido de los bordes. `#000`/`transparent` acá no son color: una
// máscara solo mira el canal alfa, así que esto no toca la paleta.
//
// 56px de recorrido, con la mitad todavía casi opaca: así el desvanecido se
// concentra donde está el corte en vez de repartirse y aclarar la tarjeta
// entera. Se compone al vuelo porque depende de qué lado tiene algo cortado.
const RAMPA = 'transparent 0, rgba(0,0,0,0.28) 22px, rgba(0,0,0,0.78) 40px, #000 56px';
const mascaraDe = (izq, der) => {
    const partes = [];
    if (izq) partes.push(`linear-gradient(to right, ${RAMPA})`);
    if (der) partes.push(`linear-gradient(to left, ${RAMPA})`);
    return partes.length ? partes.join(', ') : undefined;
};

/**
 * Las tarjetas de verdad, sacando las de adentro de un `<>`.
 *
 * `Children.toArray` aplana arreglos pero **no fragmentos**: un
 * `<CarrilCards>{cond ? <><StatCard/><StatCard/></> : …}</CarrilCards>` —que es
 * como están escritas tres vistas del portal— llegaba acá como UNA hija, y el
 * `cloneElement` de abajo le ponía `compacta` al fragmento. React avisaba
 * («Invalid prop supplied to React.Fragment») y, lo que importa, las tarjetas
 * de adentro **nunca recibían el prop**: bajo 176px su línea de detalle se
 * cortaba a mitad de palabra, que es exactamente lo que `compacta` evita.
 * De paso el cupo de §17.0 contaba el fragmento como una sola tarjeta.
 *
 * La clave lleva el camino (`.0/.1`) porque `Children.toArray` **numera desde
 * cero en cada nivel**: sin el prefijo, la primera hija del fragmento y la
 * primera del carril se llaman igual y React avisa de claves repetidas.
 */
function aplanar(children, prefijo = '') {
    const salida = [];
    Children.toArray(children).forEach((hijo, i) => {
        if (!isValidElement(hijo)) return;
        const clave = `${prefijo}${hijo.key ?? i}`;
        if (hijo.type === React.Fragment) salida.push(...aplanar(hijo.props.children, `${clave}/`));
        else salida.push(cloneElement(hijo, { key: clave }));
    });
    return salida;
}

const CarrilCards = memo(({ children, className = '', ariaLabel = 'Métricas de la vista' }) => {
    const pistaRef = useRef(null);
    const [desliza, setDesliza] = useState(false);
    const [alInicio, setAlInicio] = useState(true);
    const [alFinal, setAlFinal] = useState(false);
    const [compacta, setCompacta] = useState(false);

    const tarjetas = aplanar(children);

    if (import.meta.env.DEV && tarjetas.length > CUPO) {
        console.warn(
            `CarrilCards ("${ariaLabel}"): ${tarjetas.length} tarjetas, el cupo de §17.0 es ${CUPO}. ` +
            'El carril las desliza igual, pero un desglose que crece con el dato ' +
            'es UNA pregunta dibujada como N métricas: va a una ranura de la ' +
            'píldora con su conteo (FilterBar.Opciones), no al carril.'
        );
    }

    // Solo se desvanece el lado que tiene algo cortado: al principio del carril
    // el borde izquierdo es el borde de la vista, y difuminarlo ahí haría que la
    // primera tarjeta se viera a medio pintar sin motivo.
    const mascara = desliza ? mascaraDe(!alInicio, !alFinal) : undefined;

    const medir = useCallback(() => {
        const el = pistaRef.current;
        if (!el) return;
        // 2px de tolerancia: los anchos fraccionarios de flex dejan sobrantes de
        // menos de un píxel que si no harían aparecer las flechas sin motivo.
        const hayDeMas = el.scrollWidth - el.clientWidth > 2;
        setDesliza(hayDeMas);
        setAlInicio(el.scrollLeft <= 2);
        setAlFinal(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
        const primera = el.firstElementChild;
        if (primera) setCompacta(primera.getBoundingClientRect().width < ANCHO_CON_DETALLE);
    }, []);

    useLayoutEffect(() => {
        const el = pistaRef.current;
        if (!el) return undefined;
        medir();
        // `ResizeObserver` sobre la pista y no un listener de `resize` de la
        // ventana: el carril también cambia de ancho cuando el sidebar se
        // colapsa o cuando la píldora de al lado gana una ranura, y eso no
        // dispara `resize`.
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        [...el.children].forEach(h => ro.observe(h));
        el.addEventListener('scroll', medir, { passive: true });
        return () => { ro.disconnect(); el.removeEventListener('scroll', medir); };
    }, [medir, tarjetas.length]);

    const correr = (dir) => {
        const el = pistaRef.current;
        if (!el) return;
        const paso = (el.firstElementChild?.getBoundingClientRect().width ?? 148) + 8;
        el.scrollBy({ left: dir * paso * 2, behavior: 'smooth' });
    };

    // ── La tarjeta APLICADA se trae a la vista (2026-08-14) ────────────────
    // Cuando las tarjetas son el atajo de una ranura, aplicar una hace crecer la
    // píldora —gana su X y su rótulo— y el carril cede el ancho, que es lo
    // correcto (§17.0). El efecto secundario es que la tarjeta recién aplicada
    // se queda a medias fuera del borde: un filtro activo cuyo espejo no se ve.
    // El índice sale de los props de las hijas, así que no hace falta que el
    // llamador avise.
    const iActiva = tarjetas.findIndex(t => t?.props?.active);
    useLayoutEffect(() => {
        const el = pistaRef.current;
        if (!el || iActiva < 0) return;
        const hija = el.children[iActiva];
        if (!hija) return;
        const p = el.getBoundingClientRect();
        const h = hija.getBoundingClientRect();
        if (h.left >= p.left - 1 && h.right <= p.right + 1) return;   // ya se ve entera
        el.scrollBy({ left: h.left < p.left ? h.left - p.left : h.right - p.right, behavior: 'smooth' });
    }, [iActiva]);

    // ── El que cede es el CARRIL, nunca la píldora ──────────────────────────
    //
    // Los llamadores lo ponen con `flex-1` al lado de los filtros de la vista, y
    // `flex-1` es `flex: 1 1 0%`: base CERO. O sea que el carril se encoge a lo
    // que los filtros dejen, y los filtros tienen ancho intrínseco. Eso es lo
    // correcto y es deliberado.
    //
    // El 2026-08-09 se intentó lo contrario —`lg:basis-auto` acá y `lg:flex-wrap`
    // en las 17 filas que lo acompañan— para que el carril arrancara en el ancho
    // de su contenido y, si no entraba junto a los filtros, los filtros bajaran
    // de renglón. El usuario lo corrigió mirando Mín·Máx: **la píldora no baja
    // nunca**. Si el ancho no alcanza, lo que se esconde son las TARJETAS, que
    // para eso el carril desliza. Una píldora en su propio renglón es la falla
    // que §17.0 existe para evitar (ver [[feedback_la_pildora_va_en_la_fila_de_
    // las_tarjetas]]): se estira de borde a borde, su cupo de ranuras no se
    // agota nunca y el control de desborde no aparece jamás.
    //
    // Lo que sí queda del intento: `FilterBar` reserva `RESERVA_CARRIL` (314px =
    // dos tarjetas y su separación) cuando el carril está a su lado. Ese es el
    // piso real del carril, y vive del lado de los filtros porque es el que
    // reparte. Un carril de 348px con 772 de tarjetas no es un defecto: son
    // dos tarjetas enteras, la tercera asomando y el resto a un deslizamiento.
    //
    // Por debajo de `lg` no aplica: ahí el carril ya ocupa su propia fila.
    return (
        <div className={`relative min-w-0 ${className}`}>
            <div
                ref={pistaRef}
                role="group"
                aria-label={ariaLabel}
                /* ── El sobrante de 56px es para el LIFT, y el lift es del ratón ──
                   `pt-6 pb-14 -mt-6 -mb-14` agranda la caja del carril sin mover
                   nada, para que la sombra de una tarjeta levantada no se
                   recorte. Eso sólo pasa al apuntar con un mouse.
                   En táctil no hay lift, así que esos 56px de abajo no dibujan
                   nada — pero la caja los sigue ocupando y **tapa lo que viene
                   después**. Con el modo ficha eso es literal: el carril de
                   resumen se apoya sobre la primera ficha de la lista y el toque
                   no le llega. Se descubrió con Playwright negándose a hacer
                   clic: *«subtree intercepts pointer events»*.
                   El `pointer-events-none` que lo neutraliza no sirve acá porque
                   está —bien— detrás de `hover:hover`: en táctil el carril tiene
                   que recibir el dedo para poder deslizarse. Lo que sobra es el
                   sobrante, así que se va con la misma media query que el lift
                   que lo justifica. */
                /* ── El colchón de la SOMBRA no puede ser sólo de escritorio ──
                   `overflow-x-auto` recorta también en vertical —no existe
                   recortar en un solo eje—, así que la sombra de cada tarjeta
                   se corta contra el borde del carril y queda una línea recta
                   donde debería haber un degradado. Reportado en el teléfono:
                   «las sombras se ven cortadas / rectas en vez de como sombra
                   real».
                   El colchón grande de abajo (`pt-6 pb-14`) es para el LIFT del
                   hover y se va con él, bien. Pero la sombra existe en los dos
                   lados, así que su colchón —chico— va siempre. Los márgenes
                   negativos lo devuelven, o sea que no mueve nada de sitio. */
                className={`flex items-stretch gap-2 scroll-smooth
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                    py-3 -my-3
                    [@media(hover:hover)]:pt-6 [@media(hover:hover)]:pb-14
                    [@media(hover:hover)]:-mt-6 [@media(hover:hover)]:-mb-14
                    [@media(hover:hover)]:pointer-events-none [&>*]:pointer-events-auto
                    ${desliza ? 'overflow-x-auto' : 'overflow-visible'}`}
                style={{
                    maskImage: mascara,
                    WebkitMaskImage: mascara,
                    // Dos gradientes que se solapan en el centro: sin esto el
                    // `mask-composite` por defecto los suma y el medio queda
                    // opaco, que es justo lo que se quiere — pero el modo de
                    // repetición sí hay que fijarlo o el segundo se mosaiquea.
                    maskRepeat: 'no-repeat, no-repeat',
                    WebkitMaskRepeat: 'no-repeat, no-repeat',
                    maskPosition: 'left center, right center',
                    WebkitMaskPosition: 'left center, right center',
                    maskComposite: 'intersect',
                    WebkitMaskComposite: 'source-in',
                }}
            >
                {/* `compacta` solo se le inyecta a COMPONENTES. Un hijo que sea un
                    elemento del DOM —el divisor de Catálogo, por ejemplo— lo
                    recibiría como atributo y React avisaría de una prop
                    desconocida; y de paso no tiene detalle que esconder. */}
                {tarjetas.map((t, i) =>
                    typeof t.type === 'string'
                        ? cloneElement(t, { key: t.key ?? i })
                        : cloneElement(t, { key: t.key ?? i, compacta }))}
            </div>

            {/* Las flechas van por encima del borde, fuera del flujo. `-left-3`
                las saca media unidad sobre el aire que ya hay entre el carril y
                el borde de la vista, así que no tapan la primera tarjeta.
                En el teléfono ese aire no existe —la vista va a `px-2`— y la
                flecha derecha se salía 4px, que el recorte del layout comía. Se
                acerca a 6px: pierde un poco de aire y no pierde el control. */}
            {desliza && !alInicio && (
                <button type="button" onClick={() => correr(-1)} aria-label="Ver las métricas anteriores"
                    className="blanco-tactil absolute -left-1.5 md:-left-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        active:scale-[0.97]
                        transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]">
                    <ChevronLeft size={14} strokeWidth={2.5} />
                </button>
            )}
            {desliza && !alFinal && (
                <button type="button" onClick={() => correr(1)} aria-label="Ver las métricas siguientes"
                    className="blanco-tactil absolute -right-1.5 md:-right-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        active:scale-[0.97]
                        transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]">
                    <ChevronRight size={14} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
});

CarrilCards.displayName = 'CarrilCards';
export default CarrilCards;
