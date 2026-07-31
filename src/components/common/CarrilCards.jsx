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

const CarrilCards = memo(({ children, className = '', ariaLabel = 'Métricas de la vista' }) => {
    const pistaRef = useRef(null);
    const [desliza, setDesliza] = useState(false);
    const [alInicio, setAlInicio] = useState(true);
    const [alFinal, setAlFinal] = useState(false);
    const [compacta, setCompacta] = useState(false);

    const tarjetas = Children.toArray(children).filter(isValidElement);

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

    return (
        <div className={`relative min-w-0 ${className}`}>
            <div
                ref={pistaRef}
                role="group"
                aria-label={ariaLabel}
                className={`flex items-stretch gap-2 scroll-smooth
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                    pt-6 pb-14 -mt-6 -mb-14
                    pointer-events-none [&>*]:pointer-events-auto
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
                el borde de la vista, así que no tapan la primera tarjeta. */}
            {desliza && !alInicio && (
                <button type="button" onClick={() => correr(-1)} aria-label="Ver las métricas anteriores"
                    className="absolute -left-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        transition-[background-color,border-color,color] duration-150">
                    <ChevronLeft size={14} strokeWidth={2.5} />
                </button>
            )}
            {desliza && !alFinal && (
                <button type="button" onClick={() => correr(1)} aria-label="Ver las métricas siguientes"
                    className="absolute -right-3 top-1/2 -translate-y-1/2 z-content
                        w-7 h-7 rounded-full grid place-items-center
                        bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)]
                        text-content-2 hover:bg-brand hover:border-brand hover:text-white
                        transition-[background-color,border-color,color] duration-150">
                    <ChevronRight size={14} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
});

CarrilCards.displayName = 'CarrilCards';
export default CarrilCards;
