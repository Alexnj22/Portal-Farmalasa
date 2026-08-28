import React, { useCallback, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, History, Pencil, Search, Trash2, Wallet } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import TablePagination from '../common/TablePagination';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import { EmptyState } from '../common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { tokenMatch } from '../../utils/searchUtils';
import { usePaginaEnUrl } from '../../hooks/usePaginaEnUrl';

/**
 * Los movimientos de caja de un período: verlos y buscarlos TODOS.
 *
 * ── Por qué esta lista existe aparte del detalle de un corte ───────────────
 * `CorteDetalleModal` ya muestra los movimientos de un día para explicar UNA
 * diferencia. Eso contesta «¿por qué no cuadró este corte?», y deja sin
 * contestar la otra pregunta, que es la que trajo esta pantalla: «¿qué se movió
 * en la caja, y quién lo tocó después?».
 *
 * ── Lo que hay que poder ver, y antes no se veía ───────────────────────────
 * Un movimiento se puede EDITAR y BORRAR en el sistema de la caja sin dejar
 * rastro. Desde v2.838.0 la captura lo anota, así que acá una fila puede estar
 * en tres estados y los tres importan:
 *
 *   vigente       está en el sistema y nadie lo tocó.
 *   editado       cambió el monto, el concepto o el tipo después de guardarse.
 *   ya no está    desapareció del sistema. La fila se queda: es lo ÚNICO que
 *                 queda de él, y borrarla acá sería repetir el olvido.
 *
 * El caso real que lo pide: el 22-ago en Salud 1 apareció un ingreso de $454.00
 * —el monto exacto del sobrante del corte anterior— que dejó la diferencia en
 * cero. Un movimiento así no se distingue de uno legítimo mirando el monto; se
 * distingue mirando CUÁNDO apareció y contra qué corte.
 *
 * ── El toque abre la historia, no una hoja genérica ────────────────────────
 * Por eso `usarAccionDeFila`: en el teléfono la fila es una ficha y su destino
 * real es el historial de ese movimiento. Y el detalle va en un modal y no en
 * un `<tr>` expandido justamente para que el teléfono y el escritorio abran lo
 * mismo — un `<tr colSpan>` no se pinta en modo ficha.
 */

const COLS = [
    { key: 'fecha',    label: 'Fecha',    align: 'left'   },
    { key: 'sala',     label: 'Sala',     align: 'left',   hideBelow: 'md' },
    { key: 'concepto', label: 'Concepto', align: 'left'   },
    { key: 'estado',   label: 'Estado',   align: 'center', hideBelow: 'md' },
    { key: 'monto',    label: 'Monto',    align: 'right'  },
];

const fechaCorta = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', timeZone: 'UTC',
    })
    : '—');

const cuando = (iso) => (iso
    ? new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/El_Salvador',
    })
    : '—');

// El rótulo de un cambio, en términos de lo que pasó y no del código.
const CAMBIOS = {
    APARECIO:     { texto: 'Se anotó',       variant: 'info',    icon: Wallet },
    EDITADO:      { texto: 'Se modificó',    variant: 'warning', icon: Pencil },
    DESAPARECIO:  { texto: 'Se borró',       variant: 'danger',  icon: Trash2 },
    REAPARECIO:   { texto: 'Volvió a estar', variant: 'info',    icon: History },
};

