import React, { useState, useCallback, useMemo, useLayoutEffect, useContext, createContext } from 'react';
import { createPortal } from 'react-dom';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import { X } from 'lucide-react';

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
                // `pb-3` y no `p-4`: la franja al pie necesita 14px que la fila
                // de 120px no tenía. Se recortan del padding de abajo, que es
                // el único de los cuatro que no toca la alineación con las
                // baldosas vecinas — el lateral y el de arriba se quedan.
                // Y el acuse: `data-interactive` le da el lift al APUNTAR desde
                // `index.css`, que en el teléfono no ocurre nunca. Sin `active:`
                // la baldosa quedaba muda — cuatro por tablero, y son la puerta
                // de entrada a lo que la vista ofrece. `0.99` por el tamaño.
                className="group w-full h-full flex flex-col items-start justify-between gap-2 px-4 pt-4 pb-3 text-left transition-transform duration-[var(--dur-fast)] active:scale-[0.99]"
            >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                    <Icon size={16} strokeWidth={2} className="text-content-2" />
                </div>

                <div className="w-full min-w-0">
                    <p className="text-body-sm font-black text-content leading-tight">{label}</p>
                    {/* `aria-hidden` acá y no en cada figura: la baldosa ES un
                        botón, así que todo lo de adentro forma su nombre
                        accesible. Los números de la figura ya los dice el
                        renglón de abajo en palabras; anunciarlos otra vez como
                        una ristra de divs sólo alarga el anuncio. */}
                    {/* `empty:hidden` y no `instrumento && …`: las figuras
                        deciden ellas mismas no dibujarse cuando no hay nada que
                        mostrar, y un elemento React que renderiza `null` sigue
                        siendo truthy. Sin esto quedaba el margen de una franja
                        que no está — el mismo motivo y el mismo recurso que el
                        contenedor de herramientas del modal, más abajo.

                        ── La franja también va en el teléfono ────────────────
                        En v2.519.1 estaba apagada abajo de `lg`: con dos
                        columnas la baldosa mide 171px y «Consulta de
                        Inventario» **envuelve a dos líneas** —30px de título en
                        vez de 15—, así que el contenido pasaba de 118 a 131
                        contra una caja de 118 y se salía de la tarjeta.

                        La causa no era la franja sino que la fila valía 120px
                        en los dos tamaños. Desde v2.520.0 el teléfono usa
                        `ROW_H_MOVIL` (150), que es donde vive el arreglo de
                        verdad, y acá ya no hace falta esconder nada. */}
                    <div className="mt-1.5 empty:hidden" aria-hidden="true">{instrumento}</div>
                    <p className={`text-caption font-semibold mt-1 truncate ${hay ? acento.texto : 'text-content-3'}`}>
                        {pendientes === null
                            ? (sinDato ?? '—')
                            : hay ? `${pendientes} ${etiqueta}` : vacio}
                        {/* El desglose viaja SIEMPRE en tinta apagada, tenga o
                            no pendientes la baldosa: si tomara el tono, el
                            color dejaría de señalar «hay algo» y pasaría a ser
                            la piel del renglón entero. */}
                        {/* El desglose SÍ sigue apagado en el teléfono, y por
                            un motivo distinto al de la franja: a éste no lo
                            limita el alto sino el ANCHO. Pegado al contador en
                            una baldosa de 171px se corta en la segunda palabra
                            («40 sin existenci…»), así que subir la fila no lo
                            arregla. La figura queda, que es lo que sí se lee a
                            ese tamaño. */}
                        {detalle && <span className="text-content-3 font-medium hidden lg:inline"> · {detalle}</span>}
                    </p>
                </div>
            </button>

            {/* El contenido se monta SOLO con el modal abierto: si no, cada
                baldosa del tablero cargaría su catálogo al entrar, que es
                justo el peso que se buscaba sacar. */}
            {abierto && (
                <LiquidModal open onClose={cerrar} maxWidth={maxWidth} ariaLabel={label}
                    className="max-h-[85dvh]">
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
                                    onClick={cerrar} aria-label="Cerrar" />
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
                            {children(cerrar)}
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
            )}
        </>
    );
}
