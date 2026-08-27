import React from 'react';
import { Building2 } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '../../utils/nameUtils';
import { useNowTick } from '../../hooks/useNowTick';
import { useStaffStore } from '../../store/staffStore';
import { fmtFechaHora, desdeHace, cuantoTardo, personasDe, cuandoSeDecidio, salaQueEspera, salaDePersona } from './movimientoTexto';

/* La cara de quien pide y la de quien decide.
 *
 * Hasta el 2026-08-11 una solicitud se leía sin ninguna de las dos: la tarjeta
 * decía el nombre de quien la mandó y el modal repetía ese nombre, y quien la
 * había resuelto —el dato que uno busca cuando entra a mirar una aprobada— no
 * aparecía en ningún lado. Preguntado así por el usuario: «no sale la foto de
 * quien solicita, de quien aprueba, a qué horas. nada de eso».
 *
 * Está en su propio archivo porque lo usan la tarjeta y el detalle, que son dos
 * archivos distintos y ya se habían separado una vez por copiarse en vez de
 * compartir. Las funciones puras que resuelven QUIÉN es cada quien viven en
 * `movimientoTexto.js`: un archivo que exporta componentes y funciones rompe el
 * fast refresh de Vite.
 */

/**
 * La foto de quien pide, aprueba o despacha — con su aro de estado.
 *
 * `px` en número y no un tamaño dentro de `className`: `AvatarConEstado`
 * necesita el número para decidir si el aro lleva chip, y desde una clase de
 * Tailwind ese dato no se puede leer. Los llamadores pasaban `w-10 h-10`,
 * `w-7 h-7` y `w-5 h-5`; hoy pasan 40, 28 y 20.
 *
 * Y el aro acá dice algo que en otras pantallas no: una solicitud esperando la
 * firma de alguien que está de vacaciones es exactamente lo que hay que ver
 * antes de preguntarse por qué no avanza.
 */
export const CaraPersona = ({ persona, px = 40, className = '' }) => (
    <AvatarConEstado emp={persona} px={px} radio="rounded-full" className={className} />
);

/**
 * Cara chica + nombre corto, para meter una persona dentro de un renglón.
 * `truncate` necesita el `min-w-0` de al lado — sin él un flex item no achica.
 */
// `sala` gana sobre `persona`: cuando lo que espera es una SALA —el traslado—,
// no hay cara que poner y un nombre suelto sería el de uno de varios. Va el
// mismo icono con el que el portal nombra una sucursal en todos lados
// (`FilterBar.Sucursal`), para que se lea como un lugar y no como alguien.
export const ChipPersona = ({ persona, sala = null, vacio = 'Sin asignar', className = '', soloFoto = false }) => (
    /* ── `soloFoto`: la cara sin el nombre ────────────────────────────────
     * Para las tarjetas apretadas —media columna en una rejilla de dos— donde
     * el circuito es contexto y no titular: dos caras con una flecha en medio
     * dicen «de quién a quién» sin gastar el renglón que necesita el dato de la
     * acción. El nombre no se pierde: va en el `title` de quien la usa y entero
     * en el detalle.
     *
     * Es una variante del canónico y no un chip aparte a propósito: dos formas
     * de dibujar a una persona terminan divergiendo en cuanto una se toca. */
    <span className={`flex items-center gap-1.5 min-w-0 ${className}`}>
        {/* Sin persona no va un círculo vacío: un disco gris al lado del texto
            se lee como una foto que no cargó, y lo que pasa es que no hay a
            quién mostrar. */}
        {sala
            ? <Building2 size={12} strokeWidth={2.5} className="shrink-0 text-content-3" />
            : persona && <CaraPersona persona={persona} px={20} />}
        {!soloFoto && (
            <span className={`text-caption truncate ${sala || persona ? 'font-bold text-content-2' : 'font-medium text-content-3 italic'}`}>
                {sala || (persona ? shortEmployeeName(persona) : vacio)}
            </span>
        )}
    </span>
);

