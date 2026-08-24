import React, { useMemo } from 'react';
import { Ban, PackageCheck, CornerUpLeft } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { EmptyState } from '../../components/common/StateViews';
import { ChipPersona } from '../solicitudes/PersonasSolicitud';
import { fmtFechaLarga, resumenItems } from './trasladoTexto';

/**
 * El historial de traslados, en TARJETAS y agrupado.
 *
 * ── Por qué deja de ser una tabla ──────────────────────────────────────────
 * Lo era desde el 2026-08-07, y por un buen motivo escrito: un historial es una
 * lista de REGISTROS, y `DataTable` da la tabla en escritorio, las fichas en el
 * teléfono y el vacío, los tres de una.
 *
 * Lo que esa forma no puede dar es lo que el usuario pidió el 2026-08-24:
 * **«que se vean siempre como cards, si alcance todos que se separe por
 * sucursal y por rechazado / aprobado»**. Una tabla tiene UN encabezado y una
 * sola tira de filas; meter dos niveles de corte adentro obliga a filas-título
 * que no son registros —lo dice el propio comentario que este archivo
 * reemplaza: «el historial es una tabla donde un encabezado de grupo no
 * entra»—. Con tarjetas el corte es la estructura del documento y no un
 * remiendo dentro de una fila.
 *
 * ── Los dos cortes, y en ese orden ─────────────────────────────────────────
 * **Sucursal primero, desenlace después.** Quien mira las siete salas viene a
 * preguntar «¿qué pasó en Bodega?», y recién adentro «¿qué salió y qué se
 * rechazó?». Al revés —dos bloques grandes y las salas mezcladas adentro— hay
 * que recorrer la lista entera para juntar lo de una sala.
 *
 * **La sucursal es el ORIGEN**, no el destino: el desenlace que agrupa —
 * recibido o rechazado— es la decisión de la sala que TIENE el producto. Cortar
 * por destino pondría bajo un mismo título decisiones de seis salas distintas y
 * el segundo corte dejaría de significar algo.
 *
 * Y el corte por sucursal existe **sólo con alcance sobre todas**: con una sola
 * sala a la vista, un único título repetido no separa nada — es ruido con
 * forma de estructura.
 */

/** El desenlace de un traslado cerrado, que es lo que corta el segundo nivel. */
const esRechazado = (f) => f.status === 'REJECTED';

/**
 * Un traslado cerrado.
 *
 * Lleva TODO lo que la tabla repartía en siete columnas —incluidas las tres que
 * se escondían por debajo de `lg`—. En la tabla eso se recuperaba abriendo la
 * ficha del teléfono; acá no hay dónde abrir, así que si un dato no se dibuja,
 * no existe. Y el que más se escondía era el MOTIVO, que es justamente lo que
 * uno viene a leer en un historial.
 */
export function TarjetaHistorial({ fila, personaPor }) {
    const m = fila.metadata ?? {};
    const rechazado = esRechazado(fila);
    const motivo = rechazado
        ? [m.rejection_reason, m.sugerencia].filter(Boolean).join(' — ')
        : (fila.note || '');

    return (
        <div data-surface="card" className="px-4 py-3.5 flex flex-col gap-2.5 h-full">
            <div className="flex items-start gap-2.5">
                {rechazado
                    ? <Ban size={15} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    : <PackageCheck size={15} className="text-success-text shrink-0 mt-0.5" strokeWidth={2.5} />}
                <div className="flex-1 min-w-0">
                    {/* El ancla: qué producto. `line-clamp-2` y no `truncate`
                        porque dos productos se distinguen por el final —la
                        presentación—, y cortados en una línea quedan idénticos. */}
                    <p className="text-body-sm font-black text-content leading-snug line-clamp-2"
                        title={resumenItems(m)}>
                        {resumenItems(m)}
                    </p>
                    <p className="mt-1 text-label font-bold text-content-2 truncate">
                        {m.origen_branch_name ?? '—'}
                        <span className="text-content-3 font-medium"> → </span>
                        {m.branch_name ?? '—'}
                    </p>
                </div>
                <Badge variant={rechazado ? 'danger' : 'success'} size="sm">
                    {rechazado ? 'Rechazado' : 'Recibido'}
                </Badge>
            </div>

            {/* El motivo, entero. Era la columna que se escondía por debajo de
                `lg` y la que contesta la única pregunta que un historial tiene
                que contestar cuando alguien viene a preguntar. */}
            {motivo && (
                <p className="text-label text-content-2 leading-snug line-clamp-3" title={motivo}>
                    {motivo}
                </p>
            )}

            {/* Las dos puntas del circuito, con su fecha: quién pidió y cuándo,
                quién decidió y cuándo. Sin las dos fechas no hay forma de saber
                cuánto tardó, que es la otra mitad de lo que un historial dice. */}
            <div className="mt-auto pt-2.5 border-t border-divider grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="min-w-0">
                    <p className="text-micro font-black uppercase tracking-widest text-content-3">Pidió</p>
                    <ChipPersona persona={personaPor?.(fila.employee_id)} vacio="Sin registro" />
                    <p className="text-micro text-content-3 tabular-nums mt-0.5">
                        {fmtFechaLarga(fila.created_at)}
                    </p>
                </div>
                <div className="min-w-0">
                    <p className="text-micro font-black uppercase tracking-widest text-content-3">
                        {rechazado ? 'Rechazó' : 'Despachó'}
                    </p>
                    <ChipPersona persona={personaPor?.(fila.approver_id)} vacio="Sin registro" />
                    <p className="text-micro text-content-3 tabular-nums mt-0.5">
                        {fmtFechaLarga(fila.updated_at ?? fila.created_at)}
                    </p>
                </div>
            </div>
        </div>
    );
}

