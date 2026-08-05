import React, { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import useLayoutCompacto from '../../hooks/useLayoutCompacto';
import Contador from './Contador';
import ModalShell from './ModalShell';
import HojaMovil, { MATERIAL_HOJA, MATERIAL_CLUSTER } from './HojaMovil';

/**
 * BarraFlotante — los controles de la vista, al alcance del pulgar. Solo táctil.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 * En una vista de captura larga —el conteo son 2,500 renglones— los controles
 * viven arriba: se llega a ellos volviendo al principio de la página. En
 * escritorio no molesta porque el filtro está a la vista con la tabla; en un
 * teléfono, después de tres pantallas de scroll el filtro y el botón de agregar
 * ya no existen.
 *
 * ── Anatomía: un clúster de íconos, no una barra de borde a borde ──────────
 * Elegida sobre cinco alternativas mockupeadas. Gana porque es la más compacta
 * (94px con rótulos, pegada a la derecha) y por lo tanto la que menos lista
 * tapa, que en una
 * pantalla de captura es lo que más importa.
 *
 * Dos reglas la sacan de ser el antipatrón de "tres íconos iguales":
 *
 * 1. **La acción principal se ve distinta.** Rellena y más grande. Crea algo;
 *    las otras dos ABREN algo. Dibujarlas iguales las hace leer como una familia
 *    de pares cuando una es la principal.
 * 2. **Los disclosures llevan su estado.** Un ícono dice dónde está el control,
 *    no qué está aplicado — y "verlos siempre" era justamente el pedido. Así que
 *    el buscador abre un campo que muestra el término, y las acciones llevan
 *    `Contador`. Sin esto la barra muestra la puerta y esconde el contenido.
 *
 * El costo que no se puede diseñar afuera: **lupa y filtros significan casi lo
 * mismo** para quien está contando — los dos son "achicar la lista". Cuesta un
 * toque perdido cada tanto, y es el precio de ser la más compacta.
 *
 * ── El orden: la acción primero, el buscador último ───────────────────────
 * `principal · acciones · buscador`, y no al revés como estaba. Lo que más se
 * toca queda bajo el pulgar; lo que abre teclado se va al extremo, porque un
 * toque accidental ahí cuesta media pantalla de teclado.
 *
 * ── El campo sube ENCIMA de la barra (2026-07-30) ──────────────────────────
 * Antes se estiraba DENTRO del clúster: el campo crecía y los otros botones se
 * iban, así que buscar y filtrar eran excluyentes. Ahora es una fila propia
 * arriba y los cuatro botones se quedan.
 *
 * Se eligió sobre cuatro variantes con maqueta. La descartada de cerca era el
 * campo pegado al ENCABEZADO de la pantalla: el teclado ocupa la mitad de abajo,
 * así que el dedo teclea abajo y el ojo tiene que saltar ~500px en cada letra —
 * justo a la zona que el pulgar no alcanza. Arriba de la barra el texto sale a
 * dos dedos de donde se escribe.
 *
 * Y el campo NO es una hoja: mientras se escribe hay que ver la lista
 * filtrarse, o no se sabe cuándo parar de teclear. Los filtros sí van en hoja,
 * porque se aplican y se cierran.
 *
 * Queda expandido mientras tenga texto, así que el término sigue visible con el
 * teclado cerrado, que era el requisito.
 *
 * ── Va por portal al `body`, y no es un detalle ────────────────────────────
 * Un `position: fixed` dentro de un ancestro con `transform`, `filter` o
 * `z-index` propio queda contenido por ese ancestro y deja de estar pegado al
 * viewport. Este proyecto ya se tropezó con eso: el comentario de la nav inferior
 * de `AppLayout` dice textual *"hermano directo del root (SIN ancestros con
 * z-index/overflow que creen contexto de apilamiento — el fixed anidado era lo
 * que standalone no pintaba)"*.
 *
 * ── El corte lo decide `useLayoutCompacto`, no un ancho ────────────────────
 * Y tiene que ser EL MISMO que usa `FilterBar`: si divergen queda una franja
 * con las dos cosas visibles, o ninguna. Estaban sincronizados a mano, cada uno
 * con su copia de `(max-width: 719px)` — o sea sincronizados hasta que alguien
 * tocara uno. Ahora los dos llaman al mismo hook.
 *
 * Y ese hook ya no pregunta solo por el ancho: un teléfono ACOSTADO mide 844px
 * y caía del lado de escritorio, así que girar el teléfono hacía desaparecer
 * este clúster y devolvía la barra de mouse a una pantalla que se maneja con el
 * pulgar. El razonamiento completo vive en `useLayoutCompacto`.
 *
 * ── `z-tabs` (30), y antes estaba mal en `z-header` (2026-07-30) ───────────
 * Es cromo de la vista, no un diálogo: va DEBAJO de cualquier hoja que se abra
 * desde ella (`z-modal` = 100) y encima del encabezado pegajoso de una tabla
 * (`z-base` = 10). `z-tabs` es, textualmente, la capa de "tab bars / floating
 * pills" en la escala de §9 — o sea esto.
 *
 * Estaba en `z-header` (40), que es la capa del **scrim del sidebar**. Con el
 * mismo z-index gana el orden del DOM, y como esta barra va por portal al final
 * del `body` quedaba ENCIMA: al abrir el menú se atenuaba la vista entera y el
 * clúster seguía brillando arriba de todo. Lo reportó el usuario.
 *
 * ── Y se aparta de la nav inferior ─────────────────────────────────────────
 * En las vistas de autogestión (`hasSelfOnly`) `AppLayout` dibuja una nav fija
 * abajo, en el mismo sitio que esta barra. `--alto-nav-inferior` lo publica ese
 * layout —vale `0px` donde no hay nav—, así que la barra se sube justo lo que
 * mide y no hay que enterarse de nada desde acá. "Mis Documentos" es
 * exactamente ese caso: autogestión y con `FilterBar`.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <BarraFlotante
 *       buscador={{ value: q, onChange: setQ, placeholder: 'Buscar…' }}
 *       acciones={[{ key: 'filtros', icon: SlidersHorizontal, label: 'Filtros',
 *                    badge: 2, panel: <>…controles…</>, tituloPanel: 'Filtros' }]}
 *       principal={{ icon: Plus, label: 'Agregar', onClick: abrir }}
 *   />
 */

// Cuánto hay que mover el dedo para que la barra reaccione. Sin umbral, el
// rebote elástico de iOS y cualquier micro-scroll la hacen titilar.
// El material lo define `HojaMovil`, que es el canónico de la capa móvil, y son
// DOS: `MATERIAL_CLUSTER` para esta barra —que flota sobre la vista y por eso
// se queda en vidrio— y `MATERIAL_HOJA` para lo que despliega, que es donde se
// lee y necesita tapar lo de atrás. Vivían en una sola constante y el motivo
// escrito era bueno para el color, pero escondía que no hacen lo mismo.

const UMBRAL = 8;
// Arriba de la página nunca se esconde: si el usuario está en el principio, no
// está leyendo hacia abajo, está por empezar.
const ZONA_SEGURA = 96;
// Arriba de esto, el desplazamiento no lo hizo un dedo: es una restauración de
// posición o un `scrollIntoView`. Un flick real reparte el recorrido en muchos
// eventos de pocas decenas de píxeles.
const SALTO = 120;
// Cuánto hay que bajar, acumulado, para que la barra se aparte.
//
// Es una FRACCIÓN de la pantalla y no un número fijo, y eso importa en un
// teléfono: ahí un flick corto arrastra inercia y recorre 150-300px sin que la
// persona sienta que hizo "un scroll grande". Con 70px fijos la barra se iba con
// medio toque —reportado dos veces— porque el gesto mínimo del sistema ya los
// supera. Media pantalla es un recorrido que se hizo a propósito.
const FRACCION_OCULTAR = 0.35;

const BarraFlotante = memo(({
    buscador = null,
    acciones = [],
    principal = null,
    // Quita los filtros de la vista. El clúster le agrega el término del
    // buscador y dibuja el botón **último**, solo cuando hay algo que quitar.
    // Va al final y no entre medio porque abarca todo lo que tiene a su
    // izquierda —la búsqueda incluida—, así que cierra la fila en vez de
    // partirla en dos.
    alLimpiar = null,
    autoOcultar = true,
    // Los rótulos bajo los íconos aparecen solos cuando hay MÁS DE UN botón: con
    // uno solo el ícono no compite con nada y el rótulo es ruido. Se puede forzar.
    mostrarRotulos,
    ariaLabel = 'Acciones de la vista',
}) => {
    const compacto = useLayoutCompacto();
    const [visible, setVisible] = useState(true);
    // ¿Este `FilterBar` está realmente en pantalla? Medido el 2026-07-30 en
    // Productos: sus tabs se montan TODOS y se ocultan con `hidden`, así que había
    // **tres** clústeres apilados uno sobre otro — el portal al `body` los saca del
    // subárbol oculto, que es justo lo que los hacía visibles. El ancla vive en el
    // flujo normal, donde sí la alcanza el `display:none` del tab.
    const [enPantalla, setEnPantalla] = useState(true);
    const anclaRef = useRef(null);
    const [abierta, setAbierta] = useState(null);   // key de la acción con panel abierto
    const [buscando, setBuscando] = useState(false);
    const ultimaY = useRef(0);
    const bajado = useRef(0);
    const inputRef = useRef(null);

    // ── La barra le avisa al layout cuánto ocupa ──────────────────────────
    // Está en `position: fixed`, así que no empuja nada: el final de la lista
    // quedaba DEBAJO del clúster y las últimas filas eran inalcanzables. El
    // contenedor de scroll de `GlassViewLayout` suma esta variable a su relleno
    // inferior. Se mide, no se estima: el alto cambia con los rótulos, con el
    // campo de búsqueda abierto y con el área segura del teléfono.
    const clusterRef = useRef(null);
    useLayoutEffect(() => {
        const raiz = document.documentElement;
        const el = clusterRef.current;
        if (!compacto || !enPantalla || !el) {
            raiz.style.setProperty('--alto-barra-flotante', '0px');
            return undefined;
        }
        const medir = () => raiz.style.setProperty(
            '--alto-barra-flotante', `${Math.round(el.getBoundingClientRect().height)}px`);
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => { ro.disconnect(); raiz.style.setProperty('--alto-barra-flotante', '0px'); };
    }, [compacto, enPantalla]);

    // El espejo de `campoAbierto` para `marcarBuscar`. En un efecto y no en el
    // cuerpo del render: escribir un ref durante el render es lo que marca
    // `react-hooks`, y acá no hace falta — el valor solo se lee dentro de un
    // manejador de eventos, que siempre corre después de pintar.
    useEffect(() => { abiertoRef.current = !!buscador && buscando; });

    useEffect(() => {
        if (!compacto || !autoOcultar) return undefined;
        ultimaY.current = window.scrollY;
        let pendiente = false;
        const alScrollear = () => {
            if (pendiente) return;
            pendiente = true;
            // Una lectura por frame: el handler se dispara docenas de veces por
            // gesto y `scrollY` fuerza layout.
            requestAnimationFrame(() => {
                pendiente = false;
                const y = window.scrollY;
                const dy = y - ultimaY.current;
                if (Math.abs(dy) < UMBRAL) return;
                ultimaY.current = y;
                // Un SALTO no es un gesto. Al cerrar una hoja, el bloqueo de
                // scroll restaura la posición con `scrollTo`, y eso llega acá como
                // un desplazamiento de cientos de píxeles en un solo evento: la
                // barra lo leía como "el usuario bajó" y se escondía justo al
                // cerrar. Un dedo produce muchos deltas chicos; un salto produce
                // uno enorme. Se ignora, y la barra se queda donde estaba.
                if (Math.abs(dy) > SALTO) return;
                // Subir la muestra SIEMPRE; bajar solo cuando el recorrido es de
                // verdad. Con el umbral de 8px, medio toque hacia abajo ya la
                // escondía —reportado—, y una barra que parpadea con cada micro
                // gesto es peor que una que se queda. Acumular hasta `OCULTAR`
                // hace que haga falta un desplazamiento intencional.
                if (y < ZONA_SEGURA || dy < 0) { bajado.current = 0; setVisible(true); return; }
                bajado.current += dy;
                if (bajado.current >= window.innerHeight * FRACCION_OCULTAR) {
                    bajado.current = 0; setVisible(false);
                }
            });
        };
        window.addEventListener('scroll', alScrollear, { passive: true });
        return () => window.removeEventListener('scroll', alScrollear);
    }, [compacto, autoOcultar]);

    // `IntersectionObserver` y no un chequeo puntual: cambiar de tab no desmonta
    // nada, solo alterna `display`, así que hace falta enterarse en los dos
    // sentidos. Un elemento en `display:none` no intersecta, que es la señal.
    useEffect(() => {
        const ancla = anclaRef.current;
        if (!compacto || !ancla) return undefined;
        const obs = new IntersectionObserver(
            ([e]) => setEnPantalla(e.isIntersecting || e.boundingClientRect.height > 0),
            { threshold: 0 },
        );
        obs.observe(ancla);
        return () => obs.disconnect();
    }, [compacto]);

    // ── El botón de buscar ALTERNA ────────────────────────────────────────
    // Antes solo abría, y el campo se quedaba abierto para siempre mientras
    // tuviera texto (`campoAbierto = buscando || conTexto`): la única salida era
    // borrar el término, o sea que para dejar de ver el campo había que perder
    // el filtro. Ahora se cierra con el mismo botón que lo abrió y el término
    // sigue aplicado — lo dice el indicador del botón, que es la pieza que
    // faltaba para que cerrarlo no signifique perderlo de vista.
    //
    // El estado se lee de un ref y no del render: `blur` llega ANTES que
    // `click`, así que si el campo se cerrara por perder el foco, el `onClick`
    // vería "cerrado" y volvería a abrirlo — el botón nunca podría cerrar. Se
    // anota en `pointerdown`, que sí corre antes de que el foco se mueva.
    const abiertoRef = useRef(false);
    const tocadoAbierto = useRef(false);
    const marcarBuscar = useCallback(() => { tocadoAbierto.current = abiertoRef.current; }, []);
    const alternarBusqueda = useCallback(() => {
        if (tocadoAbierto.current) { setBuscando(false); return; }
        setBuscando(true);
        // El foco va después del render, o el navegador no levanta el teclado.
        setTimeout(() => inputRef.current?.focus(), 60);
    }, []);

    // Limpia TODO: los filtros de la vista y el término del buscador. El texto
    // del buscador es un filtro más —por eso el botón lleva indicador—, y un
    // "limpiar" que dejara el término puesto mostraría el clúster diciendo "sin
    // filtros" y "con búsqueda" al mismo tiempo.
    const limpiarTodo = useCallback(() => {
        alLimpiar?.();
        buscador?.onChange?.('');
        setBuscando(false);
    }, [alLimpiar, buscador]);

    // El ancla se renderiza SIEMPRE en el flujo (1px, invisible): es lo que sabe
    // si esta instancia está en un tab oculto. Sin ella no hay forma de
    // distinguir "montado" de "en pantalla".
    const ancla = <span ref={anclaRef} aria-hidden="true" className="block w-px h-px" />;

    if (!compacto) return null;
    if (!enPantalla) return ancla;

    const conTexto = !!buscador?.value;
    // `buscando` a secas, sin `|| conTexto`: con el término abierto por tener
    // texto, el botón no podía cerrarlo. Que el filtro siga aplicado con el
    // campo cerrado lo comunica el indicador.
    const campoAbierto = !!buscador && buscando;
    // Hay algo que limpiar si el buscador tiene texto o alguna acción muestra
    // cuenta. Se pregunta por el `badge` en vez de recibir un `activeCount`
    // propio: es el MISMO número que ya se dibuja en el clúster, así que el
    // botón no puede contradecir a lo que se ve.
    const hayQueLimpiar = !!alLimpiar && (conTexto || acciones.some((a) => a.badge > 0));
    const botones = (buscador ? 1 : 0) + acciones.length + (principal ? 1 : 0) + (hayQueLimpiar ? 1 : 0);
    const rotulos = mostrarRotulos ?? botones > 1;
    const panelAbierto = acciones.find((a) => a.key === abierta && a.panel);

    return (
        <>
            {ancla}
            {createPortal(
                <BarraPortal
                    ariaLabel={ariaLabel}
                    visible={visible || campoAbierto}
                    campoAbierto={campoAbierto}
                    conTexto={conTexto}
                    buscador={buscador}
                    inputRef={inputRef}
                    setBuscando={setBuscando}
                    alternarBusqueda={alternarBusqueda}
                    marcarBuscar={marcarBuscar}
                    limpiarTodo={hayQueLimpiar ? limpiarTodo : null}
                    acciones={acciones}
                    principal={principal}
                    clusterRef={clusterRef}
                    rotulos={rotulos}
                    setAbierta={setAbierta}
                    panelAbierto={panelAbierto}
                />,
                document.body,
            )}
        </>
    );
});

/** El árbol que va al `body`. Separado solo para que el guard de arriba se lea. */
const BarraPortal = ({
    ariaLabel, visible, campoAbierto, conTexto, buscador, inputRef, setBuscando,
    alternarBusqueda, marcarBuscar, limpiarTodo, acciones, principal, rotulos,
    setAbierta, panelAbierto, clusterRef,
}) => {
    return (
        <>
            {/* ── El contenedor NO se transforma. Es el bug del vidrio ──────────
                Esta capa animaba la entrada y salida con `translate-y-0` /
                `translate-y-[135%]`, y eso rompía el `backdrop-filter` del
                clúster de adentro: un ancestro con `transform`/`translate`
                establece un *backdrop root*, así que el hijo muestreaba un fondo
                VACÍO y no difuminaba nada. El clúster quedaba plano — el usuario
                lo reportó como "el liquidglass del filterpill no es liquidglass,
                no se ve a través de él como el header u otra card".

                Es la tercera vez que este proyecto se tropieza con la misma
                regla. Y explica el rodeo anterior: al probar `data-surface="card"`
                (16%) "el nombre del producto se leía a través del clúster" —claro,
                sin blur el 16% es literalmente ver el texto—, y se subió a
                `dropdown` (72%) para taparlo. La opacidad nunca fue el problema.

                El arreglo es mover la animación al elemento que lleva el vidrio:
                un `transform` PROPIO no crea backdrop root, solo uno ANCESTRO.
                Es exactamente por eso que el vidrio de `ViewTabBar` sí funciona
                teniendo `transform-gpu` en el mismo div que su `data-surface`. */}
            <div
                ref={clusterRef}
                role="toolbar"
                aria-label={ariaLabel}
                // ── El relleno lateral reserva el NOTCH ───────────────────
                // Era `px-3` fijo. De pie da igual —`safe-area-inset-left/right`
                // valen 0—, pero **acostado el notch se come ~59px de un
                // costado** y el clúster quedaba a 12px del borde, o sea debajo
                // del hardware: medido, el último botón se metía 40px en la
                // banda. `viewport-fit=cover` ya estaba puesto, así que la app
                // dibuja ahí abajo; lo que faltaba era reservar el sitio.
                //
                // Con `max()` y no a secas: donde el inset es 0 tiene que quedar
                // el margen de siempre, no cero.
                //
                // `display` por variable y no por clase: quien sabe si hay un
                // overlay global abierto es `AppLayout`, y esta barra cuelga del
                // `body` por portal, así que no es descendiente suya. El valor por
                // defecto es `flex` para que fuera de `AppLayout` —o antes del
                // primer efecto— la barra se dibuje igual.
                className="fixed inset-x-0 bottom-0 z-tabs
                    pt-2
                    pl-[max(12px,env(safe-area-inset-left))]
                    pr-[max(12px,env(safe-area-inset-right))]
                    pb-[calc(var(--alto-nav-inferior,0px)+max(12px,env(safe-area-inset-bottom)))]
                    [display:var(--barra-flotante-display,flex)] flex-col items-end gap-2 pointer-events-none"
            >
                {/* El clúster: una sola pieza con su propio material, para que los
                    controles no compitan con el texto de la lista que pasa por
                    detrás. `items-start` para que los rótulos queden alineados
                    aunque el botón principal sea más alto. */}
                {/* `data-surface` y NO `bg-surface-card border border-border-card`.
                    Es la lección que este proyecto ya tiene escrita en
                    GlassViewLayout: el MATERIAL —fondo, borde, sombra, radio y sobre
                    todo `backdrop-filter`— lo aplica `data-surface` en index.css. Las
                    clases Tailwind solo dan el color de fondo, así que con
                    `bg-surface-card` el clúster salía SIN vidrio: translúcido, no glass.

                    ── EN PRUEBA (2026-07-30): la superficie es `card`. ────────
                    El usuario reportó que el clúster "no se ve que sea
                    liquidglass". Tiene fundamento: el 72% de `dropdown` se subió
                    para tapar un blur que estaba MUERTO por el bug del ancestro
                    con `transform` —lo dice la nota de abajo— y una vez arreglado
                    el blur nadie volvió a bajar la opacidad. O sea que el valor
                    actual compensa un problema que ya no existe.

                    A/B medido en Chromium sobre la lista de productos a 430px
                    (headless WebKit NO rasteriza `backdrop-filter`, así que ahí
                    la comparación no vale): con `card` se ve la fila pasar por
                    detrás como color, con `dropdown` queda apenas un fantasma.

                    **Para revertir: cambiar esta línea a `dropdown`.** Nada más.
                    La contraevidencia sigue abajo y sigue siendo válida —es de
                    otra vista, con texto más grueso—, así que si molesta ahí, se
                    vuelve.

                    ── La medición que eligió `dropdown` en su momento ──────────
                    Con el blur ya vivo se compararon las tres superficies
                    existentes sobre la lista de EMPLEADOS, a 390px y con las
                    filas pasando por detrás:

                      · `card` (16%)     "SALUD 2" se lee ENTERO y cae encima de
                                         "ACCIONES". Es vidrio, pero ilegible.
                      · `dropdown` (72%) lo de atrás queda como un fantasma y los
                                         rótulos del clúster se leen limpios.
                      · `modal` (85%)    ya no deja ver nada; es un panel.

                    Esa medición es la que hay que releer si `card` molesta: en
                    Personal los nombres son texto grueso en mayúsculas y a 16%
                    asoman. En Productos no pasa. El criterio que index.css fija
                    para lo que flota sobre contenido —que lo de atrás sea LUZ, no
                    texto— es el que decide el empate.

                    NO agregar una superficie nueva para esto: la paleta es cerrada.

                    La animación de entrada/salida vive ACÁ y no en el contenedor: un
                    `transform` propio no rompe el `backdrop-filter`, uno ancestro sí.
                    `transition-transform` de Tailwind v4 cubre `translate` además de
                    `transform` —son propiedades independientes y `translate-y-*`
                    compila a la segunda—, así que sin esa clase la barra saltaría en
                    vez de deslizarse. `dropdown` no declara `transition` propia en
                    index.css, así que acá la utilidad manda sin pelearse con nada.

                    Al buscar toma todo el ancho en vez de ajustarse al contenido, así
                    el campo se queda con lo que sobra sin mover los otros dos. */}
                {/* ── El campo: fila PROPIA, encima del clúster ────────────
                    Antes se estiraba dentro del clúster y expulsaba a los otros
                    botones. Acá los cuatro se quedan donde estaban: se puede
                    buscar y tocar "Filtros" sin cerrar nada.

                    Y va ARRIBA de la barra, no arriba de la PANTALLA, que era la
                    otra variante sobre la mesa. El teclado ocupa la mitad de
                    abajo: con el campo pegado al encabezado, el dedo teclea abajo
                    y el ojo tiene que saltar ~500px en cada letra, justo a la
                    zona que el pulgar no alcanza. Acá el texto sale a dos dedos
                    de donde se escribe. */}
                {buscador && campoAbierto && (
                    <div
                        data-surface="dropdown"
                        className="pointer-events-auto w-full flex items-center gap-1.5 h-12 px-3 shadow-lg
                            animate-in fade-in slide-in-from-bottom-2 duration-200
                            ease-[var(--ease-spring)]"
                    >
                        <Search size={15} strokeWidth={2.5} className="text-brand-text shrink-0" />
                        <input
                            ref={inputRef}
                            // `text` y no `search`: WebKit le dibuja al segundo su
                            // PROPIA ✕ de limpiar, así que salían dos —la nativa
                            // gris y la del portal—. Es la regla cero-nativo: el
                            // cromo del navegador no se estiliza, se evita.
                            // `inputMode="search"` conserva la tecla Buscar del
                            // teclado sin traer la decoración.
                            type="text"
                            inputMode="search"
                            value={buscador.value}
                            onChange={(e) => buscador.onChange?.(e.target.value)}
                            // Se cierra al perder el foco SOLO si está vacío. Con
                            // texto, cerrarlo por un toque en cualquier otra
                            // parte se llevaría de la vista un filtro que sigue
                            // aplicado; y como el campo ya no depende de tener
                            // texto para quedarse abierto, la única forma de
                            // cerrarlo sería borrar el término. Vacío no hay nada
                            // que perder, así que ahí sí se recoge solo.
                            onBlur={() => { if (!buscador.value) setBuscando(false); }}
                            placeholder={buscador.placeholder || 'Buscar...'}
                            aria-label={buscador.placeholder || 'Buscar'}
                            // 16px como mínimo: por debajo, iOS hace zoom al enfocar
                            // y descuadra toda la vista (DESIGN.md §32).
                            className="flex-1 min-w-0 bg-transparent border-none outline-none
                                text-body-xl font-bold text-content placeholder:text-content-3"
                        />
                        {conTexto && (
                            <button type="button" aria-label="Limpiar la búsqueda"
                                onClick={() => { buscador.onChange?.(''); setBuscando(false); }}
                                className="w-8 h-8 -mr-1 shrink-0 rounded-full flex items-center justify-center
                                    text-danger-text hover:bg-danger/15 transition-colors duration-150">
                                <X size={14} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                )}

                <div
                    data-surface={MATERIAL_CLUSTER}
                    className={`pointer-events-auto flex items-start gap-1.5 p-1.5 shadow-lg
                        transition-transform duration-200 ease-out
                        max-w-full
                        ${visible || campoAbierto ? 'translate-y-0' : 'translate-y-[135%]'}`}
                >

                    {principal && (
                        <Boton
                            icon={principal.icon}
                            label={principal.label}
                            rotulo={rotulos}
                            principal
                            onClick={principal.onClick}
                        />
                    )}

                    {acciones.map((a) => (
                        <Boton
                            key={a.key}
                            icon={a.icon}
                            label={a.label}
                            rotulo={rotulos}
                            badge={a.badge}
                            activo={a.activo ?? (a.badge > 0)}
                            // Solo las que abren hoja: una acción que dispara y
                            // se va no tiene nada que expandir, y anunciar
                            // `aria-expanded="false"` en ella prometería un
                            // panel que no existe.
                            expandido={a.panel ? panelAbierto?.key === a.key : undefined}
                            // El origen de la gota ya no se mide acá: lo lee
                            // `useGotaApertura` del último toque global, así que
                            // vale para TODO diálogo y no solo para esta barra.
                            onClick={() => (a.panel ? setAbierta(a.key) : a.onClick?.())}
                        />
                    ))}

                    {buscador && (
                        <Boton
                            icon={Search}
                            label="Buscar"
                            aria={campoAbierto ? 'Cerrar el campo de búsqueda'
                                : conTexto ? `Abrir la búsqueda — filtrando por "${buscador.value}"`
                                    : 'Buscar'}
                            expandido={campoAbierto}
                            rotulo={rotulos}
                            // Encendido mientras el campo esté abierto **o**
                            // haya un término aplicado: cerrar el campo no
                            // apaga el filtro, así que tampoco puede apagar el
                            // botón.
                            activo={campoAbierto || conTexto}
                            // Un PUNTO y no una cuenta: un término de búsqueda
                            // no se cuenta, está o no está. `Contador` con un
                            // "1" ahí adentro diría "un resultado" o "un filtro
                            // de búsqueda", dos cosas que no son.
                            punto={conTexto && !campoAbierto}
                            onPointerDown={marcarBuscar}
                            onClick={alternarBusqueda}
                        />
                    )}

                    {/* ── LIMPIAR, al final ────────────────────────────────
                        Último y no entre medio: quita todo lo que está a su
                        izquierda —los filtros y el término del buscador—, así
                        que cerrando la fila se lee como el alcance que tiene.
                        Metido entre BUSCAR y FILTROS parecería pertenecer a uno
                        de los dos.

                        Y solo aparece cuando hay algo que quitar: un botón de
                        limpiar permanentemente inerte ocupa una columna de las
                        cinco que caben, y enseña que no hace nada. */}
                    {limpiarTodo && (
                        <Boton
                            icon={X}
                            label="Limpiar"
                            aria="Quitar todos los filtros y la búsqueda"
                            rotulo={rotulos}
                            tono="danger"
                            onClick={limpiarTodo}
                        />
                    )}
                </div>
            </div>

            {/* El panel de una acción: hoja inferior. Los filtros se aplican y se
                cierran, así que atenuar la lista no molesta — al contrario, enfoca. */}
            {acciones.some((a) => a.panel) && (
                <ModalShell
                    open={!!panelAbierto}
                    onClose={() => setAbierta(null)}
                    align="bottom"
                    maxWidthClass="max-w-none"
                    surface={null}
                    ariaLabel={panelAbierto?.tituloPanel || panelAbierto?.label || 'Panel'}
                >
                    {/* `HojaMovil` y no el asa + título + relleno a mano que había
                        acá (2026-07-30). Esta hoja fue el MODELO al que se mandó
                        igualar el resto de los modales, y sin embargo era la única
                        que seguía escrita a mano: mismo asa, mismo título, misma
                        área segura, duplicados. Si el canónico nació de copiar
                        esto, esto tiene que ser lo primero en usarlo. */}
                    <HojaMovil
                        titulo={panelAbierto?.tituloPanel || panelAbierto?.label}
                        superficie={MATERIAL_HOJA}
                    >
                        {panelAbierto?.panel}
                    </HojaMovil>
                </ModalShell>
            )}
        </>
    );
};

/**
 * Un botón del clúster. `principal` lo hace relleno y más grande — es lo que
 * distingue "esto crea algo" de "esto abre algo".
 *
 * El rótulo va DEBAJO del ícono y no en un `title`: en táctil no hay hover, así
 * que un `title` no existe. Igual se emite `aria-label` porque el rótulo puede
 * estar apagado (un solo botón).
 */
const Boton = memo(({ icon: Icono, label, aria, expandido, rotulo, badge, punto, activo, tono,
    principal, onClick, onPointerDown }) => (
    <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        // `aria` separado del rótulo: el rótulo tiene 60px y por eso es un verbo
        // suelto ("LIMPIAR", "BUSCAR"), pero quien no ve el clúster no tiene el
        // contexto que hace que ese verbo alcance. Sin esto, "Limpiar" no dice
        // qué limpia y "Buscar" no dice que además cierra.
        aria-label={aria || label}
        // Solo donde el botón ABRE algo que se queda: es lo que convierte
        // "Buscar" en un interruptor y no en una acción suelta.
        aria-expanded={expandido}
        // Ancho por columna, pero ELÁSTICO entre 44 y 60px. Era fijo en 60 con
        // `shrink-0`, y eso alcanzaba mientras el clúster no pasaba de cuatro
        // botones. Medido con cinco: a 320px se cortaban 35px contra el borde de
        // la pantalla y a 280px, 75 — y el caso de cuatro ya perdía 9px a 280.
        // O sea que el ancho fijo no estaba de más por el quinto botón: ya
        // estaba justo.
        //
        // 60px es lo que necesita "FILTROS" en `text-micro`; 44 es el mínimo
        // táctil, y es el suelo al que puede llegar sin dejar de ser un objetivo
        // válido. Entre los dos, el rótulo se reparte en dos líneas —que
        // `line-clamp-2` ya contemplaba— en vez de que el botón se salga.
        // `w-[60px] shrink min-w-11` y no `basis-[60px]`: con `flex-grow: 0` el
        // navegador dimensiona el clúster por el contenido de cada botón, no por
        // su base, así que con `basis` las columnas se cerraban al ancho del
        // rótulo más largo —medido: 49px incluso a 430px, donde sobra sitio— y
        // los íconos quedaban apretados. El `width` sí fija la columna; `shrink`
        // es lo que le permite ceder cuando de verdad no entra.
        className="w-[60px] shrink min-w-11 flex flex-col items-center gap-1 group/bf"
    >
        <span className={`relative grid place-items-center rounded-full
            transition-[background-color,border-color] duration-150
            ${principal
                ? 'w-12 h-12 bg-chart-9-solid text-white shadow-md'
                : `w-11 h-11 border ${tono === 'danger'
                    ? 'bg-danger/12 border-danger/30 text-danger-text'
                    : activo
                        ? 'bg-brand/12 border-brand/40 text-brand-text'
                        : 'bg-surface-card-hover border-border-card text-content-2'}`}`}
        >
            <Icono size={principal ? 22 : 17} strokeWidth={principal ? 2.5 : 2.2} />
            {badge > 0 && (
                <Contador valor={badge} tono="brand" max={9}
                    className="absolute -top-0.5 -right-0.5 ring-2 ring-surface-card"
                    aria-label={`${badge} aplicado${badge === 1 ? '' : 's'}`} />
            )}
            {/* El punto va en el MISMO sitio que la cuenta y con el mismo aro:
                son la misma señal —"esto tiene algo aplicado"— dicha con y sin
                número, así que moverlo de sitio las haría leer como dos cosas
                distintas. `aria-hidden` porque el estado ya lo dice el
                `aria-label` del botón, y un punto anunciado aparte sería ruido
                sin significado para un lector de pantalla. */}
            {!badge && punto && (
                <span aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
                        bg-brand ring-2 ring-surface-card" />
            )}
        </span>
        {rotulo && (
            // Dos líneas, no `truncate`. Con una sola, "NUEVO EMPLEADO" salía
            // "NUEVO E…" en los 60px de la columna — y un rótulo cortado a la
            // mitad no dice qué hace el botón, que es justo para lo que está.
            // `line-clamp-2` acota el peor caso; `items-start` en el clúster ya
            // mantiene alineados los íconos aunque un rótulo ocupe dos líneas.
            // `hyphens-auto` además de `break-words`: con las columnas
            // comprimidas a 52px, "ACCIONES" se partía en "ACCIONE" + "S" y esa
            // letra suelta en la segunda línea se lee como un error de dibujo,
            // no como una palabra cortada. `break-words` parte donde caiga;
            // `hyphens-auto` prefiere una sílaba y pone el guion — el documento
            // ya declara `lang="es"`, que es lo que el navegador necesita para
            // saber dónde cortar. Se dejan los dos: la separación silábica no
            // cubre nombres propios ni siglas, y ahí `break-words` sigue siendo
            // la red de seguridad que evita el desborde.
            <span className={`text-micro font-black uppercase leading-tight text-center w-full line-clamp-2 break-words hyphens-auto
                ${principal ? 'text-chart-9-text'
                    : tono === 'danger' ? 'text-danger-text'
                        : activo ? 'text-brand-text' : 'text-content-3'}`}>
                {label}
            </span>
        )}
    </button>
));
Boton.displayName = 'BarraFlotante.Boton';

BarraFlotante.displayName = 'BarraFlotante';
export default BarraFlotante;
