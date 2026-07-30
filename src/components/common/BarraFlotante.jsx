import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
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
 *    el buscador se estira a campo y muestra el término, y las acciones llevan
 *    `Contador`. Sin esto la barra muestra la puerta y esconde el contenido.
 *
 * El costo que no se puede diseñar afuera: **lupa y filtros significan casi lo
 * mismo** para quien está contando — los dos son "achicar la lista". Cuesta un
 * toque perdido cada tanto, y es el precio de ser la más compacta.
 *
 * ── El buscador se ESTIRA, no cambia de modo ──────────────────────────────
 * Al tocar la lupa el campo crece en el lugar y los otros botones se quedan. La
 * alternativa era una fila propia arriba, que se descartó por lo mismo que se
 * descartó otra variante: dos anatomías en la misma barra.
 *
 * Medido, el área de tecleo: **160px a 390px de viewport, 90px a 320px**. Los 90
 * de un iPhone SE son ~6 caracteres a la vista, y es lo que da la física con tres
 * controles rotulados en 320px. Alcanza porque esto es búsqueda incremental —se
 * teclean cuatro o cinco letras, no el nombre entero— y el texto se desplaza
 * dentro del campo. Queda expandido mientras tenga texto, así que el término
 * sigue visible con el teclado cerrado, que era el requisito.
 *
 * Y el panel del buscador NO es una hoja: mientras se escribe hay que ver la
 * lista filtrarse, o no se sabe cuándo parar de teclear. Los filtros sí van en
 * hoja, porque se aplican y se cierran.
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
 * ── z-header y no z-modal ──────────────────────────────────────────────────
 * Es cromo de la vista, no un diálogo: va DEBAJO de cualquier hoja que se abra
 * desde ella (`z-modal` = 100) y encima del encabezado pegajoso de una tabla
 * (`z-base` = 10). `z-header` (40) es la capa donde ya vive la nav del layout.
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
                role="toolbar"
                aria-label={ariaLabel}
                className="fixed inset-x-0 bottom-0 z-header
                    px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]
                    flex justify-end pointer-events-none"
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
                <div
                    data-surface="dropdown"
                    className={`pointer-events-auto flex items-start gap-1.5 p-1.5 shadow-lg
                        transition-transform duration-200 ease-out
                        ${campoAbierto ? 'w-full' : 'max-w-full'}
                        ${visible || campoAbierto ? 'translate-y-0' : 'translate-y-[135%]'}`}
                >

                    {buscador && (campoAbierto ? (
                        <div className="flex items-center gap-1.5 h-11 min-w-0 flex-1 px-3
                            rounded-full bg-surface-input border border-brand/40
                            outline-solid outline-2 outline-offset-0 outline-brand/25">
                            <Search size={14} strokeWidth={2.5} className="text-brand-text shrink-0" />
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
                    ) : (
                        <Boton icon={Search} label="Buscar" rotulo={rotulos} onClick={abrirBusqueda} />
                    ))}

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

                    {principal && (
                        <Boton
                            icon={principal.icon}
                            label={principal.label}
                            rotulo={rotulos}
                            principal
                            onClick={principal.onClick}
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