/**
 * La ficha de una persona dentro del detalle: quién es, qué hace y cuándo tocó
 * la solicitud.
 *
 * @param rotulo   «Solicitó», «Aprobó», «Pendiente de»…
 * @param cuando   El instante que le corresponde (envío o decisión).
 * @param apunte   Una línea más abajo de la hora: cuánto tardó, cuánto lleva
 *                 esperando, o quién la canceló.
 * @param tono     'card' | 'success' | 'danger' | 'warning' — el color habla del
 *                 ESTADO, nunca del tipo de solicitud (auditoría de tema).
 */
export const FichaPersona = ({ rotulo, persona, sala = null, cuando, apunte, vacio = 'Sin asignar', tono = 'card' }) => {
    /* El catálogo de salas, para poder nombrar la sucursal de quien viene del
       maestro de personal: ahí sólo hay `branch_id`. Ver `salaDePersona`. */
    const branches = useStaffStore(s => s.branches);
    const sucursal = sala ? null : salaDePersona(persona, branches);

    const fondo = {
        card:    'bg-surface-card border-border-card',
        success: 'bg-success/10 border-success/30',
        danger:  'bg-danger/10 border-danger/30',
        warning: 'bg-warning/10 border-warning/30',
    }[tono] ?? 'bg-surface-card border-border-card';

    const tinta = {
        card:    'text-content-2',
        success: 'text-success',
        danger:  'text-danger',
        warning: 'text-warning-text',
    }[tono] ?? 'text-content-2';

    /* Todo en una columna al lado de la cara, sin línea divisoria ni bloque
     * aparte para la hora. La versión con divisor medía 150px por ficha y en el
     * teléfono las dos se apilan: entre eso y el encabezado, la primera pantalla
     * se iba entera en quién pidió, y lo que hay que mirar para decidir —la
     * venta, los productos— quedaba abajo del pliegue. */
    return (
        <div className={`px-3 py-2.5 rounded-2xl border ${fondo}`}>
            {/* La sucursal, arriba a la derecha y en el renglón del rótulo.
                Pedido del usuario el 2026-08-26: «en todos donde diga Solicitó
                y Aprobó, que salga en esa misma card de qué sucursal, en la
                esquina superior derecha, para que sea más visible». Estaba —
                cuando estaba— colgando del cargo, en gris y en la letra más
                chica de la ficha: en una bandeja que mezcla siete salas, saber
                de cuál es cada quien no es una nota al pie. */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className={`text-micro font-black uppercase tracking-widest ${tinta}`}>{rotulo}</p>
                {/* Sin `title`: en un span que no se puede apuntar no llega ni
                    al lector de pantalla ni al teléfono (§15.10). Los nombres
                    de las siete salas son cortos y entran enteros. */}
                {sucursal && (
                    <span className="flex items-center gap-1 min-w-0 shrink-0">
                        <Building2 size={11} strokeWidth={2.5} className="shrink-0 text-content-3" />
                        <span className="text-micro font-black uppercase tracking-widest text-content-2 truncate">
                            {sucursal}
                        </span>
                    </span>
                )}
            </div>
            <div className="flex items-start gap-2.5 min-w-0">
                {/* Una sala no tiene cara: en su lugar va el icono de sucursal,
                    del mismo tamaño que el avatar para que las dos fichas
                    queden alineadas. */}
                {sala
                    ? <span className="w-9 h-9 rounded-full border border-border-card bg-surface-card-hover
                                       flex items-center justify-center shrink-0">
                        <Building2 size={16} strokeWidth={2.5} className="text-content-3" />
                      </span>
                    : persona && <CaraPersona persona={persona} px={36} />}
                <div className="min-w-0 flex-1">
                    <p className={`text-body-sm leading-tight truncate ${sala || persona ? 'font-bold text-content' : 'font-medium text-content-3 italic'}`}>
                        {sala || (persona ? shortEmployeeName(persona) : vacio)}
                    </p>
                    {sala && (
                        <p className="text-micro text-content-3 leading-tight truncate">
                            La sala que tiene el producto
                        </p>
                    )}
                    {/* Sólo el cargo: la sala ya está arriba a la derecha, y
                        decirla dos veces gasta el renglón que necesita el cargo
                        entero. */}
                    {!sala && persona?.role && (
                        <p className="text-micro text-content-3 leading-tight truncate">
                            {persona.role}
                        </p>
                    )}
                    {(cuando || apunte) && (
                        <p className="text-caption text-content-2 font-medium leading-tight mt-1">
                            {cuando && fmtFechaHora(cuando)}
                            {cuando && apunte && <span className="text-content-3"> · </span>}
                            {apunte && <span className="text-content-3">{apunte}</span>}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Las dos puntas de la solicitud, lado a lado: quién la mandó y en qué terminó.
 *
 * Va arriba de todo el detalle porque es lo que uno pregunta antes de leer nada
 * más — y porque hasta hoy no estaba en ninguna parte: el modal repetía el
 * nombre de quien pedía y no decía ni quién la había resuelto ni cuándo.
 *
 * El estado manda el rótulo y el tono de la segunda ficha:
 *   · PENDIENTE  → a quién le toca decidir, y cuánto lleva esperando.
 *   · APROBADA   → quién la aprobó, a qué hora y en cuánto tiempo.
 *   · RECHAZADA  → lo mismo, en rojo.
 *   · CANCELADA  → no hay aprobador: la retiró quien la mandó.
 */
export const BloquePersonas = ({ req, empleadosPorId }) => {
    const ahora = useNowTick(60_000);
    const { solicitante, aprobador } = personasDe(req, empleadosPorId);

    const cerro = cuandoSeDecidio(req);
    const cancelada = req.status === 'CANCELLED';
    const rechazada = req.status === 'REJECTED';
    const pendiente = req.status === 'PENDING';

    // Un traslado pendiente lo espera la SALA que tiene el producto, no una
    // persona. Ya decidido, `aprobador` vuelve a ser quien de verdad lo
    // resolvió: lo firma el trigger `firmar_quien_decide` con
    // `auth_employee_id()`. Antes lo escribía cada camino por su cuenta, y el
    // rechazo del traslado no lo escribía: quedaba el primer destinatario del
    // enrutado, o sea un nombre real y equivocado.
    const esperaSala = salaQueEspera(req);

    const rotulo = pendiente ? 'Pendiente de'
        : cancelada ? 'Cancelada'
        : rechazada ? 'Rechazó'
        : 'Aprobó';

    const tono = pendiente ? 'warning' : cancelada ? 'card' : rechazada ? 'danger' : 'success';

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <FichaPersona
                rotulo="Solicitó"
                persona={solicitante}
                vacio="Sin nombre"
                cuando={req.created_at}
                /* La antigüedad va acá sólo si la solicitud ya se cerró. Mientras
                   está pendiente, el tiempo que importa es el que lleva
                   ESPERANDO, y lo dice la ficha de al lado — ponerlo en las dos
                   era la misma frase dos veces. */
                apunte={pendiente ? '' : desdeHace(req.created_at, ahora)}
            />
            <FichaPersona
                rotulo={rotulo}
                persona={cancelada ? null : aprobador}
                sala={cancelada ? null : esperaSala}
                /* Un ajuste de Min/Max no tiene aprobador asignado —su tabla no
                   guarda uno— y lo resuelve quien tenga el permiso del módulo.
                   «Sin asignar» ahí sonaría a destinatario perdido. */
                vacio={cancelada ? 'La retiró quien la envió'
                    : !pendiente ? 'Sin registro'
                    : req.type === 'MINMAX_CHANGE_REQUEST' ? 'Quien administre Min/Max'
                    : 'Sin asignar'}
                cuando={cancelada ? req.updated_at : cerro}
                apunte={pendiente
                    ? `Esperando ${desdeHace(req.created_at, ahora)}`
                    : cuantoTardo(req.created_at, cancelada ? req.updated_at : cerro)}
                tono={tono}
            />
        </div>
    );
};