/** Un envío cerrado — otra pregunta, así que otra tarjeta. */
export function TarjetaEnvioCerrado({ envio }) {
    const lineas = envio.lineas ?? [];
    const acept = lineas.filter(l => l.estado === 'aceptada').length;
    const devue = lineas.filter(l => String(l.estado).startsWith('devuelta')).length;
    const devueltas = lineas
        .filter(l => String(l.estado).startsWith('devuelta'))
        .map(l => `${l.descripcion ?? l.erp_product_id} (${l.motivo_rechazo ?? 'sin motivo'})`);

    return (
        <div data-surface="card" className="px-4 py-3.5 flex flex-col gap-2.5 h-full">
            <div className="flex items-start gap-2.5">
                {devue > 0
                    ? <CornerUpLeft size={15} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    : <PackageCheck size={15} className="text-success-text shrink-0 mt-0.5" strokeWidth={2.5} />}
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content leading-snug truncate">
                        {envio.origen_branch_name ?? '—'}
                        <span className="text-content-3 font-medium"> → </span>
                        {envio.branch_name ?? '—'}
                    </p>
                    <p className="mt-1 text-label text-content-2 line-clamp-2" title={envio.reason ?? ''}>
                        <span className="font-bold">{envio.motivo_tipo ?? '—'}</span>
                        {envio.reason && envio.reason !== envio.motivo_tipo ? ` · ${envio.reason}` : ''}
                    </p>
                </div>
                {/* Cuánto se quedó y cuánto volvió. Un envío NO tiene un
                    desenlace sino uno por renglón —la sala se quedó tres y
                    devolvió dos—, y por eso este número no se puede resumir en
                    una palabra ni sirve para agrupar. */}
                <span className="text-label font-bold whitespace-nowrap shrink-0">
                    <span className="text-success-text">{acept}</span>
                    <span className="text-content-3"> / </span>
                    <span className={devue > 0 ? 'text-danger-text' : 'text-content-3'}>{devue}</span>
                </span>
            </div>

            {devueltas.length > 0 && (
                <p className="text-label text-content-2 leading-snug line-clamp-3"
                    title={devueltas.join('; ')}>
                    <span className="font-black uppercase tracking-widest text-micro text-content-3">Devuelto </span>
                    {devueltas.join('; ')}
                </p>
            )}

            <p className="mt-auto pt-2.5 border-t border-divider text-micro text-content-3 tabular-nums">
                {fmtFechaLarga(envio.updated_at ?? envio.created_at)}
            </p>
        </div>
    );
}

/** El encabezado de un corte, con su cuenta. */
function Titulo({ children, cuenta, tono = 'text-content-2' }) {
    return (
        <p className={`text-caption font-black uppercase tracking-widest px-1 ${tono}`}>
            {children}
            {cuenta != null && <span className="text-content-3"> · {cuenta}</span>}
        </p>
    );
}

/* `grid-cols-1` explícito: sin la pista base, en el teléfono la implícita es
 * `auto` y se dimensiona al contenido, no al contenedor — la rejilla se sale de
 * lado. Ver `feedback_una_rejilla_sin_pista_base_se_dimensiona_al_contenido`. */
const REJILLA = 'grid grid-cols-1 gap-2.5 xl:grid-cols-2';

