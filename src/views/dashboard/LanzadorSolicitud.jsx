import React, { useState, useCallback, useMemo, useEffect, useContext, createContext } from 'react';
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
    useEffect(() => registrar?.(nombre), [registrar, nombre]);
    const nodo = ctx?.nodos?.[nombre];
    return nodo ? createPortal(children, nodo) : null;
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
    const [inquilinos, setInquilinos] = useState({ herramientas: 0, pie: 0 });

    // Callbacks estables: un `ref` inline cambia de identidad en cada render y
    // React lo llama con `null` y con el nodo cada vez — con un `setState`
    // adentro, eso es un bucle. La comparación `n[k] === el` corta el segundo.
    const refHerramientas = useCallback((el) => {
        setNodos(n => (n.herramientas === el ? n : { ...n, herramientas: el }));
    }, []);
    const refPie = useCallback((el) => {
        setNodos(n => (n.pie === el ? n : { ...n, pie: el }));
    }, []);

    const registrar = useCallback((nombre) => {
        setInquilinos(c => ({ ...c, [nombre]: c[nombre] + 1 }));
        return () => setInquilinos(c => ({ ...c, [nombre]: c[nombre] - 1 }));
    }, []);

    const ranuras = useMemo(() => ({ nodos, registrar }), [nodos, registrar]);

    return (
        <>
            <button
                type="button"
                onClick={() => setAbierto(true)}
                className="group w-full h-full flex flex-col items-start justify-between gap-2 p-4 text-left
                    rounded-2xl border border-border-card bg-surface-card transition-all
                    hover:translate-y-[var(--lift-hover)]"
            >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                    <Icon size={16} strokeWidth={2} className="text-content-2" />
                </div>

                <div className="w-full min-w-0">
                    <p className="text-body-sm font-black text-content leading-tight">{label}</p>
                    <p className={`text-caption font-semibold mt-0.5 truncate ${hay ? acento.texto : 'text-content-3'}`}>
                        {pendientes === null
                            ? '—'
                            : hay ? `${pendientes} ${etiqueta}` : vacio}
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
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                                    <Icon size={16} strokeWidth={2} className="text-content-2" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-body font-black text-content leading-tight truncate">{label}</p>
                                    {descripcion && (
                                        <p className="text-label text-content-3 mt-0.5 truncate">{descripcion}</p>
                                    )}
                                </div>
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
