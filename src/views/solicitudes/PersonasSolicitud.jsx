import React from 'react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import { shortEmployeeName } from '../../utils/nameUtils';
import { useNowTick } from '../../hooks/useNowTick';
import { fmtFechaHora, desdeHace, cuantoTardo, personasDe, cuandoSeDecidio } from './movimientoTexto';

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

/** La foto, con la inicial de respaldo. `photo` viene firmada; `photo_url` es la cruda. */
export const CaraPersona = ({ persona, className = 'w-10 h-10 rounded-full' }) => (
    <LiquidAvatar
        src={persona?.photo || persona?.photo_url || null}
        alt={persona ? shortEmployeeName(persona) : ''}
        // El canónico pinta la PRIMERA letra de lo que reciba, así que va el
        // nombre corto y no las iniciales: `employeeInitials` daría «EC» y se
        // vería una «E» igual.
        fallbackText={persona ? shortEmployeeName(persona) : ''}
        className={`${className} border border-border-card`}
    />
);

/**
 * Cara chica + nombre corto, para meter una persona dentro de un renglón.
 * `truncate` necesita el `min-w-0` de al lado — sin él un flex item no achica.
 */
export const ChipPersona = ({ persona, vacio = 'Sin asignar', className = '' }) => (
    <span className={`flex items-center gap-1.5 min-w-0 ${className}`}>
        {/* Sin persona no va un círculo vacío: un disco gris al lado del texto
            se lee como una foto que no cargó, y lo que pasa es que no hay a
            quién mostrar. */}
        {persona && <CaraPersona persona={persona} className="w-5 h-5 rounded-full" />}
        <span className={`text-caption truncate ${persona ? 'font-bold text-content-2' : 'font-medium text-content-3 italic'}`}>
            {persona ? shortEmployeeName(persona) : vacio}
        </span>
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
export const FichaPersona = ({ rotulo, persona, cuando, apunte, vacio = 'Sin asignar', tono = 'card' }) => {
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
            <p className={`text-micro font-black uppercase tracking-widest mb-1.5 ${tinta}`}>{rotulo}</p>
            <div className="flex items-start gap-2.5 min-w-0">
                {persona && <CaraPersona persona={persona} className="w-9 h-9 rounded-full" />}
                <div className="min-w-0 flex-1">
                    <p className={`text-body-sm leading-tight truncate ${persona ? 'font-bold text-content' : 'font-medium text-content-3 italic'}`}>
                        {persona ? shortEmployeeName(persona) : vacio}
                    </p>
                    {persona && (persona.role || persona.branch_name) && (
                        <p className="text-micro text-content-3 leading-tight truncate">
                            {[persona.role, persona.branch_name].filter(Boolean).join(' · ')}
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
