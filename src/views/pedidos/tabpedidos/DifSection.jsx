// Extracted from TabPedidos.jsx (Bloque 6.C) — differences (dif) resolution
// section shown inside an expanded pedido card.
import { useState, useEffect, useMemo } from 'react';
import Button from '../../../components/common/Button';
import { AlertCircle, CheckCircle2, X, Loader2, Check } from 'lucide-react';
import LiquidAvatar from '../../../components/common/LiquidAvatar';
import LiquidSelect from '../../../components/common/LiquidSelect';
import { calcSolicitado, fmtRelative } from './helpers';
import Badge from '../../../components/common/Badge';
import PortalInput from '../../../components/common/PortalInput';
import { shortEmployeeName } from '../../../utils/nameUtils';
import DevolucionBloque from './DevolucionBloque';

const ERROR_TIPO_LABEL = {
    faltante:     { label: 'Faltante',        variante: 'danger'           },
    sobrante:     { label: 'Sobrante',        variante: 'success' },
    danado:       { label: 'Dañado',          variante: 'neutral'   },
    vencido:      { label: 'Vencido',         variante: 'neutral'   },
    presentacion: { label: 'Pres. distinta',  variante: 'neutral'         },
    otro:         { label: 'Otro',            variante: 'neutral'      },
    diferencia:   { label: 'Diferencia',      variante: 'warning'      },
};

const RESOLUCION_OPTS = {
    faltante:     [['envio_fisico','Enviar producto'],['ajuste_sistema','Ajuste en sistema']],
    sobrante:     [['aceptar_sobrante','Sucursal queda con sobrante'],['devolver_bodega','Devolver a bodega']],
    danado:       [['devolucion_aceptada','Aceptar devolución'],['devolucion_negada','Negar devolución']],
    vencido:      [['devolucion_aceptada','Aceptar devolución'],['devolucion_negada','Negar devolución']],
    presentacion: [['ajuste_sistema','Ajuste en sistema'],['aceptar_dif_pres','Aceptar dif. presentación']],
    otro:         [['resuelto','Resuelto'],['no_aplica','Sin solución']],
};

const RESOLUCION_LABEL = {
    envio_fisico:        'Enviar producto',
    ajuste_sistema:      'Ajuste en sistema',
    aceptar_sobrante:    'Sucursal queda con sobrante',
    devolver_bodega:     'Devolver a bodega',
    devolucion_aceptada: 'Devolución aceptada',
    devolucion_negada:   'Devolución negada',
    aceptar_dif_pres:    'Dif. presentación aceptada',
    resuelto:            'Resuelto',
    no_aplica:           'Sin solución',
};

const EVENTO_LABEL = {
    resolucion_propuesta:  'propuso resolución',
    resolucion_confirmada: 'confirmó resolución',
    resolucion_rechazada:  'rechazó resolución',
};

const DIF_MAX = 3;

