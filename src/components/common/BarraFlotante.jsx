import React, { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import useMediaQuery from '../../hooks/useMediaQuery';
import Contador from './Contador';
import ModalShell from './ModalShell';

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
 * ── El corte es 719px, el mismo de `FilterBar` ─────────────────────────────
 * No `md` (768). Una vista que use esto le pasa `soloEscritorio` a su `FilterBar`,
 * y si los cortes divergen queda una franja de 50px con las dos cosas visibles o
 * ninguna. Una sola fuente de verdad.
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
const UMBRAL = 8;
// Arriba de la página nunca se esconde: si el usuario está en el principio, no
// está leyendo hacia abajo, está por empezar.
const ZONA_SEGURA = 96;

const BarraFlotante = memo(({
    buscador = null,
    acciones = [],
    principal = null,
    autoOcultar = true,
    // Los rótulos bajo los íconos aparecen solos cuando hay MÁS DE UN botón: con
    // uno solo el ícono no compite con nada y el rótulo es ruido. Se puede forzar.
    mostrarRotulos,
    ariaLabel = 'Acciones de la vista',
    // Un control de filtro dibujado DENTRO del clúster, en vez de escondido tras
    // el botón "Filtros". Lo usa `FilterBar` cuando la vista tiene una sola
    // ranura — ver la nota allá.
    ranura = null,
}) => {
    const compacto = useMediaQuery('(max-width: 719px)');
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
                setVisible(y < ZONA_SEGURA || dy < 0);
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

    const abrirBusqueda = useCallback(() => {
        setBuscando(true);
        // El foco va después del render, o el navegador no levanta el teclado.
        setTimeout(() => inputRef.current?.focus(), 60);
    }, []);

    // El ancla se renderiza SIEMPRE en el flujo (1px, invisible): es lo que sabe
    // si esta instancia está en un tab oculto. Sin ella no hay forma de
    // distinguir "montado" de "en pantalla".
    const ancla = <span ref={anclaRef} aria-hidden="true" className="block w-px h-px" />;

    if (!compacto) return null;
    if (!enPantalla) return ancla;

    const conTexto = !!buscador?.value;
    const campoAbierto = !!buscador && (buscando || conTexto);
    const botones = (buscador ? 1 : 0) + acciones.length + (principal ? 1 : 0);
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
                    abrirBusqueda={abrirBusqueda}
                    acciones={acciones}
                    principal={principal}
                    ranura={ranura}
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
    abrirBusqueda, acciones, principal, rotulos, setAbierta, panelAbierto,
    ranura, clusterRef,
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
                // `display` por variable y no por clase: quien sabe si hay un
                // overlay global abierto es `AppLayout`, y esta barra cuelga del
                // `body` por portal, así que no es descendiente suya. El valor por
                // defecto es `flex` para que fuera de `AppLayout` —o antes del
                // primer efecto— la barra se dibuje igual.
                className="fixed inset-x-0 bottom-0 z-tabs
                    px-3 pt-2
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

                    La superficie sigue siendo `dropdown`, y eso se midió, no se
                    heredó. Con el blur ya vivo (ver la nota del contenedor de arriba)
                    se compararon las tres superficies existentes sobre la lista de
                    empleados, a 390px y con las filas pasando por detrás:

                      · `card` (16%)     "SALUD 2" se lee ENTERO y cae encima de
                                         "ACCIONES". Es vidrio, pero ilegible.
                      · `dropdown` (72%) lo de atrás queda como un fantasma y los
                                         rótulos del clúster se leen limpios.
                      · `modal` (85%)    ya no deja ver nada; es un panel.

                    O sea que `dropdown` era la elección correcta por la razón
                    equivocada: se había subido a 72% para tapar un blur que no
                    existía. Con el blur andando, el 72% es vidrio esmerilado de
                    verdad —se ve el movimiento y el color de la lista a través— y
                    encima cumple el criterio que index.css ya fija para lo que flota
                    sobre contenido: que lo de atrás sea LUZ, no texto.

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
                            ease-[cubic-bezier(0.23,1,0.32,1)]"
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
                            onBlur={() => setBuscando(false)}
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
                    data-surface="dropdown"
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

                    {ranura && (
                        <div className="min-w-0 flex-1 flex items-center h-11">{ranura}</div>
                    )}

                    {acciones.map((a) => (
                        <Boton
                            key={a.key}
                            icon={a.icon}
                            label={a.label}
                            rotulo={rotulos}
                            badge={a.badge}
                            activo={a.activo ?? (a.badge > 0)}
                            onClick={() => (a.panel ? setAbierta(a.key) : a.onClick?.())}
                        />
                    ))}

                    {buscador && (
                        <Boton
                            icon={Search}
                            label="Buscar"
                            rotulo={rotulos}
                            activo={campoAbierto}
                            onClick={abrirBusqueda}
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
                    <div data-surface="modal" className="max-h-[85dvh] overflow-y-auto rounded-t-modal
                        px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
                        <div aria-hidden="true" className="w-9 h-1 rounded-full bg-content-3/40 mx-auto mb-3" />
                        <h2 className="text-body-lg font-black text-content mb-3">
                            {panelAbierto?.tituloPanel || panelAbierto?.label}
                        </h2>
                        {panelAbierto?.panel}
                    </div>
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
const Boton = memo(({ icon: Icono, label, rotulo, badge, activo, principal, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={label}
        // Ancho fijo por columna: el rótulo es más ancho que el ícono ("AGREGAR"
        // mide más que sus 48px) y sin esto se desbordaba del clúster y quedaba
        // cortado contra el borde de la pantalla. 60px entra "FILTROS" en
        // text-micro; el ícono queda centrado dentro.
        className="shrink-0 w-[60px] flex flex-col items-center gap-1 group/bf"
    >
        <span className={`relative grid place-items-center rounded-full
            transition-[background-color,border-color] duration-150
            ${principal
                ? 'w-12 h-12 bg-chart-9-solid text-white shadow-md'
                : `w-11 h-11 border ${activo
                    ? 'bg-brand/12 border-brand/40 text-brand-text'
                    : 'bg-surface-card-hover border-border-card text-content-2'}`}`}
        >
            <Icono size={principal ? 22 : 17} strokeWidth={principal ? 2.5 : 2.2} />
            {badge > 0 && (
                <Contador valor={badge} tono="brand" max={9}
                    className="absolute -top-0.5 -right-0.5 ring-2 ring-surface-card"
                    aria-label={`${badge} aplicado${badge === 1 ? '' : 's'}`} />
            )}
        </span>
        {rotulo && (
            // Dos líneas, no `truncate`. Con una sola, "NUEVO EMPLEADO" salía
            // "NUEVO E…" en los 60px de la columna — y un rótulo cortado a la
            // mitad no dice qué hace el botón, que es justo para lo que está.
            // `line-clamp-2` acota el peor caso; `items-start` en el clúster ya
            // mantiene alineados los íconos aunque un rótulo ocupe dos líneas.
            <span className={`text-micro font-black uppercase leading-tight text-center w-full line-clamp-2 break-words
                ${principal ? 'text-chart-9-text' : activo ? 'text-brand-text' : 'text-content-3'}`}>
                {label}
            </span>
        )}
    </button>
));
Boton.displayName = 'BarraFlotante.Boton';

BarraFlotante.displayName = 'BarraFlotante';
export default BarraFlotante;
