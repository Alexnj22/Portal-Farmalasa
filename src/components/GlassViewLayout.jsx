import React, { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';
import ModuleLockNotice, { ModuleLockChip } from './common/ModuleLockBanner';
import useMediaQuery from '../hooks/useMediaQuery';
import useLayoutCompacto from '../hooks/useLayoutCompacto';
import BarraFlotante from './common/BarraFlotante';
import {
    CanalDeVistaCtx, useCanalesDeVista,
    useBuscadorDeVista, useHayBarraDeFiltros, usePublicarBarraDeBusqueda,
} from './common/CanalDeVista';

/**
 * El buscador de una vista SIN `FilterBar`, en el teléfono.
 *
 * La regla es *«si una vista no tiene barra de filtros pero sí buscador, en
 * móvil el buscador baja al clúster flotante»* — y hasta el 2026-08-09 no se
 * cumplía en 5 vistas, porque el clúster lo dibujaba únicamente `FilterBar`.
 * Medido en WebKit iPhone 13, en TODAS sus pestañas: Pedidos (5), Laboratorios
 * (2), Roles (2), Avisos (3) y Mantenimiento (sin pestañas) se quedaban con la
 * lupa en el encabezado, que se va con el scroll — justo lo que el canal de
 * `CanalDeVista` existía para evitar.
 *
 * Va como componente aparte y no en el cuerpo de `GlassViewLayout` por una
 * razón dura: el layout es quien RENDERIZA el proveedor, así que un hook suyo
 * leería el contexto de más arriba, no el propio. Tiene que ser un hijo.
 *
 * `useLayoutCompacto` es la misma condición que usa `FilterBar` para decidir si
 * flota: si se copiara con otro corte, habría anchos donde se dibujan las dos
 * barras o ninguna.
 */
function BuscadorFlotanteDeRespaldo() {
    const compacto = useLayoutCompacto();
    const buscador = useBuscadorDeVista();
    const hayBarraDeFiltros = useHayBarraDeFiltros();

    // Si hay `FilterBar`, el buscador ya es suyo: dibujar otro clúster sería
    // el defecto opuesto —dos barras para el mismo término— que es peor que el
    // que se está corrigiendo.
    const activo = compacto && !!buscador && !hayBarraDeFiltros;

    // Antes del retorno temprano: es lo que hace que `ViewTabBar` suelte la
    // lupa, y un hook detrás de un `return` no existe.
    usePublicarBarraDeBusqueda(activo);

    if (!activo) return null;
    return <BarraFlotante ariaLabel="Buscar" buscador={buscador} />;
}

const GlassViewLayout = ({
    icon: Icon,
    title,
    liveIndicator = false,
    filtersContent,
    headerLeft,
    subContent,
    transparentBody = false,
    fixedScrollMode = false,
    children
}) => {
    const scrollContainerRef = useRef(null);
    const [showScrollNav, setShowScrollNav] = useState(false);

    const handleInternalScroll = useCallback(() => {
        if (!scrollContainerRef.current) return;
        requestAnimationFrame(() => {
            const { scrollTop } = scrollContainerRef.current;
            setShowScrollNav(scrollTop > 150);
        });
    }, []);

    const scrollTo = useCallback((pos) => {
        scrollContainerRef.current?.scrollTo({ top: pos, behavior: 'smooth' });
    }, []);

    // bg-transparent para transparentBody (no lleva data-surface); el resto del
    // material (fondo/borde/sombra/radio/transición/hover) ya lo aplica
    // data-surface="card" en index.css — verificado que gana la cascada
    // sobre cualquier clase Tailwind equivalente aquí (Fase T2).
    const bodyCardCls = transparentBody ? 'bg-transparent' : '';

    // Los dos canales entre las píldoras hermanas de la vista. Ver CanalDeVista.js.
    const canalesDeVista = useCanalesDeVista();

    // ── En teléfono la card del cuerpo NO va (2026-07-30) ──────────────────
    // Medida la cadena de anchos en un iPhone de 320px: del viewport al primer
    // texto se iban **92px (29%)** en cromo anidado, y la card del cuerpo era
    // parte del problema por dos vías — su borde, y el `px-2` que la separa del
    // borde de la pantalla. Encima envuelve contenido que casi siempre trae su
    // propia card (las tarjetas por producto del conteo, los widgets del
    // Inicio), o sea el doble borde y doble radio que este proyecto ya nombró
    // "una isla dentro de otra isla".
    //
    // Con mouse la card sí sirve: delimita el área de trabajo dentro de una
    // pantalla ancha. En un teléfono la pantalla ES el área de trabajo.
    //
    // `data-surface` es un atributo, no una clase, así que no se puede apagar
    // con un breakpoint de Tailwind: la decisión pasa por el hook. Y tiene que
    // ser `data-surface` ausente y no una clase que lo pise — el material de
    // `data-surface` gana la cascada contra cualquier clase equivalente (T2).
    const esMovil = useMediaQuery('(max-width: 767px)');
    const cuerpoConCard = !transparentBody && !esMovil;

    const floatBtn = 'w-10 h-10 rounded-2xl flex items-center justify-center';
    const floatStyle = {
        background: 'var(--surface-card)',
        backdropFilter: 'blur(24px) saturate(200%)',
        WebkitBackdropFilter: 'blur(24px) saturate(200%)',
        border: '1px solid var(--border-card)',
        boxShadow: 'var(--shadow-glass-3)',
    };

    return (
        /* El proveedor envuelve las DOS píldoras de la vista. Tiene que estar acá
           y no dentro de ninguna de ellas: `ViewTabBar` llega por `filtersContent`
           y `FilterBar` por `children`, así que son hermanas y el único ancestro
           común es este layout. Ver `CanalDeVista.js`. */
        <CanalDeVistaCtx.Provider value={canalesDeVista}>
        {/* Hijo del proveedor, no del cuerpo del layout: ver su comentario. */}
        <BuscadorFlotanteDeRespaldo />
        <div className="max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto lg:h-full w-full font-sans relative">

            {/* ── Scroll container ── */}
            <div
                ref={scrollContainerRef}
                className={`lg:absolute lg:inset-0 lg:w-full lg:h-full pb-[max(2.5rem,calc(var(--alto-barra-flotante,0px)+0.75rem))] lg:flex lg:flex-col [&::-webkit-scrollbar]:hidden overflow-x-hidden ${
                    fixedScrollMode ? 'lg:overflow-hidden lg:overscroll-contain scroll-smooth' : 'lg:overflow-y-auto lg:overscroll-contain scroll-smooth'
                }`}
                onScroll={handleInternalScroll}
            >
                {/* Material (fondo/borde/sombra/radio/backdrop/transición/hover) lo aplica
                    data-surface="page-header" en index.css — las clases que antes
                    duplicaban esos valores (y el style inline de backdrop-filter, que
                    por especificidad SIEMPRE hubiera ganado sobre el token si el tema
                    cambiaba el blur) se retiraron en Fase T2; solo quedan layout/spacing. */}
                <div data-surface="page-header"
                    className="hidden lg:block lg:sticky lg:top-4 xl:top-5 z-header
                        mt-4 xl:mt-5 mx-4 xl:mx-6 mb-0
                        group/header
                        py-3 px-5 xl:py-3.5 xl:px-6 relative"
                    style={{ willChange: 'backdrop-filter' }}>

                        {/* Sheen decorativo — bug real 2026-07-26: estaba hardcodeado a
                            `from-white/60` sin pasar por el sistema de temas, así que en
                            dark/solid-dark pintaba un borrón blanco feo encima del header
                            oscuro. Ahora usa --header-sheen (token por tema, ver index.css). */}
                        <div className="absolute inset-0 rounded-header pointer-events-none" style={{ background: 'linear-gradient(to bottom, var(--header-sheen), transparent)' }} />

                        {/* Candado de mantenimiento (opción B): la ficha va al lado del
                            título y el detalle en una línea, los dos DENTRO del encabezado
                            porque es sticky — en el cuerpo se iban de pantalla al bajar por
                            una tabla larga. Las dos piezas devuelven null si no hay candado. */}
                        <div className="relative z-base flex flex-col">
                        <div className="flex flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-2.5 min-w-0 shrink-0">
                                {headerLeft ? headerLeft : (
                                    <div className="flex items-center gap-2.5">
                                        {Icon && (
                                            <div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl shadow-[var(--shadow-glow-brand)] p-2 relative flex items-center justify-center hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer">
                                                <Icon className="text-white" size={16} strokeWidth={1.5} />
                                                {liveIndicator && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-danger border-2 border-border-card" />
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <h2 className="font-bold text-body-xl xl:text-title-sm tracking-tight text-content">
                                            {title}
                                        </h2>
                                        <ModuleLockChip />
                                    </div>
                                )}
                            </div>
                            {/* `filtersContent` se renderiza DOS VECES en este archivo
                                —acá para escritorio, más abajo para móvil— y eso está
                                BIEN. Medido entero el 2026-07-28 antes de "arreglarlo":

                                  · accesibilidad — las ramas se ocultan con
                                    `hidden lg:block` / `lg:hidden`, y `display:none` SÍ
                                    saca del árbol de accesibilidad. 2 en el DOM, 1
                                    alcanzable. Sin duplicado para un lector de pantalla.
                                  · listeners — `useSearchToggle` y `LiquidSelect` los
                                    registran solo al ABRIR (`if (!active) return`), así
                                    que la copia oculta no registra ninguno. Contados en
                                    vivo envolviendo `addEventListener`: cero de más.
                                  · rAF — el bucle de posicionamiento de `LiquidSelect`
                                    también depende de `isOpen`. Cero de más.
                                  · estado — al achicar la ventana con el buscador
                                    abierto NO se pierde nada: el término vive en la
                                    vista, el filtro sigue aplicado y la lupa de móvil
                                    muestra su punto rojo. Verificado con "pedialyte".

                                El costo real es DOM duplicado: 14 nodos en /audit, 42
                                en /requests, 61 en /productos — sobre vistas de miles
                                de nodos. Unificarlo tocaría las 34 vistas que usan esta
                                prop para ganar eso. No vale la pena, y queda escrito
                                para que nadie lo vuelva a levantar como hallazgo. */}
                            {filtersContent && (
                                <div className="flex items-center justify-end flex-shrink-0">
                                    {filtersContent}
                                </div>
                            )}
                        </div>
                        <ModuleLockNotice />
                        </div>
                    </div>

                {/* Mobile: title inline */}
                {/* A2 (2026-07-26) — la prioridad estaba declarada al revés: el título
                    llevaba `min-w-0` (puede encogerse hasta desaparecer) y las acciones
                    `flex-shrink-0` (nunca ceden), así que en móvil ganaba lo secundario y
                    "Gestión de personal" se truncaba a "Gestión de …". El título es lo que
                    te dice dónde estás; las acciones son lo que podés posponer.
                    Con `flex-wrap` + `basis-[60%]`, cuando no entran juntos las acciones
                    bajan a una segunda línea en vez de comerse el título.

                    ── DOS COLUMNAS, no dos renglones (2026-08-09, pedido del usuario) ──
                    Aquel `basis-[60%]` es lo que hacía que casi nunca entraran juntos: el
                    reparto de líneas de un `flex-wrap` se decide con el tamaño
                    HIPOTÉTICO de cada hijo, y 60% de 374px son 224 que, más los ~168 del
                    selector de pestañas y el hueco, dan 404 > 358. O sea que el selector
                    bajaba a un renglón propio **siempre** —incluso con un título de 75px,
                    donde sobraba media pantalla—, y cada vista del teléfono empezaba con
                    dos renglones de cromo antes del contenido.

                    `basis-auto` hace que el título pida exactamente lo que MIDE, ni más
                    ni menos. Con eso el reparto de líneas se vuelve la pregunta correcta
                    —¿caben los dos de verdad?— y se contesta sola:

                      · entran     → una fila, dos columnas (15 de 18 rutas medidas)
                      · no entran  → el selector baja, como antes

                    ── Y el que no entra en una línea, se parte en dos ─────────────────
                    Con `basis-auto` los tres títulos largos del portal («Pedidos a
                    Sucursales», «Bandeja de Aprobaciones», «Compras (Bodega)») seguían
                    bajando el selector, porque a 374px de ancho no entran en UNA línea
                    al lado suyo. Decisión del usuario: **partirlos en dos renglones**,
                    centrados contra el ícono y el selector, antes que resignar la
                    columna.

                    Eso lo hace `line-clamp-2` en el `h2` — y obliga a volver a
                    `basis-0`: el título tiene que pedir 0 por adelantado para que el
                    reparto de líneas nunca lo mande abajo, y recién después crecer
                    (`grow`) hasta el hueco que deja el selector. Dos renglones de
                    `text-body-xl` con `leading-tight` miden 40px, o sea que entran
                    dentro de los 48 que ya mide la barra de pestañas: el encabezado NO
                    crece por partir el título.

                    `truncate` ya no va —era lo que producía «Pedidos a Sucur…»—; la
                    elipsis queda sólo como red del `line-clamp` a partir del tercer
                    renglón. */}
                <div className="lg:hidden pt-5 pb-4 px-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-0">
                    <div className="flex items-center gap-2.5 min-w-0 grow basis-0">
                        {headerLeft ? (
                            <div className="min-w-0">{headerLeft}</div>
                        ) : (
                            <>
                                {Icon && (
                                    <div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl shadow-[var(--shadow-glow-brand)] p-2 flex-shrink-0 relative">
                                        <Icon className="text-white" size={16} strokeWidth={1.5} />
                                        {liveIndicator && (
                                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger border-[1.5px] border-border-card" />
                                            </span>
                                        )}
                                    </div>
                                )}
                                <h2 className="font-bold text-body-xl tracking-tight leading-tight line-clamp-2 text-content">
                                    {title}
                                </h2>
                                <ModuleLockChip />
                            </>
                        )}
                    </div>
                    {filtersContent && (
                        /* `max-w-full`: `flex-shrink-0` dice "no cedas espacio", y con
                           `flex-wrap` eso significa bajar a la segunda línea cuando no
                           entra al lado del título — pero NO impide pasarse del ancho de
                           esa segunda línea. Medido en /my-requests en un iPhone 13: este
                           envoltorio media 531px en una fila de 374, y los 157 que
                           sobraban se los comía el `overflow-x-hidden` del scroll
                           container de más arriba. O sea que dos botones existían, no se
                           veían y no se podían tocar, sin que la página scrolleara de
                           lado ni nada delatara nada. El tope no cambia a quien ya
                           entraba; sólo obliga al que no, a resolverlo adentro. */
                        <div className="flex-shrink-0 flex items-center max-w-full">
                            {filtersContent}
                        </div>
                    )}
                    {/* `empty:hidden` — `ModuleLockNotice` devuelve `null` cuando
                        el módulo no está bloqueado, que es casi siempre, pero
                        este envoltorio se renderiza igual: con `basis-full`
                        dentro de un `flex-wrap`, un hijo vacío se lleva un
                        renglón entero más su `gap-y-2`. Aire que nadie pidió,
                        arriba de todas las vistas del teléfono. */}
                    <div className="basis-full min-w-0 empty:hidden"><ModuleLockNotice /></div>
                </div>

                {/* Sub-content: between header and body (e.g. chart + filter pill) */}
                {subContent && (
                    <div className="px-2 lg:px-6 xl:px-8 pt-3 xl:pt-4">
                        {subContent}
                    </div>
                )}

                {/* Content body */}
                <div className="px-0 md:px-2 lg:px-6 xl:px-8 pt-4 xl:pt-5 lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                    <div data-surface={cuerpoConCard ? 'card' : undefined}
                        // El cuerpo de vista NO responde al puntero. `:hover`
                        // matchea al elemento y a todos sus ancestros, así que
                        // sin esto apuntar cualquier tarjeta de adentro
                        // levantaba la vista entera —y la tarjeta se quedaba
                        // quieta, porque la regla vieja callaba justo a la
                        // apuntada—. Lo reportó el usuario el 2026-08-20. El
                        // material sigue siendo el de tarjeta: lo único que se
                        // apaga es el lift (ver `data-cuerpo` en index.css).
                        data-cuerpo="vista"
                        // ── Esta card NO difumina ─────────────────────────
                        // No es una decisión estética: es que no tiene nada que
                        // difuminar. Detrás suyo está el fondo de la página, que
                        // es un degradado radial — y difuminar un degradado suave
                        // devuelve el mismo degradado. Comprobado con un A/B:
                        // las dos capturas son indistinguibles.
                        //
                        // Lo que sí cuesta: esta card es el contenedor de la
                        // lista, así que mide MUCHO más que la pantalla —medido,
                        // 4.8× en /minmax (2197px de alto) y 3.1× en /staff— y su
                        // `backdrop-filter` se recalcula sobre ~2 millones de
                        // píxeles en cada cuadro del scroll. Era la causa del
                        // "se siente lento" en un 17 Pro Max.
                        //
                        // El vidrio se gana donde hay algo detrás que valga la
                        // pena mirar: el clúster flotante, las hojas, los
                        // dropdowns. Una superficie apoyada sobre el fondo no.
                        data-vidrio="no"
                        // `lg:min-h-0` SOLO con `fixedScrollMode`, y es la pieza que
                        // hace que ese modo funcione de verdad. Un flex item nace con
                        // `min-height: auto`, o sea que no puede encogerse por debajo de
                        // su contenido: este wrapper crecía al alto de lo que tuviera
                        // adentro (medido en Permisos: 8.550px) en vez de quedarse en los
                        // 798px que le daba su contenedor, y entonces las columnas que
                        // adentro piden `h-full` + `overflow-y-auto` nunca llegaban a
                        // scrollear — el contenido se iba abajo del contenedor externo,
                        // que es `overflow-hidden`, y quedaba inalcanzable.
                        //
                        // Por eso las vistas con este layout venían fijando la altura a
                        // mano (`h-[calc(100dvh-40px)]`): tapaba el síntoma con un número
                        // que asume dónde empieza el panel, y se rompe cuando algo lo
                        // corre — el aviso de "portal en construcción" lo baja 44px.
                        // Sin `fixedScrollMode` no aplica: ahí el scroll es del
                        // contenedor externo y el cuerpo crece a gusto.
                        className={`group/table flex flex-col lg:flex-1 ${fixedScrollMode ? 'lg:min-h-0' : ''} ${bodyCardCls}`}>
                        {children}
                    </div>
                </div>
            </div>

            {/* ── Floating scroll nav ── */}
            <AnimatePresence>
                {showScrollNav && (
                    <motion.div
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="fixed bottom-8 right-8 z-sidebar flex flex-col gap-2 pointer-events-auto"
                    >
                        <motion.button
                            onClick={() => scrollTo(0)}
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.90 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                            title="Ir al inicio"
                            className={floatBtn}
                            style={floatStyle}
                        >
                            <ChevronUp size={18} strokeWidth={2.5} className="text-content-2" />
                        </motion.button>
                        <motion.button
                            onClick={() => scrollTo(scrollContainerRef.current?.scrollHeight ?? 99999)}
                            whileHover={{ scale: 1.1, y: 2 }}
                            whileTap={{ scale: 0.90 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                            title="Ir al final"
                            className={floatBtn}
                            style={floatStyle}
                        >
                            <ChevronDown size={18} strokeWidth={2.5} className="text-content-2" />
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
        </CanalDeVistaCtx.Provider>
    );
};

export default GlassViewLayout;