export default function DifSection({ row, difItems = [], eventos = [], devoluciones = [], isBranch, busyAction, empMap = new Map(), onResolver, onCorregirBodega, onConfirmarCorreccion, onSolicitarDevolucion, onDecidirDevolucion, onMoverDevolucion, onRecibirDevolucion, readOnly = false, onNeedItems, itemsLoaded = true }) {
    const [tipoSel,    setTipoSel]    = useState({});
    const [notaSel,    setNotaSel]    = useState({});
    const [rejectOpen, setRejectOpen] = useState({});
    const [notaRec,    setNotaRec]    = useState({});
    const [showAll,    setShowAll]    = useState(false);
    const [corrNota,   setCorrNota]   = useState('');

    useEffect(() => {
        if (!itemsLoaded && onNeedItems) onNeedItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsLoaded]);

    // La devolución de cada renglón. Puede haber varias por ítem —una rechazada
    // no impide volver a pedir— pero VIVA hay una sola: lo garantiza el índice
    // único de la base. Se prefiere la viva; si no hay, se muestra la última
    // rechazada, que es la que explica por qué no se devolvió.
    const devPorItem = useMemo(() => {
        const m = new Map();
        for (const d of devoluciones) {
            const previa = m.get(d.pedido_item_id);
            if (!previa || previa.estado === 'rechazada') m.set(d.pedido_item_id, d);
        }
        return m;
    }, [devoluciones]);

    const allConfirmed  = difItems.length > 0 && difItems.every(r => r.resolucion_status === 'confirmada');
    const visibleItems  = showAll ? difItems : difItems.slice(0, DIF_MAX);
    const hiddenCount   = difItems.length - DIF_MAX;

    // Cierre a nivel sucursal (7A.1): backend listo desde 2026-06-21
    // (pedido_sucursal_status.corregido_bodega_*/confirmado_correccion_*),
    // solo faltaba este bloque de UI. Aparece tras confirmar cada item
    // individual — bodega marca la corrección global, sucursal la confirma.
    const corrBodegaEmp = row?.corregido_bodega_por      ? empMap.get(row.corregido_bodega_por)      : null;
    const corrConfEmp   = row?.confirmado_correccion_por ? empMap.get(row.confirmado_correccion_por) : null;

    return (
        <div className="border-t border-warning/30 bg-gradient-to-b from-warning/10 to-surface-card px-4 py-3 space-y-3">
            {/* El ícono ya dice el estado: llevaba además un ✓ de texto pegado
                al final del rótulo, que en versalitas queda a otra altura. */}
            <div className="flex items-center gap-1.5">
                {allConfirmed
                    ? <CheckCircle2 size={12} className="text-success shrink-0" />
                    : <AlertCircle size={12} className="text-warning shrink-0" />}
                <span className={`text-caption font-semibold uppercase tracking-wide ${allConfirmed ? 'text-success-text' : 'text-warning-text'}`}>
                    {allConfirmed ? 'Diferencias resueltas' : `Diferencias — pendiente resolución${difItems.length > 1 ? ` (${difItems.length})` : ''}`}
                </span>
            </div>

            {visibleItems.map(item => {
                const opts    = RESOLUCION_OPTS[item.error_tipo] ?? [['resuelto','Resuelto'],['no_aplica','Sin solución']];
                const selTipo = tipoSel[item.id] ?? opts[0]?.[0] ?? '';
                const isBusy  = busyAction === `res_${item.id}`;
                const et      = ERROR_TIPO_LABEL[item.error_tipo];
                const res     = item.resolucion_status;
                const qtyDiff = item.cantidad_recibida !== null && item.cantidad_recibida !== item.cantidad_asignada;
                const dev     = devPorItem.get(item.id) ?? null;
                const devViva = !!dev && dev.estado !== 'rechazada';

                const resueltoEmp   = item.resuelto_por       ? empMap.get(item.resuelto_por)       : null;
                const confirmadoEmp = item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por)  : null;
                const rechazadoEmp  = item.rechazado_por      ? empMap.get(item.rechazado_por)       : null;

                const borderCls = res === 'confirmada' ? 'border-success/30 bg-success/10'
                                : res === 'rechazada'  ? 'border-danger/30 bg-danger/10'
                                : res === 'propuesta'  ? 'border-chart-3/30 bg-chart-3/10'
                                :                        'border-warning/30 bg-surface-card';

                return (
                    <div key={item.id} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                        {/* Item header */}
                        <div className="flex items-center gap-2 px-3 py-2">
                            <span className="flex-1 text-label font-semibold text-content-2 truncate">{item.products?.nombre}</span>
                            {et && <Badge variant={et.variante} size="sm" className="shrink-0" uppercase={false}>{et.label}</Badge>}
                            {res === 'confirmada' && <CheckCircle2 size={13} className="text-success shrink-0" />}
                            {res === 'rechazada'  && <X size={13} className="text-danger shrink-0" />}
                        </div>

                        {/* Qty diff */}
                        {(qtyDiff || item.cantidad_asignada != null) && (
                            <div className="flex items-center gap-2 px-3 pb-1.5 text-caption text-content-3 flex-wrap">
                                {(() => { const sol = calcSolicitado(item); return sol != null ? <span>Solicitado: <strong className="text-content-2">{sol}</strong></span> : null; })()}
                                <span>Enviado: <strong className="text-content-2">{item.cantidad_asignada}</strong></span>
                                {item.cantidad_recibida != null && <>
                                    <span className="text-content-3">→</span>
                                    <span>Físico: <strong className={item.cantidad_recibida < item.cantidad_asignada ? 'text-danger' : 'text-success'}>{item.cantidad_recibida}</strong></span>
                                </>}
                            </div>
                        )}

                        <div className="px-3 pb-3 space-y-2">

                            {/* ── La devolución a bodega ──
                                Mientras hay una viva, las opciones de resolución
                                de abajo se esconden: son dos conversaciones sobre
                                el mismo renglón, y tenerlas a la vez es la forma
                                de que una diga que sí y la otra que no. */}
                            <DevolucionBloque
                                dev={dev} item={item} isBranch={isBranch} busyAction={busyAction}
                                empMap={empMap} readOnly={readOnly}
                                onSolicitar={onSolicitarDevolucion}
                                onDecidir={onDecidirDevolucion}
                                onMover={onMoverDevolucion}
                                onRecibir={onRecibirDevolucion}
                            />

                            {/* ── Estado: null o rechazada — BODEGA propone ── */}
                            {!devViva && (!res || res === 'rechazada') && !isBranch && !readOnly && (
                                <>
                                    {res === 'rechazada' && (
                                        <div className="flex items-start gap-1.5 text-caption bg-danger/10 rounded-lg px-2.5 py-1.5 border border-danger/30">
                                            <X size={10} className="text-danger mt-0.5 shrink-0" />
                                            <div>
                                                <span className="font-semibold text-danger-text">Rechazado</span>
                                                {rechazadoEmp && <span className="text-danger"> por {shortEmployeeName(rechazadoEmp)}</span>}
                                                {item.nota_rechazo && <p className="text-danger italic">{item.nota_rechazo}</p>}
                                            </div>
                                        </div>
                                    )}
                                    <LiquidSelect
                                        value={selTipo}
                                        onChange={v => setTipoSel(p => ({ ...p, [item.id]: v }))}
                                        options={opts.map(([v, l]) => ({ value: v, label: l }))}
                                        compact
                                        clearable={false}
                                    />
                                    <div className="flex gap-2">
                                        <PortalInput
                                            aria-label="Nota de lo seleccionado" className="flex-1" tono="chart-3" compact
                                            value={notaSel[item.id] ?? ''} onChange={e => setNotaSel(p => ({ ...p, [item.id]: e.target.value }))}
                                            placeholder="Nota (opcional)…"
                                        />
                                        <Button tone="chart-3" disabled={isBusy || !selTipo} onClick={() => onResolver(item.id, 'proponer', selTipo, notaSel[item.id] || null)}>{isBusy ? <Loader2 size={10} className="animate-spin" /> : res === 'rechazada' ? 'Volver a proponer' : 'Proponer'}</Button>
                                    </div>
                                </>
                            )}

                            {/* ── Estado: null — SUCURSAL espera ── */}
                            {!devViva && !res && isBranch && !readOnly && (
                                <p className="text-caption text-content-3 italic">Esperando resolución de bodega…</p>
                            )}

                            {/* ── Estado: propuesta — mostrar propuesta ── */}
                            {res === 'propuesta' && !readOnly && (
                                <>
                                    <div className="flex items-start gap-1.5 text-caption bg-chart-3/10 rounded-lg px-2.5 py-1.5 border border-chart-3/20">
                                        {/* `photo || photo_url` y `LiquidAvatar`: `resueltoEmp`
                                            sale de `empMap`, donde la firmada vive en `photo` y
                                            `photo_url` es la cruda de un bucket privado. Con la
                                            cruda el `<img>` da 403 — y como `photo_url` existe,
                                            el ternario tampoco caía en el ícono: quedaba un
                                            círculo vacío. Mismo caso que el resumen de
                                            recepción, corregido el 2026-08-15. */}
                                        {resueltoEmp && (
                                            <LiquidAvatar
                                                src={resueltoEmp.photo || resueltoEmp.photo_url}
                                                alt=""
                                                fallbackText={shortEmployeeName(resueltoEmp)}
                                                className="w-5 h-5 rounded-full border border-border-card shadow-sm shrink-0 mt-0.5 text-micro"
                                            />
                                        )}
                                        <div className="flex-1">
                                            <span className="font-semibold text-chart-3-text">{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</span>
                                            {resueltoEmp && <span className="text-chart-3-text"> — {shortEmployeeName(resueltoEmp)}</span>}
                                            {item.resolucion_nota && <p className="text-chart-3-text italic">{item.resolucion_nota}</p>}
                                        </div>
                                    </div>
                                    {isBranch && (
                                        rejectOpen[item.id] ? (
                                            <div className="flex gap-2">
                                                <PortalInput
                                            aria-label="Razón del rechazo" className="flex-1" tono="danger" compact
                                            value={notaRec[item.id] ?? ''} onChange={e => setNotaRec(p => ({ ...p, [item.id]: e.target.value }))}
                                                                           autoFocus
                                                                           onKeyDown={e => {
                                                                               if (e.key === 'Enter') onResolver(item.id, 'rechazar', null, notaRec[item.id] || null);
                                                                               if (e.key === 'Escape') setRejectOpen(p => ({ ...p, [item.id]: false }));
                                                                           }}
                                            placeholder="Razón del rechazo…"
                                        />
                                                <Button variant="destructive" disabled={isBusy} onClick={() => onResolver(item.id, 'rechazar', null, notaRec[item.id] || null)}>{isBusy ? <Loader2 size={10} className="animate-spin" /> : 'Rechazar'}</Button>
                                                <Button variant="ghost" onClick={() => setRejectOpen(p => ({ ...p, [item.id]: false }))}>✕</Button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <Button tone="success" icon={Check} loading={isBusy} onClick={() => onResolver(item.id, 'confirmar', null, null)}>Confirmar</Button>
                                                <Button variant="destructive" onClick={() => setRejectOpen(p => ({ ...p, [item.id]: true }))}>Rechazar</Button>
                                            </div>
                                        )
                                    )}
                                    {!isBranch && (
                                        <p className="text-caption text-content-3 italic">Esperando confirmación de sucursal…</p>
                                    )}
                                </>
                            )}

                            {/* ── Estado: rechazada — SUCURSAL espera ── */}
                            {res === 'rechazada' && isBranch && (
                                <div className="text-caption bg-danger/10 rounded-lg px-2.5 py-1.5 border border-danger/30 space-y-0.5">
                                    <div>
                                        <span className="font-semibold text-danger-text">Rechazada</span>
                                        {rechazadoEmp && <span className="text-danger"> por {shortEmployeeName(rechazadoEmp)}</span>}
                                    </div>
                                    {item.nota_rechazo && <p className="text-danger italic">{item.nota_rechazo}</p>}
                                    <p className="text-content-3">Esperando nueva propuesta de bodega…</p>
                                </div>
                            )}

                            {/* ── Estado: confirmada ── */}
                            {res === 'confirmada' && (
                                <div className="flex flex-wrap items-center gap-1.5 text-caption text-success-text">
                                    <CheckCircle2 size={11} className="text-success shrink-0" />
                                    <strong>{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</strong>
                                    {confirmadoEmp && <span className="text-success">— {shortEmployeeName(confirmadoEmp)}</span>}
                                    {item.resolucion_nota && <span className="text-success italic">· {item.resolucion_nota}</span>}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* ── Cierre de bodega (7A.1) ── */}
            {allConfirmed && !readOnly && (
                <div className="border-t border-warning/30 pt-2.5 space-y-2">
                    {!row?.confirmado_correccion_at ? (
                        !row?.corregido_bodega_at ? (
                            !isBranch ? (
                                <div className="space-y-2">
                                    <p className="text-caption text-content-2 font-semibold">Todas las diferencias fueron resueltas — marca la corrección como completa</p>
                                    <div className="flex gap-2">
                                        <PortalInput
                                            aria-label="Nota de la corrección" className="flex-1" tono="success" compact
                                            value={corrNota} onChange={e => setCorrNota(e.target.value)}
                                            placeholder="Nota (opcional)…"
                                        />
                                        <Button tone="success" disabled={busyAction === 'corr_bodega'} onClick={() => onCorregirBodega?.(corrNota || null)}>{busyAction === 'corr_bodega' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar corregido'}</Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-caption text-content-3 italic">Esperando que bodega marque la corrección…</p>
                            )
                        ) : isBranch ? (
                            <div className="space-y-2">
                                <div className="flex items-start gap-1.5 text-caption bg-success/10 rounded-lg px-2.5 py-1.5 border border-success/30">
                                    <CheckCircle2 size={10} className="text-success mt-0.5 shrink-0" />
                                    <div>
                                        <span className="font-semibold text-success-text">Bodega marcó la corrección</span>
                                        {corrBodegaEmp && <span className="text-success"> — {shortEmployeeName(corrBodegaEmp)}</span>}
                                        {row.corregido_bodega_nota && <p className="text-success italic">{row.corregido_bodega_nota}</p>}
                                    </div>
                                </div>
                                <Button tone="success" icon={Check} loading={busyAction === 'confirmar_corr'} onClick={() => onConfirmarCorreccion?.()}>Confirmar corrección recibida</Button>
                            </div>
                        ) : (
                            <p className="text-caption text-content-3 italic">Esperando confirmación de sucursal…</p>
                        )
                    ) : (
                        <div className="flex flex-wrap items-center gap-1.5 text-caption text-success-text">
                            <CheckCircle2 size={11} className="text-success shrink-0" />
                            <strong>Corrección confirmada</strong>
                            {corrConfEmp && <span className="text-success">— {shortEmployeeName(corrConfEmp)}</span>}
                        </div>
                    )}
                </div>
            )}

            {/* ── Actividad ── */}
            {eventos.length > 0 && (
                <div className="border-t border-warning/30 pt-2 space-y-1.5">
                    <p className="text-micro text-content-2 uppercase tracking-widest font-bold">Actividad</p>
                    {eventos.map(ev => {
                        const emp       = ev.hecho_por ? empMap.get(ev.hecho_por) : null;
                        const itemName  = difItems.find(d => d.id === ev.pedido_item_id)?.products?.nombre;
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-caption text-content-2">
                                <span className="text-content-3 shrink-0 tabular-nums">{fmtRelative(ev.created_at)}</span>
                                <span>
                                    <strong className="text-content-2">{emp ? shortEmployeeName(emp) : '—'}</strong>{' '}
                                    {EVENTO_LABEL[ev.tipo] ?? ev.tipo}
                                    {ev.resolucion_tipo && <em className="text-content-3"> ({RESOLUCION_LABEL[ev.resolucion_tipo] ?? ev.resolucion_tipo})</em>}
                                    {itemName && <span className="text-content-3"> · {itemName}</span>}
                                    {ev.nota && <span className="text-content-3 italic"> — {ev.nota}</span>}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {hiddenCount > 0 && (
                <Button tone="warning" onClick={() => setShowAll(s => !s)}>{showAll ? 'Ver menos ↑' : `Ver todas las diferencias (${difItems.length}) ↓`}</Button>
            )}
        </div>
    );
}
