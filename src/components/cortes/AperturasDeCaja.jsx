import React, { useMemo } from 'react';
import { Clock, DoorOpen, KeyRound, Search, UserX } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import TablePagination from '../common/TablePagination';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import { EmptyState } from '../common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { tokenMatch } from '../../utils/searchUtils';
import { usePaginaEnUrl } from '../../hooks/usePaginaEnUrl';

/**
 * Quién abrió la caja de cada sala, a qué hora y con cuánto.
 *
 * ── La pregunta que hoy no tiene dónde contestarse ─────────────────────────
 * Medido el 28-ago-2026: TRES de las seis salas abren y cortan bajo una cuenta
 * compartida —«MI CAJA LA POPULAR», «MI CAJA LA SALUD 2», «MI CAJA LA SALUD 5»—,
 * o sea 185 de los 452 cortes desde el 14-ago, y en los 452 el corte no está
 * ligado a ninguna ficha. «¿Quién cortó?» no tenía respuesta.
 *
 * ── Se llama «Aperturas» y no «Turnos» a propósito ─────────────────────────
 * «Turno» ya significa otra cosa en el portal —el turno de trabajo de
 * Horarios— y el sistema de la caja lo usa para un tercero: el número 1, 2 ó 3
 * que sale en el tiquete dentro de una misma apertura. Tres cosas con el mismo
 * rótulo es lo que después nadie entiende. «Apertura» es además la palabra que
 * usa la sala.
 *
 * ── El cruce con la marcación NO acusa a nadie por un permiso ajeno ────────
 * La regla del usuario (2026-08-28) es que por ahora **cualquiera de la sala
 * puede abrir la caja**: el cruce contra la marcación es un HALLAZGO, no un
 * candado. Y una consulta vacía tiene tres causas que se ven iguales —nadie
 * marcó, no hay permiso para leer la asistencia, o el kiosco todavía no
 * arrancó—, así que la columna sólo acusa cuando el período tiene alguna
 * marcación; si no, dice «sin marcaciones» en gris y el aviso de arriba explica
 * cuál de las tres es.
 */

const COLS = [
    { key: 'sala',      label: 'Sala',       align: 'left'   },
    { key: 'quien',     label: 'Quién abrió', align: 'left'  },
    { key: 'abrio',     label: 'Abrió',      align: 'left'   },
    { key: 'marcacion', label: 'Marcó entrada', align: 'center', hideBelow: 'md' },
    { key: 'estado',    label: 'Estado',     align: 'center', hideBelow: 'md' },
    { key: 'monto',     label: 'Esperado',   align: 'right'  },
];

const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');

const fechaCorta = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', timeZone: 'UTC',
    })
    : '—');

const horaDe = (iso) => (iso
    ? new Date(iso).toLocaleTimeString('es-SV', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador',
    })
    : '—');

/** «06:55:49» y una marcación → cuántos minutos antes (o después) se marcó. */
function minutosAntes(abiertaA, marcaIso) {
    if (!abiertaA || !marcaIso) return null;
    const marca = new Date(marcaIso);
    const [h, m] = String(abiertaA).split(':').map(Number);
    // La marcación se compara en hora de sala, que es la del `abierta_a`.
    const enSala = new Date(marca.getTime() - 6 * 3600_000);
    const minutosMarca = enSala.getUTCHours() * 60 + enSala.getUTCMinutes();
    return (h * 60 + m) - minutosMarca;
}