export default function MovimientosDeCaja({
    movimientos = [],
    historial = [],
    salas,
    cargando = false,
    busqueda = '',
    tipo = 'TODOS',
    estado = 'TODOS',
    onLimpiarBusqueda,
}) {
    const [abierto, setAbierto] = useState(null);

    // La historia agrupada por movimiento, una vez. Sin esto, marcar «editado»
    // en la tabla costaría un recorrido del historial por fila.
    const historiaPorMov = useMemo(() => {
        const m = new Map();
        for (const h of historial) {
            const clave = `${h.branch_id}:${h.erp_movimiento_id}`;
            if (!m.has(clave)) m.set(clave, []);
            m.get(clave).push(h);
        }
        return m;
    }, [historial]);

    const historiaDe = useCallback(
        (mov) => historiaPorMov.get(`${mov.branch_id}:${mov.erp_movimiento_id}`) || [],
        [historiaPorMov],
    );

    // «Editado» es haber cambiado DESPUÉS de anotarse: un `APARECIO` suelto es
    // la vida normal de cualquier movimiento, no un hallazgo.
    const fueEditado = useCallback(
        (mov) => historiaDe(mov).some((h) => h.cambio === 'EDITADO'),
        [historiaDe],
    );

    const filtrados = useMemo(() => movimientos.filter((m) => {
        if (tipo !== 'TODOS' && m.tipo !== tipo) return false;
        if (estado === 'VIGENTES'      && m.desaparecido_at) return false;
        if (estado === 'DESAPARECIDOS' && !m.desaparecido_at) return false;
        if (estado === 'EDITADOS'      && !fueEditado(m)) return false;
        return tokenMatch(busqueda, m.concepto, salas?.get(m.branch_id), String(m.monto), m.tipo);
    }), [movimientos, tipo, estado, busqueda, salas, fueEditado]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    if (!cargando && filtrados.length === 0) {
        return busqueda ? (
            <EmptyState
                compact icon={Search} title="Sin resultados"
                subtitle={`Ningún movimiento coincide con «${busqueda}».`}
                action={<Button variant="secondary" onClick={onLimpiarBusqueda}>Limpiar la búsqueda</Button>}
            />
        ) : (
            <EmptyState
                compact icon={Wallet} title="Sin movimientos"
                subtitle="No se anotó ninguna entrada ni salida de efectivo en estas fechas."
            />
        );
    }

    return (
        <>
            <DataTable
                columns={COLS}
                loading={cargando}
                /* La primera celda es la fecha, pero a esta lista se entra
                   buscando QUÉ se movió: la identidad es el concepto y el ancla,
                   el monto. Y `usarAccionDeFila` porque la fila tiene destino
                   propio —la historia de ese movimiento—, que sin declararlo
                   perdería contra la hoja genérica (§32.8). */
                movil={{ usarAccionDeFila: true, identidad: 'concepto', ancla: 'monto' }}
                empty={{ icon: Wallet, message: 'Sin movimientos en el período' }}
            >
                {pagina.map((m, i) => {
                    const editado = fueEditado(m);
                    const ido = Boolean(m.desaparecido_at);
                    return (
                        <DataRow key={m.id} index={i} onClick={() => setAbierto(m)}>
                            <DataCell>
                                <span className="tabular-nums text-content-2 font-semibold">{fechaCorta(m.fecha)}</span>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <span className="text-content-2 text-body-sm">{salas?.get(m.branch_id) || '—'}</span>
                            </DataCell>
                            <DataCell>
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {m.tipo === 'ENTRADA'
                                        ? <ArrowDownLeft size={13} className="text-success-text shrink-0" title="Entra a la caja" />
                                        : <ArrowUpRight  size={13} className="text-warning-text shrink-0" title="Sale de la caja" />}
                                    <span className={`truncate text-body-sm ${ido ? 'text-content-3 line-through' : 'text-content'}`}>
                                        {m.concepto || 'Sin concepto'}
                                    </span>
                                </div>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                {ido ? <Badge variant="danger" size="sm">Ya no está</Badge>
                                    : editado ? <Badge variant="warning" size="sm">Se modificó</Badge>
                                        : m.origen === 'PORTAL' ? <Badge variant="info" size="sm">Del portal</Badge>
                                            : <span className="text-content-3 text-micro">—</span>}
                            </DataCell>
                            <DataCell align="right">
                                <span className={`tabular-nums font-bold ${ido ? 'text-content-3 line-through'
                                    : m.tipo === 'ENTRADA' ? 'text-success-text' : 'text-content'}`}>
                                    {m.tipo === 'SALIDA' ? '−' : ''}{formatMoney(m.monto)}
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
                    unit="movimientos"
                />
            )}

            <DetalleDelMovimiento
                movimiento={abierto}
                historia={abierto ? historiaDe(abierto) : []}
                sala={abierto ? salas?.get(abierto.branch_id) : ''}
                onClose={() => setAbierto(null)}
            />
        </>
    );
}

/**
 * La ficha de un movimiento y todo lo que se le vio cambiar.
 *
 * Muestra `visto_at` incluso cuando no pasó nada: «se confirmó que seguía ahí a
 * tal hora» es información, y su ausencia es lo que haría dudar de un
 * «desapareció» — la marca sólo vale si se sabe cuándo fue la última vez que se
 * miró.
 */
function DetalleDelMovimiento({ movimiento, historia, sala, onClose }) {
    if (!movimiento) return null;
    const ido = Boolean(movimiento.desaparecido_at);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Detalle del movimiento de caja">
            <div className="p-5 space-y-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        {movimiento.tipo === 'ENTRADA'
                            ? <ArrowDownLeft size={16} className="text-success-text" />
                            : <ArrowUpRight size={16} className="text-warning-text" />}
                        <span className="text-caption font-black uppercase tracking-widest text-content-2">
                            {movimiento.tipo === 'ENTRADA' ? 'Entrada de efectivo' : 'Salida de efectivo'}
                        </span>
                        {ido && <Badge variant="danger" size="sm">Ya no está</Badge>}
                    </div>
                    <p className="text-h3 font-bold text-content">
                        {movimiento.tipo === 'SALIDA' ? '−' : ''}{formatMoney(movimiento.monto)}
                    </p>
                    <p className="text-body-sm text-content-2">{movimiento.concepto || 'Sin concepto'}</p>
                    <p className="text-caption text-content-3">
                        {sala || '—'} · {fechaCorta(movimiento.fecha)}
                        {movimiento.origen === 'PORTAL' && ' · anotado por el portal'}
                    </p>
                </div>

                <div className="text-caption text-content-3 space-y-0.5">
                    <p>Visto por última vez: {cuando(movimiento.visto_at)}</p>
                    {ido && <p className="text-danger-text font-semibold">Dejó de estar: {cuando(movimiento.desaparecido_at)}</p>}
                </div>

                <div className="space-y-2">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                        Qué se le vio cambiar
                    </h4>
                    {historia.length === 0 ? (
                        <p className="text-body-sm text-content-3">
                            Nada desde que se anotó. Los cambios se registran desde el 28 de agosto.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {historia.map((h) => {
                                const c = CAMBIOS[h.cambio] || CAMBIOS.APARECIO;
                                const Icono = c.icon;
                                return (
                                    <li key={h.id} className="flex gap-2.5">
                                        <Icono size={14} className="mt-0.5 shrink-0 text-content-3" />
                                        <div className="min-w-0">
                                            <p className="text-body-sm text-content">
                                                <span className="font-semibold">{c.texto}</span>
                                                <span className="text-content-3"> · {cuando(h.observado_at)}</span>
                                            </p>
                                            {h.cambio === 'EDITADO' && (
                                                <p className="text-caption text-content-2">
                                                    {Number(h.monto_antes) !== Number(h.monto_despues)
                                                        && `${formatMoney(h.monto_antes)} → ${formatMoney(h.monto_despues)}`}
                                                    {h.concepto_antes !== h.concepto_despues
                                                        && ` «${h.concepto_antes || '—'}» → «${h.concepto_despues || '—'}»`}
                                                    {h.tipo_antes !== h.tipo_despues
                                                        && ` ${h.tipo_antes} → ${h.tipo_despues}`}
                                                </p>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex justify-end">
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                </div>
            </div>
        </LiquidModal>
    );
}
