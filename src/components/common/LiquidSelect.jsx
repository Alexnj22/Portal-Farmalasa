import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { ChevronDown, Search, X, Plus, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import useCapaFlotante from '../../utils/capaFlotante';
import SelectorTactil from './SelectorTactil';
import { AnimatePresence, motion } from 'framer-motion';
import { msDelTema } from './gotaApertura';

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const LiquidSelect = ({
    value,
    onChange,
    options = [],
    placeholder = 'Seleccionar...',
    icon: Icon,
    disabled = false,
    clearable = true,
    compact = false,
    // Nano: variante ultra-angosta para steppers/celdas de grilla densa
    // (ej. TimePicker12, FormAiSchedulerPreview) — sin ícono izquierdo,
    // texto centrado, altura mínima reducida. No confundir con compact
    // (que sigue reservando espacio para ícono).
    nano = false,
    creatable = false,
    onCreateOption,
    // When options count exceeds this, require the user to type before showing results
    searchThreshold = 80,
    // Max options to render in the dropdown (applied after filtering)
    maxOptions = 100,
    // Server-side search: parent handles filtering, just display options as-is
    serverSearch = false,
    // Called (debounced 300ms) when user types — use to run server queries
    onSearchChange = null,
    // Show loading spinner inside dropdown
    isLoading = false,
    // Bare mode: no background/border/shadow — blends into a parent pill bar
    bare = false,
    // Texto del botón de limpiar selección. Default 'Todos' (uso como filtro
    // de listas); en formularios de datos usar algo como 'Ninguno'.
    clearLabel = 'Todos',
    // ── 2026-07-28 ──────────────────────────────────────────────────────
    // Nombre accesible del disparador. Ahora que es enfocable hace falta:
    // un `role="combobox"` sin nombre se anuncia solo como "cuadro
    // combinado". Cuando el select vive bajo un <label> propio, pasar
    // `ariaLabelledBy` con el id de esa etiqueta en vez de este.
    ariaLabel,
    ariaLabelledBy,
    // ── 2026-07-29 ──────────────────────────────────────────────────────
    // Estado inválido (campo requerido sin elegir). Antes cada formulario lo
    // pintaba envolviendo el select en un `<div rounded-2xl h-[40px]>` con
    // `!border-danger !bg-danger/10` — 35 sitios en 5 archivos, y el
    // resultado se veía roto: ese div mide 40px de alto y 10px de radio,
    // mientras el control real mide 46 (min-h max(40px, --tap-min) + borde) y
    // 8px de radio, así que el fondo del envoltorio asomaba alrededor. Va
    // acá, sobre el mismo elemento con data-surface="input", y con `outline`
    // por la misma razón que el foco: border/bg pierden contra data-surface
    // por cascade layers (ver inputStyles.js).
    invalid = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const listboxId = useId();
    const optionId = (idx) => `${listboxId}-option-${idx}`;

    const selectRef = useRef(null);
    const triggerRef = useRef(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const itemRefs = useRef([]);

    // 🚨 ESTADO AMPLIADO PARA POSICIONAMIENTO INTELIGENTE
    const [coords, setCoords] = useState({
        top: 0,
        bottom: 0,
        left: 0,
        width: 0,
        maxHeight: 300,
        transformOrigin: 'origin-top',
        isFlipped: false // Indica si se abrió hacia arriba
    });

    const lastCoordsRef = useRef(null);

    // --- VARIABLES DINÁMICAS SEGÚN MODO COMPACTO/NANO ---
    const textStyle = nano ? 'text-label font-black' : `${compact ? 'text-body-sm' : 'text-body'} font-bold`;
    // ── El relleno vertical le ganaba a la altura del canónico ──────────────
    //
    // El disparador ya declara `min-h-[max(40px,var(--tap-min))]` y `flex
    // items-center`: la altura y el centrado son suyos. Pero el `py-3.5` de
    // adentro se SUMABA a eso, así que el control terminaba en **46.3px**
    // mientras `PortalInput` mide **40** — medido con Chromium sobre el CSS
    // compilado el 2026-08-26. O sea que un select y un campo de texto puestos
    // uno al lado del otro NUNCA quedaban alineados, en ninguna pantalla del
    // portal.
    //
    // Es la unificación de §25.10 que no se completó: a este control le pusieron
    // el `min-h` correcto y le dejaron el relleno viejo, que lo pisa. Sin
    // relleno vertical la altura la decide el `min-h` y da 40px exactos.
    //
    // `nano` conserva el suyo: su mínimo son 26px y ahí el relleno sí es lo que
    // separa el texto del borde.
    const paddingStyle = nano ? 'pl-2 pr-4 py-1' : compact ? 'pl-7 pr-6' : 'pl-[3.5rem] pr-12';
    const leftIconPos = compact ? 'left-1 w-6 h-6' : 'left-4 w-8 h-8';
    // El ícono se ve del tamaño de siempre; lo que llega al piso de §25.6 en
    // táctil es el ÁREA del botón de limpiar (el chevron de al lado es
    // aria-hidden + tabIndex -1, así que no es un target).
    const rightIconPos = nano ? 'right-0.5 w-3.5 h-3.5' : compact ? 'right-1 w-5 h-5' : 'right-4 w-6 h-6';
    const clearTap = 'min-w-[var(--tap-min)] min-h-[var(--tap-min)]';
    // El chevron/limpiar vive DENTRO del campo: agrandarlo a 44px le comería
    // el texto. En vez de eso se agranda solo el área tocable con un
    // pseudo-elemento — se ve igual de chico y se toca como un control de
    // 44px. Es el único control del portal por debajo del mínimo del dedo
    // que no se puede resolver con tamaño real (medido en iPhone 13: 20x20).
    // El área de impacto sale de `.blanco-tactil` (index.css) y no de utilidades
    // `after:` escritas acá. Dos motivos: era la MISMA técnica repetida inline
    // —el carril tenía su propia copia— y sobre todo el `::after` de estos
    // botones YA está tomado por el canto que corre (§1.6), así que pisarlo con
    // un área táctil apagaba el canto o rompía el área, según cuál ganara el
    // orden. `.blanco-tactil` usa `::before`, que está libre.
    const areaTocable = 'blanco-tactil';
    const iconSize = nano ? 10 : compact ? 11 : 14;
    // El disparador se quedaba en 40px fijos, así que en un teléfono el
    // combobox medía 40 donde el piso del dedo son 44 — medido en iPhone 13 el
    // 2026-07-29: 11 comboboxes a 150x40 en 7 rutas. `--tap-min` es 0 en
    // escritorio (no agranda nada ahí) y 44px en táctil, así que el `max()`
    // sube solo donde hace falta.
    // `nano` queda con su 26px a propósito: vive dentro de grillas densas
    // (DESIGN.md §15.12) y ya recibe su área tocable de 44px por el
    // pseudo-elemento `areaTocable`, sin ocupar ese espacio en pantalla.
    const minHeightClass = nano ? 'min-h-[26px]' : 'min-h-[max(40px,var(--tap-min))]';

    const selectedOption = useMemo(() =>
        options.find(opt => String(opt.value) === String(value)),
        [options, value]);

    // 🚨 CEREBRO DE POSICIONAMIENTO Y COLISIÓN DE BORDES
    // `useCallback` porque desde que calcula el ancho mínimo lee dos props
    // (`nano`/`compact`): sin memoizar cambiaría de identidad en cada render y
    // el rAF de seguimiento —que la tiene como dependencia— se desmontaría y
    // remontaría en cada cuadro.
    const updateCoords = useCallback(() => {
        if (selectRef.current) {
            const rect = selectRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // Constantes de diseño
            const DROPDOWN_IDEAL_HEIGHT = 300;
            const MARGIN = 15; // Margen de seguridad desde los bordes de la pantalla

            // Cálculos de espacio disponible
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;

            // Use viewport coords (fixed positioning via portal — no scroll offset needed)
            let finalTop = rect.bottom + 8;
            // Abierto hacia arriba se ancla por ABAJO, no por `top`. Con `top`
            // el menú se colgaba de `rect.top - maxHeight`, o sea de la altura
            // MÁXIMA y no de la real: un menú de 3 opciones (141px medidos en
            // el "Ver" de la paginación) quedaba flotando 160px por encima del
            // disparador, desconectado de él. Con `bottom` el borde inferior
            // queda pegado al control y el contenido crece hacia arriba, que es
            // lo que hace un menú que se voltea.
            let finalBottom = viewportHeight - rect.top + 8;
            let finalMaxHeight = DROPDOWN_IDEAL_HEIGHT;
            let finalOrigin = 'origin-top';
            let flipped = false;

            if (spaceBelow < DROPDOWN_IDEAL_HEIGHT && spaceAbove > spaceBelow) {
                flipped = true;
                finalOrigin = 'origin-bottom';
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceAbove - MARGIN);
            } else {
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceBelow - MARGIN);
            }

            // El menú es más ancho que el disparador cuando éste es angosto
            // (nano: 41px de trigger contra 120px de mínimo). Anclándolo solo
            // por `left` ese sobrante se iba FUERA de la ventana si el control
            // vivía cerca del borde derecho — medido en la paginación: menú de
            // 120px arrancando en x=1319.9 sobre una ventana de 1440. Se corre
            // hacia adentro, igual que se voltea cuando no hay lugar abajo.
            const finalWidth = Math.max(rect.width, nano ? 120 : compact ? 170 : 200);
            const finalLeft = Math.max(
                MARGIN,
                Math.min(rect.left, viewportWidth - MARGIN - finalWidth)
            );

            const next = {
                top: finalTop,
                bottom: finalBottom,
                left: finalLeft,
                width: finalWidth,
                maxHeight: Math.max(finalMaxHeight, 150),
                transformOrigin: finalOrigin,
                isFlipped: flipped
            };

            // Evita re-renders innecesarios cuando el tracking continuo (ver
            // abajo) recalcula cada frame pero la posición no cambió.
            const prev = lastCoordsRef.current;
            if (!prev || prev.top !== next.top || prev.bottom !== next.bottom ||
                prev.left !== next.left || prev.isFlipped !== next.isFlipped ||
                prev.width !== next.width || prev.maxHeight !== next.maxHeight ||
                prev.transformOrigin !== next.transformOrigin) {
                lastCoordsRef.current = next;
                setCoords(next);
            }
        }
    }, [nano, compact]);

    const isLargeList = !serverSearch && options.length > searchThreshold;

    // ── Hoja táctil para listas largas (2026-07-30) ────────────────────────
    // En puntero grueso el dropdown anclado no sirve para una lista larga:
    // hereda el ancho del trigger (190px medidos en el filtro de laboratorio
    // del conteo), muestra ~4 opciones de 220, y si el trigger está abajo de la
    // pantalla el teclado del sistema lo tapa. Encima, pasado
    // `searchThreshold` la lista arranca vacía pidiendo "Escribe para buscar"
    // con el campo invisible sobre el trigger.
    //
    // ── El mínimo ──────────────────────────────────────────────────────────
    // Para 4 opciones una hoja de pantalla completa es desproporcionado, y ahí
    // el dropdown anclado funciona bien: entran todas de una.
    //
    // El corte NO es `searchThreshold` (80). Ese número está pensado para
    // escritorio —cuándo conviene escribir en vez de recorrer con la vista— y en
    // un teléfono deja un hueco malo entre 13 y 80 opciones: el dropdown muestra
    // ~4 a la vez (216px medidos) y el buscador tampoco aparece, porque también
    // se activa a los 80. O sea que una lista de 40 en un teléfono es scrollear a
    // ciegas en una ventanita.
    //
    // 12 es el punto donde el dropdown anclado deja de mostrar la lista completa
    // en un teléfono. Por debajo se recorre de un vistazo; por arriba hace falta
    // pantalla, índice y buscador.
    const CORTE_HOJA = 12;
    const esTactil = useCoarsePointer();
    const usaHoja = esTactil && !nano && (serverSearch || options.length > CORTE_HOJA);

    // ── Sin buscador (2026-08-07) ──────────────────────────────────────────
    // Al abrirse, el disparador esconde el valor y le superpone un campo con
    // placeholder "Buscar...". En un `nano` de 41px eso se ve como **"Bu"**
    // —medido en el "Ver" de la paginación— y encima tapa el único dato que
    // importaba: cuál de las tres opciones está elegida.
    //
    // El corte es `nano` **y** lista corta, no una de las dos: un nano de 60
    // opciones (los minutos de TimePicker12) sí necesita que se pueda escribir,
    // y quitarle el buscador dejaría 60 ítems recorribles solo con flechas.
    // Ocho es donde la lista entra completa de un vistazo.
    const sinBuscador = nano && !serverSearch && !creatable &&
        options.filter(o => !o.isSeparator).length <= 8;

    // Estas dos listas van ANTES de los manejadores porque
    // `handleTriggerKeyDown` las usa: si se declaran después, el React Compiler
    // ve un `useMemo` capturado por una función previa, no puede preservar la
    // memoización y deja de optimizar el componente entero (lo marca el lint
    // como "Compilation Skipped").
    const filteredOptions = useMemo(() => {
        if (serverSearch) {
            // Parent controls data — show everything except separator and empty-value (handled by clearable button)
            return options.filter(opt => !opt.isSeparator && opt.value !== '');
        }
        // Large lists: require typing before showing anything
        if (isLargeList && !searchTerm) return [];
        if (!searchTerm) return options.slice(0, maxOptions);
        const q = normalize(searchTerm);
        return options.filter(opt =>
            !opt.isSeparator &&
            (normalize(opt.label).includes(q) ||
            (opt.sublabel && normalize(opt.sublabel).includes(q)))
        ).slice(0, maxOptions);
    }, [options, searchTerm, isLargeList, maxOptions, serverSearch]);

    // Navigable (non-separator, non-disabled) options — used for keyboard nav
    const selectableOptions = useMemo(() =>
        filteredOptions.filter(o => !o.isSeparator && !o.disabled),
    [filteredOptions]);

    // Con el menú abierto, el contenido de ATRÁS deja de reaccionar al puntero
    // (ver `src/utils/capaFlotante.js`). La hoja táctil no lo necesita: va
    // dentro de ModalShell, que ya tapa el fondo con un velo real — y en un
    // dispositivo táctil no hay hover que apagar.
    useCapaFlotante(isOpen && !usaHoja);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (
                selectRef.current && !selectRef.current.contains(e.target) &&
                (!dropdownRef.current || !dropdownRef.current.contains(e.target))
            ) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        // Con la hoja táctil NO se registran: la hoja va por portal al `body`, o
        // sea FUERA de `selectRef`, así que cada toque dentro de ella contaba como
        // "afuera" y la cerraba. Se veía como que arrastrar el índice A–Z cerraba
        // el selector — medido: `mouse.down` sobre el riel y la hoja desaparecía.
        // Escape y el fondo ya los maneja `ModalShell`, que es quien la dibuja.
        if (isOpen && !usaHoja) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, usaHoja]);

    // 🚨 SEGUIMIENTO CONTINUO DE POSICIÓN (fix bug histórico de selects)
    // Antes, la posición se calculaba UNA sola vez al abrir y luego se
    // forzaba el cierre ante CUALQUIER scroll de la página (incluso de
    // contenedores sin relación con este select — window.addEventListener
    // con capture:true recibe el scroll de cualquier elemento anidado).
    // Eso producía dos síntomas reportados como "el select no abre bien":
    //   1) Si el trigger vive dentro de un bloque que recién apareció con
    //      una animación (animate-in zoom-in-95, muy común en el proyecto
    //      para campos condicionales), un click justo durante esos ~200ms
    //      capturaba el rect a mitad de la animación → el dropdown quedaba
    //      flotando en una posición vieja, desconectado del trigger real.
    //   2) Un scroll en cualquier otra parte de la página cerraba el
    //      select recién abierto, percibido como "no abre" o "se oculta".
    // Ahora se recalcula en cada frame mientras está abierto (igual que
    // Popper/Floating UI), así el dropdown sigue al trigger en vivo pase
    // lo que pase (animación, scroll, resize de hermanos), y solo se
    // cierra si el trigger deja de estar visible en el viewport.
    useEffect(() => {
        if (!isOpen) return;
        let rafId;
        const tick = () => {
            if (!selectRef.current) return;
            const rect = selectRef.current.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                setIsOpen(false);
                return;
            }
            updateCoords();
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [isOpen, updateCoords]);

    // El disparador es un <div role="combobox">, no un <button> — un <button>
    // no puede contener el input de búsqueda que se le superpone al abrirse.
    // Eso obliga a implementar a mano lo que el navegador da gratis: foco y
    // teclado. Faltaba hasta el 2026-07-28, y como LiquidSelect reemplaza a
    // TODO <select> nativo del portal (74 archivos), el resultado era que
    // ningún desplegable se podía abrir sin mouse. Medido: 0 de los
    // combobox de /staff alcanzables con Tab.
    //
    // Con el menú ya abierto las flechas y Enter las maneja el input de
    // búsqueda (más abajo); acá solo hace falta la apertura y Escape.
    const handleTriggerKeyDown = (e) => {
        if (disabled) return;
        // El input de búsqueda vive DENTRO de este div: sin este guardia, su
        // Enter burbujea hasta acá y vuelve a abrir el menú que se acaba de
        // cerrar al elegir. Mismo patrón que en DataRow.
        if (e.target !== e.currentTarget) return;
        // Sin buscador el foco se queda ACÁ, así que las flechas y Enter que
        // normalmente maneja el input hay que atenderlos en el disparador — si
        // no, el menú se abre y el teclado no puede recorrerlo.
        if (isOpen && sinBuscador) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const paso = e.key === 'ArrowDown' ? 1 : -1;
                setHighlightedIndex(i => {
                    const next = i + paso;
                    if (next >= selectableOptions.length) return 0;
                    if (next < 0) return selectableOptions.length - 1;
                    return next;
                });
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (highlightedIndex >= 0 && selectableOptions[highlightedIndex]) {
                    handleSelect(selectableOptions[highlightedIndex].value);
                } else {
                    setIsOpen(false);
                }
                return;
            }
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            handleOpen();
        } else if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            setIsOpen(false);
        }
    };

    const handleOpen = () => {
        if (disabled) return;
        updateCoords(); // Calculamos el espacio antes de abrir
        setIsOpen(true);
        setSearchTerm('');
        // Con la hoja táctil el buscador vive DENTRO de ella: enfocar el input
        // superpuesto al trigger levantaría el teclado detrás de la hoja y le
        // robaría el foco al campo real. Sin buscador no hay input que enfocar
        // y el foco se queda en el disparador (ver handleTriggerKeyDown).
        if (usaHoja || sinBuscador) return;
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleClear = (e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange('');
        setSearchTerm('');
    };

    const handleToggle = (e) => {
        e.stopPropagation();
        if (disabled) return;
        if (isOpen) {
            setIsOpen(false);
            setSearchTerm('');
        } else {
            handleOpen();
        }
    };

    const handleSelect = (val) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
        // Al cerrarse desmonta el input de búsqueda, que es quien tenía el
        // foco: sin esto el foco cae al <body> y el siguiente Tab arranca de
        // nuevo desde el principio de la página. Devolverlo al disparador.
        triggerRef.current?.focus();
    };


    // Reset highlight when options change or dropdown closes
    useEffect(() => { setHighlightedIndex(-1); itemRefs.current = []; }, [filteredOptions, isOpen]); // eslint-disable-line react-hooks/set-state-in-effect

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
            itemRefs.current[highlightedIndex].scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex]);

    const dropdownContent = (
        <motion.div
            key="liquid-dropdown"
            ref={dropdownRef}
            data-surface="dropdown"
            id={listboxId}
            role="listbox"
            style={{
                // Uno de los dos, nunca los dos: con `top` y `bottom` a la vez
                // el `fixed` estiraría la caja entre ambos.
                ...(coords.isFlipped ? { bottom: coords.bottom } : { top: coords.top }),
                left: coords.left,
                width: coords.width + 'px',
                maxHeight: coords.maxHeight + 'px',
            }}
            initial={{ opacity: 0, scale: 0.97, y: coords.isFlipped ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: coords.isFlipped ? 6 : -6 }}
            /* §4 · La entrada del menú sale del TEMA (`--menu-entrada`): 220ms
               en Liquid, `--dur-slow` (180) en Solid, que existe para responder
               rápido. Estaba clavada en 0.15 acá, así que el tema veloz y el
               expresivo abrían sus menús al mismo ritmo — el mismo hallazgo que
               `tiemposGota()` resolvió para la hoja del modal, en la otra pieza
               flotante. `msDelTema` lee la unidad porque Lightning CSS minifica
               `220ms` a `.22s` y un parseFloat a secas daría 0.22 milisegundos. */
            transition={{ duration: msDelTema('--menu-entrada', 220) / 1000, ease: [0.23, 1, 0.32, 1] }}
            /* El scroll NO puede vivir en este elemento: su `::after` —el borde de
               vidrio de `data-surface`— es `position:absolute; inset:0`, y en un
               contenedor con scroll eso se dimensiona contra la parte VISIBLE.
               Con una lista más alta que el menú, el borde quedaba dibujado a
               media lista y el resto del contenido caía fuera del vidrio: se veía
               partido en dos. Pasa en cualquier select con lista larga; lo
               destapó el filtro de MIN·MAX al llegar a once opciones.
               El panel recorta y el hijo scrollea. */
            className={`fixed z-confirm ${coords.transformOrigin} overflow-hidden p-3 flex flex-col
            transform-gpu`}
        >
            {/* Si se abre hacia arriba, mostramos los resultados en el mismo orden, pero invertimos la posición del botón "Limpiar/Placeholder" si es necesario. Por UX, es mejor dejarlo arriba */}
            <div className="flex flex-col gap-1 w-full overflow-y-auto min-h-0
                scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {!searchTerm && clearable && value != null && value !== '' && (
                    <button
                        type="button"
                        onClick={() => handleSelect('')}
                        className="w-full text-left px-4 py-3 text-body-sm font-bold rounded-2xl transition-colors duration-[var(--dur-base)] text-content-3 hover:bg-surface-card-hover hover:text-content"
                    >
                        {clearLabel}
                    </button>
                )}
                {isLoading ? (
                    <div className="px-4 py-6 text-body-sm font-bold text-center flex items-center justify-center gap-2.5 text-content-3">
                        <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />
                        Buscando...
                    </div>
                ) : isLargeList && !searchTerm ? (
                    <div className="px-4 py-8 text-body-sm font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 text-content-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-surface-card-hover">
                            <Search size={20} strokeWidth={2} />
                        </div>
                        Escribe para buscar
                    </div>
                ) : filteredOptions.length > 0 ? (
                    filteredOptions.map((opt) => {
                        const sIdx = selectableOptions.indexOf(opt);
                        const isHighlighted = sIdx >= 0 && sIdx === highlightedIndex;
                        return opt.isSeparator ? (
                            <div
                                key={opt.value}
                                className="px-4 pt-3 pb-1 text-micro font-black uppercase tracking-[0.15em] mt-1 border-t border-divider first:border-t-0 first:pt-1 text-content-3"
                            >
                                {opt.label}
                            </div>
                        ) : (
                            <button
                                key={opt.value}
                                ref={sIdx >= 0 ? el => { itemRefs.current[sIdx] = el; } : undefined}
                                type="button"
                                id={sIdx >= 0 ? optionId(sIdx) : undefined}
                                role="option"
                                aria-selected={String(value) === String(opt.value)}
                                onClick={() => !opt.disabled && handleSelect(opt.value)}
                                className={`w-full text-left px-3 py-2.5 ${textStyle} whitespace-normal break-words leading-tight rounded-2xl transition-[background-color,color,border-color,box-shadow] duration-[var(--dur-base)] border border-transparent flex items-center gap-2.5 ${
                                    opt.disabled
                                        ? 'opacity-40 cursor-not-allowed bg-transparent text-content-3'
                                        : String(value) === String(opt.value)
                                            ? 'bg-brand text-white shadow-[var(--shadow-glow-brand)]'
                                            : isHighlighted
                                                ? 'bg-brand/[0.08] text-content border-brand/20'
                                                : 'bg-transparent text-content-2 hover:bg-surface-card-hover hover:text-content'
                                }`}
                            >
                                {opt.avatar !== undefined && (
                                    <div className="w-6 h-6 rounded-full overflow-hidden bg-surface-card-hover border border-border-card shrink-0 flex items-center justify-center text-micro font-black text-content-3">
                                        {opt.avatar
                                            ? <img src={opt.avatar} alt={opt.label} className="w-full h-full object-cover" />
                                            : (opt.label || '?').charAt(0).toUpperCase()
                                        }
                                    </div>
                                )}
                                <span className="flex-1 min-w-0">
                                    <span className="block leading-tight">{opt.label}</span>
                                    {opt.sublabel && (
                                        <span className={`block text-caption font-medium leading-tight mt-0.5 ${
                                            String(value) === String(opt.value) && !opt.disabled ? 'text-white/70' : 'text-content-3'
                                        }`}>
                                            {opt.sublabel}
                                        </span>
                                    )}
                                </span>
                            </button>
                        );
                    })
                ) : (
                    <div className="px-4 py-8 text-body-sm font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 text-content-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-surface-card-hover">
                            <Search size={20} strokeWidth={2} />
                        </div>
                        Sin resultados
                    </div>
                )}
                {serverSearch && !searchTerm && !isLoading && (
                    <div className="px-4 pt-1 pb-2 text-caption font-bold text-center text-content-3">
                        Escribe para buscar
                    </div>
                )}
                {creatable && onCreateOption && searchTerm.trim() &&
                    !filteredOptions.some(o => o.label.toLowerCase() === searchTerm.trim().toLowerCase()) && (
                    <button
                        type="button"
                        onClick={() => {
                            onCreateOption(searchTerm.trim());
                            setIsOpen(false);
                            setSearchTerm('');
                        }}
                        className="w-full text-left px-3 py-2.5 text-body-sm font-bold rounded-2xl transition-colors flex items-center gap-2 mt-1 text-success hover:bg-success/10"
                    >
                        <Plus size={12} strokeWidth={3} className="shrink-0" />
                        Agregar: <span className="font-black ml-0.5">{searchTerm.trim()}</span>
                    </button>
                )}
            </div>
        </motion.div>
    );

    // data-surface="input" (mismo token que dropdown/DataTable) va en este
    // mismo div SOLO si no es bare — bare existe para fundirse en la barra
    // del padre sin fondo propio, y data-surface siempre pinta su bg/border/
    // shadow por cascade layers sin importar las clases Tailwind del mismo
    // elemento, así que no puede convivir con "bg-transparent".
    // `outline-solid` explícito: en Tailwind v4 un `outline-2` sin él no pinta
    // nada (ver memoria feedback_tailwind_v4_outline_solid_gotcha). El anillo de
    // foco va con `focus-visible` para que solo aparezca al navegar con teclado.
    const anilloFoco = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
    const pillBaseClasses = `w-full transition-all duration-[var(--dur-slow)] outline-none ${anilloFoco} ${minHeightClass} flex items-center text-content ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    } ${bare ? 'bg-transparent' : ''} ${
        !bare && isOpen ? 'outline-solid outline-1 outline-offset-[-1px] outline-brand/60' : ''
    } ${
        // El foco/apertura gana sobre el error: mientras se está eligiendo, el
        // anillo azul dice dónde está el cursor; el rojo vuelve al cerrar si
        // sigue vacío.
        invalid && !isOpen ? 'outline-solid outline-2 outline-offset-[-1px] outline-danger' : ''
    }`;

    return (
        <div
            // SIN `transform-gpu` (2026-08-09). Ponía `translateZ(0)` PERMANENTE
            // sobre la raíz del select, y un ancestro con transform es backdrop
            // root: el `backdrop-filter` del `[data-surface="input"]` de adentro
            // no se ejecutaba en ninguno de los 173 selects del portal. El lift
            // lo sigue dando `hover:translate-y`, que sólo pone transform
            // mientras el puntero está encima; en reposo —que es como se ve el
            // 99% del tiempo— el vidrio ahora vive.
            className={`relative group w-full transition-transform duration-[var(--dur-slow)] ${(!isOpen && !disabled && !bare) ? 'hover:translate-y-[var(--lift-hover)]' : ''}`}
            ref={selectRef}
        >
            {/* ICONO IZQUIERDO — omitido en nano (steppers/grillas densas sin espacio) */}
            {!nano && (
                <div className={`absolute ${leftIconPos} top-1/2 -translate-y-1/2 rounded-xl flex items-center justify-center transition-colors duration-[var(--dur-slow)] z-base pointer-events-none ${isOpen
                        ? 'text-white bg-brand shadow-sm'
                        : bare
                            ? 'bg-transparent text-brand-text'
                            : 'bg-surface-card-hover text-brand-text border border-border-card shadow-sm'
                    }`}>
                    {isOpen ? <Search size={iconSize} strokeWidth={2.5} /> : (Icon ? <Icon size={iconSize} strokeWidth={2.5} /> : <Search size={iconSize} strokeWidth={2.5} />)}
                </div>
            )}

            {/* CONTENEDOR PRINCIPAL
                Ghost-sizer pattern: the display div is always in flow (determines width).
                When open, it stays invisible so the container width doesn't change.
                The search input is layered on top via absolute positioning.           */}
            <div
                {...(!bare ? { 'data-surface': 'input' } : {})}
                className={`${pillBaseClasses} relative`}
                ref={triggerRef}
                onClick={handleOpen}
                onKeyDown={handleTriggerKeyDown}
                tabIndex={disabled ? -1 : 0}
                role="combobox"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-haspopup="listbox"
                aria-disabled={disabled || undefined}
                // El rojo solo se ve; esto lo hace audible para un lector de
                // pantalla, que es la mitad que faltaba del estado de error.
                aria-invalid={invalid || undefined}
                aria-expanded={isOpen}
                aria-controls={isOpen ? listboxId : undefined}
                aria-activedescendant={isOpen && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
            >
                {/* Always-rendered display content — keeps container width stable */}
                <div className={`w-full ${nano ? 'text-center justify-center' : 'text-left'} ${textStyle} ${paddingStyle} whitespace-nowrap leading-tight flex items-center gap-2
                    ${isOpen && !sinBuscador ? 'invisible pointer-events-none select-none' : ''}
                    ${!selectedOption && (!isOpen || sinBuscador) ? 'text-content-3' : ''}`}>
                    {selectedOption ? (
                        <>
                            {selectedOption.avatar !== undefined && (
                                <div className="w-6 h-6 rounded-full overflow-hidden bg-surface-card-hover border border-border-card shrink-0 flex items-center justify-center text-micro font-black text-content-3">
                                    {selectedOption.avatar
                                        ? <img src={selectedOption.avatar} alt={selectedOption.label} className="w-full h-full object-cover" />
                                        : (selectedOption.label || '?').charAt(0).toUpperCase()
                                    }
                                </div>
                            )}
                            <span className="flex-1 min-w-0">
                                <span className="block leading-tight truncate" title={selectedOption.label}>{selectedOption.label}</span>
                                {selectedOption.sublabel && (
                                    <span className="block text-caption font-medium leading-tight mt-0.5 truncate text-content-3">
                                        {selectedOption.sublabel}
                                    </span>
                                )}
                            </span>
                        </>
                    ) : placeholder}
                </div>

                {/* Search input — overlaid absolutely when open.
                    Con la hoja táctil NO va: el buscador es el de la hoja, y este
                    quedaría invisible detrás capturando el foco. */}
                {isOpen && !usaHoja && !sinBuscador && (
                    <input
                        ref={inputRef}
                        type="text"
                        aria-label={ariaLabel ?? placeholder}
                        className={`absolute inset-0 w-full bg-transparent border-none outline-none ${nano ? 'text-center' : ''} ${textStyle} ${paddingStyle} text-content placeholder:text-content-3`}
                        onChange={(e) => {
                            const val = e.target.value;
                            setSearchTerm(val);
                            if (onSearchChange) {
                                clearTimeout(searchDebounceRef.current);
                                searchDebounceRef.current = setTimeout(() => onSearchChange(val), 300);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlightedIndex(i => {
                                    const next = i + 1;
                                    return next >= selectableOptions.length ? 0 : next;
                                });
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlightedIndex(i => {
                                    const next = i - 1;
                                    return next < 0 ? selectableOptions.length - 1 : next;
                                });
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                if (highlightedIndex >= 0 && selectableOptions[highlightedIndex]) {
                                    handleSelect(selectableOptions[highlightedIndex].value);
                                }
                            }
                        }}
                        value={searchTerm}
                        placeholder="Buscar..."
                    />
                )}
            </div>

            {/* BOTÓN DERECHO */}
            {value && clearable && !isOpen ? (
                <button
                    type="button"
                    onClick={handleClear}
                    className={`absolute ${rightIconPos} ${clearTap} top-1/2 -translate-y-1/2 z-base outline-none p-1 cursor-pointer flex items-center justify-center active:scale-[0.9] transition-transform duration-[var(--dur-fast)] ${areaTocable}`}
                    title="Quitar selección"
                >
                    <div className="w-full h-full rounded-full flex items-center justify-center transition-colors duration-[var(--dur-slow)] group-hover:shadow-sm bg-danger/10 hover:bg-danger-solid text-danger hover:text-white">
                        <X size={12} strokeWidth={3} className="transition-transform duration-[var(--dur-slow)] hover:rotate-90" />
                    </div>
                </button>
            ) : (
                // El chevron abre lo MISMO que el disparador principal, que ya
                // lleva `aria-haspopup="listbox"` y `aria-expanded`. Sin
                // `aria-hidden`, un lector de pantalla anunciaría dos controles
                // para una sola acción y el teclado pararía dos veces. Mismo
                // criterio que el chevron de AttendanceAuditView.
                <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={handleToggle}
                    className={`absolute ${rightIconPos} top-1/2 -translate-y-1/2 z-base outline-none p-0.5 cursor-pointer flex items-center justify-center active:scale-[0.9] transition-transform duration-[var(--dur-fast)] ${areaTocable}`}
                >
                    <div className={`w-full h-full rounded-full flex items-center justify-center transition-colors duration-[var(--dur-slow)] ${isOpen
                            ? 'bg-brand/[0.12]'
                            : 'bg-transparent group-hover:bg-surface-card-hover hover:bg-surface-card-hover'
                        }`}>
                        <ChevronDown size={iconSize} strokeWidth={3} className={`transition-transform duration-[var(--dur-slow)] ${isOpen
                                ? 'rotate-180 text-brand-text'
                                : 'text-content-3'
                            }`} />
                    </div>
                </button>
            )}

            {usaHoja ? (
                <SelectorTactil
                    open={isOpen}
                    onClose={() => { setIsOpen(false); setSearchTerm(''); }}
                    options={options.filter(o => !o.isSeparator && o.value !== '')}
                    value={value}
                    onChange={handleSelect}
                    title={ariaLabel || placeholder}
                    // El placeholder del select es el RÓTULO del campo
                    // ("Laboratorio"); dentro de la hoja el campo es un buscador y
                    // tiene que decir qué hace, no cómo se llama el filtro.
                    placeholder="Buscar..."

                    serverSearch={serverSearch}
                    onSearchChange={onSearchChange}
                    isLoading={isLoading}
                    clearable={clearable}
                    clearLabel={clearLabel}
                />
            ) : createPortal(
                <AnimatePresence>{isOpen ? dropdownContent : null}</AnimatePresence>,
                document.body
            )}
        </div>
    );
};

export default LiquidSelect;
