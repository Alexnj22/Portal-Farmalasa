import React, { useState, useCallback, useMemo, useLayoutEffect, useContext, createContext } from 'react';
import { createPortal } from 'react-dom';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import { CheckCircle2, ChevronRight, X } from 'lucide-react';
import { useTamanoWidget } from './tamanoWidget';

// La baldosa que abre una solicitud, y el modal donde se arma.
//
// Los widgets de solicitudes —Ajuste de Inventario, Modificación a Facturación,
// Ajuste de Min/Max, Traslados y Consulta de Inventario— son formularios largos:
// buscar, elegir, completar y escribir un motivo. Metidos en una baldosa del
// tablero no entraban. En el Ajuste de Inventario se veía claro: con un solo
// producto agregado, la lista de resultados quedaba en una franja de dos
// centímetros y no había forma de darse cuenta de que se podían agregar más.
//
// Así que la baldosa deja de ser el formulario y pasa a ser su puerta: ocupa
// 1×1, dice qué hay esperando, y el trabajo pasa a un modal con espacio.
//
// El número no es decoración. Una baldosa que solo dice su nombre no da ningún
// motivo para abrirla, y lo que hay adentro deja de mirarse.
//
// ── La anatomía del modal vive ACÁ (2026-08-07) ───────────────────────────
// `LiquidModal` es el canónico y ya se usaba, pero solo como envase: los cinco
// widgets le pasaban un `<div>` suelto y se dibujaban su propio encabezado a
// mano —cuatro versiones distintas del mismo renglón, dos sin ninguno— sin botón
// de cerrar y con el botón de enviar adentro del cuerpo que scrollea. O sea que
// el canónico estaba importado pero sus tres ranuras (`Header`/`Body`/`Footer`)
// no las usaba nadie, que es exactamente la forma en que un componente canónico
// deja de serlo sin que ningún gate lo note.
//
// Ahora las pone esta puerta, una sola vez, para los cinco. Lo que cada widget
// aporta es el contenido y —por las ranuras de abajo— sus herramientas y sus
// botones.

const TONOS = {
    brand:   { texto: 'text-brand-text',   fondo: 'bg-brand/10',   borde: 'border-brand/30'   },
    warning: { texto: 'text-warning-text', fondo: 'bg-warning/10', borde: 'border-warning/30' },
    danger:  { texto: 'text-danger-text',  fondo: 'bg-danger/10',  borde: 'border-danger/30'  },
    success: { texto: 'text-success-text', fondo: 'bg-success/10', borde: 'border-success/30' },
};
const APAGADO = { texto: 'text-content-3', fondo: 'bg-surface-card-hover', borde: 'border-border-card' };

// ── Las ranuras, por portal ───────────────────────────────────────────────
// El encabezado y el pie los dibuja esta puerta, pero lo que va adentro nace
// tres o cuatro componentes más abajo: el buscador vive con su estado en el
// formulario, y el botón de enviar con el suyo. Izarlos hasta acá era reescribir
// cinco formularios para mover dos controles.
//
// Con un portal, cada uno se escribe donde está su estado y se PINTA donde
// corresponde. La cuenta de inquilinos existe para el pie: `LiquidModal.Footer`
// dibuja un borde superior, así que sin nadie adentro dejaría una franja vacía.
const RanurasCtx = createContext(null);

function Ranura({ nombre, children }) {
    const ctx = useContext(RanurasCtx);
    const registrar = ctx?.registrar;
    // `useLayoutEffect` y no `useEffect`: la cuenta de inquilinos DECIDE QUÉ SE
    // DIBUJA —el encabezado propio reemplaza al de la puerta— así que con un
    // efecto normal el navegador alcanza a pintar un fotograma con los dos
    // encabezados antes de que la cuenta suba. Acá el ajuste entra antes de
    // pintar. Para el pie no cambia nada; para el encabezado es la diferencia
    // entre un parpadeo y ninguno.
    useLayoutEffect(() => registrar?.(nombre), [registrar, nombre]);
    const nodo = ctx?.nodos?.[nombre];
    return nodo ? createPortal(children, nodo) : null;
}

/**
 * El encabezado del modal, cuando el contenido tiene el suyo.
 *
 * REEMPLAZA al título de la puerta en vez de sumarse. Reportado el 2026-08-07:
 * «no me gusta el doble encabezado que crea, hazlo uno solo». Y era literal —
 * el Ajuste de Inventario mostraba «Ajuste de Inventario / Cargar o descargar
 * producto de tu sala» y justo debajo, con su propio borde, «Descargar por
 * vencimiento / La Popular». Dos títulos para una sola pantalla.
 *
 * La puerta conserva el botón de cerrar: eso no es del contenido.
 */