/** Los dos bloques del desenlace, dentro de una sucursal o del todo. */
function PorDesenlace({ filas, personaPor }) {
    const recibidos = filas.filter(f => !esRechazado(f));
    const rechazados = filas.filter(esRechazado);
    return (
        <>
            {recibidos.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Titulo cuenta={recibidos.length} tono="text-success-text">Recibidos</Titulo>
                    <div className={REJILLA}>
                        {recibidos.map(f => (
                            <TarjetaHistorial key={f.id} fila={f} personaPor={personaPor} />
                        ))}
                    </div>
                </div>
            )}
            {rechazados.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Titulo cuenta={rechazados.length} tono="text-danger-text">Rechazados</Titulo>
                    <div className={REJILLA}>
                        {rechazados.map(f => (
                            <TarjetaHistorial key={f.id} fila={f} personaPor={personaPor} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

/**
 * El historial entero: tarjetas, cortadas por sucursal y por desenlace.
 *
 * @param filas         traslados cerrados, ya filtrados por la vista
 * @param envios        envíos cerrados, ya filtrados
 * @param porSucursal   cortar por sala de origen (sólo con alcance de todas)
 * @param personaPor    id → persona, con el respaldo que usa la vista
 */
export default function HistorialTraslados({
    filas = [], envios = [], porSucursal = false, personaPor, vacio,
}) {
    /* El orden de las salas NO es alfabético: es por cuántos traslados cerró
     * cada una. Quien abre esta pestaña con las siete a la vista busca dónde
     * pasó algo, y una lista alfabética esconde a la que más movió detrás de la
     * que no movió nada. El desempate sí es por nombre, para que dos salas con
     * la misma cuenta no se turnen entre recargas. */
    const grupos = useMemo(() => {
        if (!porSucursal) return null;
        const mapa = new Map();
        for (const f of filas) {
            const sala = f.metadata?.origen_branch_name || 'Sin sala';
            if (!mapa.has(sala)) mapa.set(sala, []);
            mapa.get(sala).push(f);
        }
        return [...mapa.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }, [filas, porSucursal]);

    const enviosPorSala = useMemo(() => {
        if (!porSucursal) return null;
        const mapa = new Map();
        for (const e of envios) {
            const sala = e.origen_branch_name || 'Sin sala';
            if (!mapa.has(sala)) mapa.set(sala, []);
            mapa.get(sala).push(e);
        }
        return [...mapa.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }, [envios, porSucursal]);

    if (!filas.length && !envios.length) return <EmptyState {...vacio} />;

    return (
        <div className="flex flex-col gap-6">
            {filas.length > 0 && (porSucursal ? (
                grupos.map(([sala, deLaSala]) => (
                    <div key={sala} className="flex flex-col gap-3">
                        {/* La sala manda sobre el desenlace: es el título del
                            bloque y por eso va más pesado y con una línea que lo
                            separa del anterior. */}
                        <p className="text-body-sm font-black text-content uppercase tracking-tight
                            border-b border-divider pb-1.5 px-1">
                            {sala}
                            <span className="text-content-3 font-bold"> · {deLaSala.length}</span>
                        </p>
                        <PorDesenlace filas={deLaSala} personaPor={personaPor} />
                    </div>
                ))
            ) : (
                <div className="flex flex-col gap-3">
                    <PorDesenlace filas={filas} personaPor={personaPor} />
                </div>
            ))}

            {/* Los ENVÍOS van aparte y SIN cortar por desenlace: un envío no
                tiene uno solo —la sala se quedó tres renglones y devolvió dos—,
                así que «aprobado / rechazado» no lo describe. Lo que sí aplica
                es el corte por sucursal, que es la misma pregunta. */}
            {envios.length > 0 && (
                <div className="flex flex-col gap-3">
                    <Titulo cuenta={envios.length}>Envíos cerrados</Titulo>
                    {porSucursal ? (
                        enviosPorSala.map(([sala, deLaSala]) => (
                            <div key={sala} className="flex flex-col gap-2">
                                <p className="text-label font-black text-content-2 uppercase tracking-wide px-1">
                                    {sala}
                                    <span className="text-content-3"> · {deLaSala.length}</span>
                                </p>
                                <div className={REJILLA}>
                                    {deLaSala.map(e => <TarjetaEnvioCerrado key={e.id} envio={e} />)}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className={REJILLA}>
                            {envios.map(e => <TarjetaEnvioCerrado key={e.id} envio={e} />)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
