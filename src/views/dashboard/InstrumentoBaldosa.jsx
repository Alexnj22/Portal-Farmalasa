import React from 'react';

// El instrumento de la baldosa — la franja al pie, a todo el ancho.
//
// Las seis baldosas de Operación compartían la anatomía completa: chip, título
// y un renglón. La única diferencia entre ellas era el texto, así que había que
// LEER para distinguirlas, y el 55% derecho de la baldosa no decía nada.
//
// Esto agrega una figura entre el título y el renglón. Lo que diferencia a una
// baldosa de otra es la FORMA de esa figura —barras verticales para «quién»,
// barra segmentada para «de qué», dos pistas opuestas para «en qué sentido»—,
// nunca el color: el instrumento se dibuja con la misma tinta que el texto
// secundario y lo único con color sigue siendo el renglón del contador. Es la
// misma decisión que ya estaba tomada en `LanzadorSolicitud` («los widget no
// quiero que tengan color especial») y esto no la toca.
//
// ── Por qué 14px y ni uno más ─────────────────────────────────────────────
// La fila de la retícula mide 120px (`ROW_H` en `DashboardView`). Descontado
// el padding quedan 94, y chip (36) + título (15) + renglón (13) + los gaps ya
// se comen 80. La franja entra en los 14 que sobran, y por eso TODAS miden lo
// mismo: las que dibujan una barra de 7px la centran en la caja en vez de
// encogerla. Si alguna creciera, la baldosa se desbordaría de su celda sin dar
// ningún error — el grid tiene alto fijo.
//
// Por el mismo motivo no hay etiquetas bajo las figuras: no hay renglón para
// ellas. Lo que la figura no puede nombrar lo nombra el renglón del contador,
// en el mismo orden de izquierda a derecha (ver la prop `detalle`).

/** La caja de altura fija en la que vive cualquier figura. */
function Franja({ children }) {
    return <div className="w-full h-3.5 flex items-center">{children}</div>;
}

// El riel es el fondo sobre el que se apoya cualquier tramo: dice cuánto cabe.
// Sin él, tres tramos cortos y tres largos se ven igual de «llenos».
const RIEL = 'bg-content-3/15';

// Los cuatro pesos de tinta de un tramo. `alerta` es la ÚNICA excepción al
// monocromo y existe para un solo caso —lo ya vencido— porque ahí el tramo no
// es una proporción sino una pérdida consumada.
const TINTA = {
    alerta: 'bg-danger-text',
    fuerte: 'bg-content-2',
    medio:  'bg-content-3/70',
    suave:  'bg-content-3/40',
};

/**
 * Barra segmentada — «de qué se compone el número».
 *
 * `tramos`: [{ frac, tinta }] con `frac` en 0..1 sobre el total del riel.
 * Los 2px de separación entre tramos son del material de la baldosa, no un
 * color: dos tramos pegados de tintas vecinas se leen como uno solo.
 */
export function BarraTramos({ tramos = [] }) {
    // ── Sin nada que mostrar, NO hay franja (2026-08-08) ──────────────────
    // El riel vacío estaba pensado como el estado «en cero», y en el mockup se
    // veía bien. Puesto en la baldosa real de 470px de ancho se lee como un
    // separador mal puesto: una línea gris de punta a punta que no señala nada
    // — y en Traslados, con sus dos pistas, como un subrayado roto.
    //
    // Una baldosa sin pendientes no tiene información que dar, así que la
    // honesta es no dibujar figura. La que sí tiene se distingue justamente por
    // tenerla, que era el punto.
    if (!tramos.length) return null;

    const usado = tramos.reduce((a, t) => a + Math.max(0, t.frac || 0), 0);
    return (
        <Franja>
            <div className={`w-full h-1.5 rounded-full flex gap-0.5 overflow-hidden ${RIEL}`}>
                {tramos.map((t, i) => (
                    <span
                        key={i}
                        className={`h-full rounded-full ${TINTA[t.tinta] ?? TINTA.medio}`}
                        style={{ width: `${Math.max(0, Math.min(1, t.frac || 0)) * 100}%` }}
                    />
                ))}
                {usado < 1 && <span className="h-full flex-1" />}
            </div>
        </Franja>
    );
}

/**
 * Carril — «quién», una barra por sala.
 *
 * Va sin etiquetas porque no hay alto para ellas: el renglón del contador
 * nombra a la más alta, que es la única que se necesita para actuar («6 en
 * Salud 2»). Las demás barras dicen si hay una sola opción o varias, que es lo
 * otro que cambia la decisión. El orden de las columnas es fijo —el orden de
 * despacho— para que se vuelva reconocible con el uso.
 */
export function Carril({ valores = [] }) {
    // Mismo criterio que `BarraTramos`: todas las salas en cero es «no hay nada
    // que repartir», no una figura de seis columnas mínimas.
    if (!valores.some(v => v > 0)) return null;

    const tope = Math.max(1, ...valores);
    return (
        <Franja>
            <div className="w-full h-3.5 flex items-end gap-1">
                {valores.map((v, i) => (
                    <span
                        key={i}
                        className={`flex-1 rounded-sm ${v > 0 ? TINTA.fuerte : RIEL}`}
                        // 2px de piso para que una sala en cero siga ocupando su
                        // lugar: un hueco se lee como «esa sala no existe» y no
                        // como «esa sala no tiene».
                        style={{ height: `${v > 0 ? Math.max(18, (v / tope) * 100) : 14}%` }}
                    />
                ))}
            </div>
        </Franja>
    );
}

/**
 * Flujo — «en qué sentido», dos pistas opuestas.
 *
 * Es la figura de Traslados, la única baldosa cuyo pendiente tiene dirección:
 * arriba lo que otras salas te piden, abajo lo que vos estás esperando.
 */
export function Flujo({ entra = 0, sale = 0 }) {
    if (!entra && !sale) return null;

    const tope = Math.max(1, entra, sale);
    return (
        <Franja>
            <div className="w-full flex flex-col gap-1">
                <div className={`w-full h-1 rounded-full ${RIEL}`}>
                    <div className={`h-full rounded-full ${TINTA.fuerte}`}
                        style={{ width: `${(entra / tope) * 100}%` }} />
                </div>
                {/* La segunda pista crece desde la DERECHA: sin eso las dos
                    barras arrancan del mismo borde y el sentido se pierde. */}
                <div className={`w-full h-1 rounded-full flex justify-end ${RIEL}`}>
                    <div className={`h-full rounded-full ${TINTA.suave}`}
                        style={{ width: `${(sale / tope) * 100}%` }} />
                </div>
            </div>
        </Franja>
    );
}

/**
 * Mientras el dato no llegó.
 *
 * Ocupa el mismo alto que cualquier figura para que la baldosa no salte cuando
 * llega el número, pero va MÁS delgado y más tenue que un tramo: tiene que
 * leerse como «viene algo», no como un dato en cero. Dura lo que la consulta.
 */
export function FranjaVacia() {
    return (
        <Franja>
            <div className="w-1/3 h-1 rounded-full bg-content-3/12" />
        </Franja>
    );
}