export function EncabezadoModal({ children }) {
    return <Ranura nombre="encabezado">{children}</Ranura>;
}

/** Controles que van en el ENCABEZADO del modal (buscador, filtro de fecha). */
export function HerramientasModal({ children }) {
    return <Ranura nombre="herramientas">{children}</Ranura>;
}

/** Botones de acción — van al PIE canónico, fuera del cuerpo que scrollea. */
export function PieModal({ children }) {
    return <Ranura nombre="pie">{children}</Ranura>;
}

/**
 * El MODAL con sus tres ranuras, sin la baldosa.
 *
 * Se separó el 2026-08-11, cuando «Solicitudes de Sucursal» estrenó su botón
 * «Nueva solicitud»: los formularios que abre son los mismos cinco del tablero,
 * y los cinco escriben su encabezado, sus herramientas y sus botones por estas
 * ranuras. Sin separarla, la única forma de abrir uno era desde su baldosa —o
 * sea que el botón nuevo habría necesitado una segunda anatomía de modal, que
 * es exactamente el desparramo que esta puerta vino a terminar.
 *
 * La baldosa sigue siendo el uso normal; esto es la mitad de abajo.
 */
export function ModalConRanuras({
    icon: Icon,
    label,
    descripcion,
    maxWidth = 'max-w-2xl',
    onClose,
    children,               // (cerrar) => contenido
}) {
    const [nodos, setNodos] = useState({});
    const [inquilinos, setInquilinos] = useState({ herramientas: 0, pie: 0, encabezado: 0 });

    // Callbacks estables: un `ref` inline cambia de identidad en cada render y
    // React lo llama con `null` y con el nodo cada vez — con un `setState`
    // adentro, eso es un bucle. La comparación `n[k] === el` corta el segundo.
    const refHerramientas = useCallback((el) => {
        setNodos(n => (n.herramientas === el ? n : { ...n, herramientas: el }));
    }, []);
    const refPie = useCallback((el) => {
        setNodos(n => (n.pie === el ? n : { ...n, pie: el }));
    }, []);
    const refEncabezado = useCallback((el) => {
        setNodos(n => (n.encabezado === el ? n : { ...n, encabezado: el }));
    }, []);

    const registrar = useCallback((nombre) => {
        setInquilinos(c => ({ ...c, [nombre]: c[nombre] + 1 }));
        return () => setInquilinos(c => ({ ...c, [nombre]: c[nombre] - 1 }));
    }, []);

    const ranuras = useMemo(() => ({ nodos, registrar }), [nodos, registrar]);

    return (
        <LiquidModal open onClose={onClose} maxWidth={maxWidth} ariaLabel={label}>
            <RanurasCtx.Provider value={ranuras}>
                <LiquidModal.Header>
                    <div className="flex items-center gap-2.5">
                        {/* `contents`: lo que se portalea acá SON los
                            hijos directos de esta fila, así que hereda su
                            reparto en vez de quedar encajonado. Mismo
                            motivo que en el pie. */}
                        <div ref={refEncabezado} className="contents" />
                        {/* El título de la puerta cede el lugar cuando el
                            contenido trae el suyo. El botón de cerrar NO:
                            ése es de la puerta y se queda siempre. */}
                        {inquilinos.encabezado === 0 && (
                          <>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                                <Icon size={16} strokeWidth={2} className="text-content-2" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-body font-black text-content leading-tight truncate">{label}</p>
                                {descripcion && (
                                    <p className="text-label text-content-3 mt-0.5 truncate">{descripcion}</p>
                                )}
                            </div>
                          </>
                        )}
                        <Button variant="ghost" size="xs" icon={X} iconOnly
                            onClick={onClose} aria-label="Cerrar" />
                    </div>
                    {/* `empty:hidden` y no un contador: mientras nadie
                        portalee nada el div no tiene ni un hijo, así que
                        `:empty` lo agarra y el margen no se aplica —
                        `display:none` no deja margen. Sin esto quedaba
                        un renglón de aire bajo el título. */}
                    <div ref={refHerramientas} className="mt-3 empty:hidden" />
                </LiquidModal.Header>

                {/* `flex flex-col min-h-0`: los formularios de adentro
                    tienen su propio scroller con `flex-1 min-h-0`, y un
                    hijo de un flex en columna no baja de su contenido sin
                    eso — el scroll se escapa hacia arriba en la cadena y
                    no lo agarra nadie. Medido el 2026-08-06 en la consulta
                    de inventario: caja de 708px con 1134 de contenido. */}
                <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                    {children(onClose)}
                </LiquidModal.Body>

                {inquilinos.pie > 0 && (
                    <LiquidModal.Footer>
                        {/* `contents` y NO un flex propio: el pie canónico
                            ya reparte —`justify-between` en escritorio,
                            apilado a ancho completo en táctil— y un
                            contenedor en el medio se comía las dos cosas.
                            Sin caja, los botones portaleados SON los hijos
                            del pie y heredan su gramática. */}
                        <div ref={refPie} className="contents" />
                    </LiquidModal.Footer>
                )}
            </RanurasCtx.Provider>
        </LiquidModal>
    );
}