export default function AperturasDeCaja({
    aperturas = [],
    entradas = [],
    pudeLeerAsistencia = true,
    salas,
    cargando = false,
    busqueda = '',
    onLimpiarBusqueda,
}) {
    // La PRIMERA marcación de entrada de cada persona en cada día. La primera y
    // no la última: quien marca, sale a almorzar y vuelve tiene varias, y la que
    // se compara contra la apertura es con la que llegó.
    const porPersona = useMemo(() => {
        const pp = new Map();
        for (const e of entradas) {
            const dia = new Date(new Date(e.timestamp).getTime() - 6 * 3600_000)
                .toISOString().slice(0, 10);
            const clave = `${e.employee_id}:${dia}`;
            if (!pp.has(clave)) pp.set(clave, e.timestamp);
        }
        return pp;
    }, [entradas]);

    // «No marcó» sólo se puede afirmar si en el período hubo marcaciones: sin
    // eso, lo único cierto es que no hay con qué cruzar. Es la misma regla del
    // gate que no pudo medir — un cero de un instrumento apagado no es un cero.
    const hayConQueCruzar = pudeLeerAsistencia && entradas.length > 0;

    const filtrados = useMemo(() => aperturas.filter((a) => tokenMatch(
        busqueda, salas?.get(a.branch_id), a.empleado_texto, a.abierta_a, a.abierta_el,
    )), [aperturas, busqueda, salas]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    if (!cargando && filtrados.length === 0) {
        return busqueda ? (
            <EmptyState
                compact icon={Search} title="Sin resultados"
                subtitle={`Ninguna apertura coincide con «${busqueda}».`}
                action={<Button variant="secondary" onClick={onLimpiarBusqueda}>Limpiar la búsqueda</Button>}
            />
        ) : (
            <EmptyState
                compact icon={DoorOpen} title="Sin aperturas"
                subtitle="Ninguna sala abrió caja en estas fechas. Se empezaron a registrar el 28 de agosto."
            />
        );
    }

    const sinCuenta = filtrados.filter((a) => !a.employee_id).length;

    return (
        <>
            {/* El aviso va arriba y no en cada fila: es una condición del
                período entero, y repetirla en seis filas la vuelve ruido. */}
            {!cargando && !pudeLeerAsistencia && (
                <Notice variant="info" icon={KeyRound}>
                    No se puede cruzar contra la marcación con este permiso, así que la columna
                    queda vacía. No significa que nadie haya marcado.
                </Notice>
            )}

            {!cargando && pudeLeerAsistencia && entradas.length === 0 && (
                <Notice variant="info" icon={Clock}>
                    Todavía no hay marcaciones en estas fechas, así que la columna «Marcó entrada»
                    queda vacía. Se llena sola cuando el kiosco empiece a usarse.
                </Notice>
            )}

            {!cargando && sinCuenta > 0 && (
                <Notice variant="warning" icon={UserX}>
                    <span className="font-bold">
                        {sinCuenta === 1
                            ? 'Una caja se abrió con una cuenta que no es una persona'
                            : `${sinCuenta} cajas se abrieron con una cuenta que no es una persona`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Mientras la caja se abra así, el corte no se le puede atribuir a nadie.
                    </span>
                </Notice>
            )}

            <DataTable
                columns={COLS}
                loading={cargando}
                /* La fila no tiene destino propio —todo lo que hay que saber
                   está en la ficha—, así que NO lleva `usarAccionDeFila`: sin
                   `onClick`, `DataTable` no ofrece ninguna acción y no promete
                   un detalle que no existe. */
                movil={{ identidad: 'quien', ancla: 'monto' }}
                empty={{ icon: DoorOpen, message: 'Sin aperturas en el período' }}
            >
                {pagina.map((a, i) => {
                    const dia = a.abierta_el;
                    const marca = a.employee_id ? porPersona.get(`${a.employee_id}:${dia}`) : null;
                    const desfase = minutosAntes(a.abierta_a, marca);
                    return (
                        <DataRow key={a.id} index={i}>
                            <DataCell>
                                <span className="text-content-2 text-body-sm">{salas?.get(a.branch_id) || '—'}</span>
                            </DataCell>
                            <DataCell>
                                {a.employee_id
                                    ? <span className="text-content font-medium text-body-sm">{a.empleado_texto}</span>
                                    : <Badge variant="warning" size="sm">{a.empleado_texto || 'Sin nombre'}</Badge>}
                            </DataCell>
                            <DataCell>
                                <span className="tabular-nums text-content-2">
                                    {fechaCorta(dia)} · {hhmm(a.abierta_a)}
                                </span>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                {marca
                                    ? (
                                        <Badge variant={desfase != null && desfase < 0 ? 'warning' : 'success'} size="sm">
                                            {horaDe(marca)}
                                        </Badge>
                                    )
                                    : !hayConQueCruzar
                                        ? <span className="text-content-3 text-micro">sin marcaciones</span>
                                        : a.employee_id
                                            ? <Badge variant="danger" size="sm">no marcó</Badge>
                                            : <span className="text-content-3 text-micro">—</span>}
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                {a.cerrada_at
                                    ? <span className="text-content-3 text-micro">cerró · {horaDe(a.cerrada_at)}</span>
                                    : <Badge variant="success" size="sm">Abierta</Badge>}
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content">
                                    {formatMoney(a.monto_registrado)}
                                </span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > pageSize && (
                <TablePagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    total={filtrados.length}
                    unit="aperturas"
                />
            )}
        </>
    );
}