export default function LanzadorSolicitud({
    icon: Icon,
    label,
    descripcion,            // qué se hace acá adentro; va bajo el título
    pendientes = null,      // el número vivo; null = todavía no se sabe
    etiquetaPendientes,     // qué es ese número, en singular y plural
    etiquetaPendientesPlural,
    vacio = 'Sin pendientes',
    // ── La franja al pie (2026-08-08) ─────────────────────────────────────
    // La figura y su desglose. Van juntos a propósito: la figura no tiene alto
    // para etiquetas propias (ver `InstrumentoBaldosa`), así que lo que ella no
    // puede nombrar lo nombra `detalle`, en el MISMO orden de izquierda a
    // derecha. Separarlos deja una figura sin leyenda.
    //
    // `detalle` se pega al renglón del contador en vez de ocupar una línea
    // nueva: no hay lugar para una quinta línea en 120px de fila, y de paso el
    // color queda donde ya estaba —el contador— con el desglose en tinta
    // apagada detrás.
    instrumento = null,
    detalle = null,
    // Qué decir cuando el número NO va a llegar nunca — no porque esté
    // cargando, sino porque para este usuario no existe. «Consulta de
    // Inventario» mostraba un guión mudo a todo el personal de Administración,
    // que no tiene sala con inventario: el guión se lee como «se está cargando»
    // y no como «acá no aplica», y quien lo mira espera un número que no viene.
    sinDato = null,
    tono = 'brand',         // brand | warning | danger | success
    maxWidth = 'max-w-2xl',
    children,               // (cerrar) => contenido del modal
}) {
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);
    // Con dos renglones o más hay alto para la descripción y un número mayor.
    const alto = (useTamanoWidget()?.rows ?? 1) >= 2;

    const hay = typeof pendientes === 'number' && pendientes > 0;
    const etiqueta = pendientes === 1
        ? etiquetaPendientes
        : (etiquetaPendientesPlural ?? etiquetaPendientes);

    // ── El color queda SÓLO en el número (2026-08-07) ────────────────────────
    // Antes, con pendientes, la baldosa entera se teñía: fondo, borde, chip del
    // ícono y texto, los cuatro del mismo tono. Y el encabezado del modal
    // llevaba el tono siempre, hubiera o no algo que hacer. Reportado: «los
    // widget no quiero que tengan color especial».
    //
    // Tiene razón y el motivo es el mismo que ya estaba escrito acá abajo: el
    // color señala mientras sea escaso. Repartido en cuatro superficies deja de
    // ser un aviso y pasa a ser la piel del componente — y encima peleaba con el
    // vidrio, porque un `bg-*/10` sobre el material lo enturbia.
    //
    // Queda en el texto del contador, que es la única parte que de verdad dice
    // «hay algo». El chip del ícono y el modal usan la superficie neutra.
    //
    // El mapa es ESTÁTICO a propósito. `text-${tono}-text` se lee bien y no
    // existe: Tailwind arma las clases leyendo el fuente, así que una armada
    // por interpolación nunca llega a la hoja de estilos y el color no aparece.
    const acento = hay ? TONOS[tono] ?? TONOS.brand : APAGADO;

    return (
        <>
            {/* ── La baldosa ES una tarjeta canónica (2026-08-07) ─────────────
                Estaba escrita a mano: `rounded-2xl border border-border-card
                bg-surface-card` sobre un `<button>` pelado. Eso copia el COLOR
                del canónico y nada más — se queda sin `backdrop-filter`, sin
                `--card-shadow`, sin el lente del filo (los cuatro `inset`), sin
                el destello del canto al apuntarla y sin el gel al presionarla.

                En oscuro no se notaba porque el color solo ya separa de un fondo
                oscuro. En claro la tarjeta desaparecía contra la página: sin la
                escarcha ni el lente no queda nada que la despegue. Reportado
                así — «el modo oscuro se ve perfecto, pero el modo claro no».

                `data-surface="card"` trae el material entero y el destello;
                `data-interactive` trae el gel (`scale(.994)`, o el hundimiento
                en los temas Solid). Las clases de geometría se van: el radio, el
                borde y la sombra los fija `index.css`, que va sin `@layer` y le
                gana a cualquier utilidad de Tailwind. El lift también sale de
                ahí (`--lift-card`), con su histéresis de salida — el
                `hover:translate-y` a mano no la tenía y parpadeaba al entrar por
                el borde de abajo. */}
            <button
                type="button"
                data-surface="card"
                data-interactive=""
                onClick={() => setAbierto(true)}
                // ── Se adapta a la celda (2026-10-21) ─────────────────────
                // Era una sola composición —ícono arriba, título, figura y un
                // renglón— para todos los tamaños: en 1×1 cabía justa, y en
                // 2×1 o 1×2 dejaba media baldosa vacía. Ahora el número es la
                // pieza grande, el ícono va en la fila del título, y lo que
                // sobra se gasta en decir más, no en aire:
                //   · ancho (`@container`, ≥ 20rem) → el desglose al costado;
                //   · alto (2+ renglones)           → la descripción y una
                //     figura más gruesa.
                // `@container` va en el BOTÓN y no se hereda de la celda: así
                // mide la baldosa también fuera del tablero.
                className="@container group w-full h-full min-h-0 flex flex-col justify-between gap-2 px-4 pt-3.5 pb-3 text-left overflow-hidden transition-transform duration-[var(--dur-fast)] active:scale-[0.99]"
            >
                <div className="w-full flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                        <Icon size={15} strokeWidth={2} className="text-content-2" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-black text-content leading-tight truncate">{label}</p>
                        {alto && descripcion && (
                            <p className="text-caption text-content-3 leading-snug truncate mt-0.5">{descripcion}</p>
                        )}
                    </div>
                    <ChevronRight size={14} className="shrink-0 text-content-3 opacity-60 transition-[transform,opacity] duration-[var(--dur-fast)] group-hover:opacity-100 group-hover:translate-x-0.5" />
                </div>

                <div className="w-full min-w-0 flex flex-col gap-1.5">
                    <div className="w-full min-w-0 flex items-baseline gap-2">
                        {hay ? (
                            <>
                                <span className={`shrink-0 font-black leading-none tabular-nums ${alto ? 'text-display-lg' : 'text-display'} ${acento.texto}`}>{pendientes}</span>
                                <span className={`min-w-0 truncate text-caption font-semibold ${acento.texto}`}>{etiqueta}</span>
                            </>
                        ) : (
                            // En calma el renglón no puede ser una nota al pie
                            // perdida: dice «al día» con su check, al tamaño
                            // del título, para que se lea igual de rápido que
                            // un número.
                            <span className="min-w-0 flex items-center gap-1.5 text-body-sm font-bold text-content-2">
                                {pendientes !== null && <CheckCircle2 size={15} strokeWidth={2.5} className="shrink-0 text-success-text" />}
                                <span className="truncate">{pendientes === null ? (sinDato ?? '—') : vacio}</span>
                            </span>
                        )}
                        {/* El desglose viaja SIEMPRE en tinta apagada: si tomara
                            el tono, el color dejaría de señalar «hay algo». Se
                            esconde por el ANCHO de la baldosa, no de la ventana:
                            pegado al número en 171px se cortaba en la segunda
                            palabra. */}
                        {detalle && (
                            <span className="hidden @[20rem]:inline ml-auto shrink min-w-0 truncate text-caption font-medium text-content-3">{detalle}</span>
                        )}
                    </div>
                    {/* `aria-hidden`: la baldosa ES un botón y los números de la
                        figura ya los dice el renglón de arriba en palabras.
                        `empty:hidden`: las figuras se niegan solas a dibujarse
                        cuando no hay nada, y un elemento que rinde `null` sigue
                        siendo truthy. */}
                    <div className="w-full empty:hidden" aria-hidden="true">{instrumento}</div>
                </div>
            </button>

            {/* El contenido se monta SOLO con el modal abierto: si no, cada
                baldosa del tablero cargaría su catálogo al entrar, que es
                justo el peso que se buscaba sacar. */}
            {abierto && (
                <ModalConRanuras icon={Icon} label={label} descripcion={descripcion}
                    maxWidth={maxWidth} onClose={cerrar}>
                    {children}
                </ModalConRanuras>
            )}
        </>
    );
}
