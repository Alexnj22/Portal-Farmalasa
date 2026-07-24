// Extracted from TabPedidos.jsx (Bloque 6.C) — differences (dif) resolution
// section shown inside an expanded pedido card.
import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, X, Loader2, UserCircle2 } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect';
import { calcSolicitado, fmtRelative } from './helpers';

const ERROR_TIPO_LABEL = {
    faltante:     { label: 'Faltante',        color: 'bg-danger/10 text-red-700 border-danger/30'           },
    sobrante:     { label: 'Sobrante',        color: 'bg-success/10 text-emerald-700 border-success/30' },
    danado:       { label: 'Dañado',          color: 'bg-orange-100 text-orange-700 border-orange-200'   },
    vencido:      { label: 'Vencido',         color: 'bg-purple-100 text-purple-700 border-purple-200'   },
    presentacion: { label: 'Pres. distinta',  color: 'bg-blue-100 text-blue-700 border-blue-200'         },
    otro:         { label: 'Otro',            color: 'bg-surface-card-hover text-content-2 border-slate-200'      },
    diferencia:   { label: 'Diferencia',      color: 'bg-warning/10 text-amber-700 border-warning/30'      },
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

export default function DifSection({ row, difItems = [], eventos = [], isBranch, busyAction, empMap = new Map(), onResolver, onCorregirBodega, onConfirmarCorreccion, readOnly = false, onNeedItems, itemsLoaded = true }) {
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
        <div className="border-t border-warning/30 bg-gradient-to-b from-amber-50/40 to-white px-4 py-3 space-y-3">
            <div className="flex items-center gap-1.5">
                <AlertCircle size={12} className="text-warning shrink-0" />
                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                    {allConfirmed ? 'Diferencias resueltas ✓' : `Diferencias — pendiente resolución${difItems.length > 1 ? ` (${difItems.length})` : ''}`}
                </span>
            </div>

            {visibleItems.map(item => {
                const opts    = RESOLUCION_OPTS[item.error_tipo] ?? [['resuelto','Resuelto'],['no_aplica','Sin solución']];
                const selTipo = tipoSel[item.id] ?? opts[0]?.[0] ?? '';
                const isBusy  = busyAction === `res_${item.id}`;
                const et      = ERROR_TIPO_LABEL[item.error_tipo];
                const res     = item.resolucion_status;
                const qtyDiff = item.cantidad_recibida !== null && item.cantidad_recibida !== item.cantidad_asignada;

                const resueltoEmp   = item.resuelto_por       ? empMap.get(item.resuelto_por)       : null;
                const confirmadoEmp = item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por)  : null;
                const rechazadoEmp  = item.rechazado_por      ? empMap.get(item.rechazado_por)       : null;

                const borderCls = res === 'confirmada' ? 'border-success/30 bg-success/10'
                                : res === 'rechazada'  ? 'border-danger/30 bg-danger/10'
                                : res === 'propuesta'  ? 'border-violet-200 bg-violet-50/20'
                                :                        'border-warning/30 bg-white';

                return (
                    <div key={item.id} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                        {/* Item header */}
                        <div className="flex items-center gap-2 px-3 py-2">
                            <span className="flex-1 text-[11px] font-semibold text-content-2 truncate">{item.products?.nombre}</span>
                            {et && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${et.color}`}>{et.label}</span>}
                            {res === 'confirmada' && <CheckCircle2 size={13} className="text-success shrink-0" />}
                            {res === 'rechazada'  && <X size={13} className="text-danger shrink-0" />}
                        </div>

                        {/* Qty diff */}
                        {(qtyDiff || item.cantidad_asignada != null) && (
                            <div className="flex items-center gap-2 px-3 pb-1.5 text-[10px] text-content-3 flex-wrap">
                                {(() => { const sol = calcSolicitado(item); return sol != null ? <span>Solicitado: <strong className="text-content-2">{sol}</strong></span> : null; })()}
                                <span>Enviado: <strong className="text-content-2">{item.cantidad_asignada}</strong></span>
                                {item.cantidad_recibida != null && <>
                                    <span className="text-content-3">→</span>
                                    <span>Físico: <strong className={item.cantidad_recibida < item.cantidad_asignada ? 'text-danger' : 'text-success'}>{item.cantidad_recibida}</strong></span>
                                </>}
                            </div>
                        )}

                        <div className="px-3 pb-3 space-y-2">

                            {/* ── Estado: null o rechazada — BODEGA propone ── */}
                            {(!res || res === 'rechazada') && !isBranch && !readOnly && (
                                <>
                                    {res === 'rechazada' && (
                                        <div className="flex items-start gap-1.5 text-[10px] bg-danger/10 rounded-lg px-2.5 py-1.5 border border-danger/30">
                                            <X size={10} className="text-danger mt-0.5 shrink-0" />
                                            <div>
                                                <span className="font-semibold text-red-700">Rechazado</span>
                                                {rechazadoEmp && <span className="text-danger"> por {rechazadoEmp.name?.split(' ')[0]}</span>}
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
                                        <input
                                            type="text" placeholder="Nota (opcional)…"
                                            value={notaSel[item.id] ?? ''}
                                            onChange={e => setNotaSel(p => ({ ...p, [item.id]: e.target.value }))}
                                            className="flex-1 text-[16px] border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-violet-400 bg-white placeholder-slate-300"
                                        />
                                        <button
                                            onClick={() => onResolver(item.id, 'proponer', selTipo, notaSel[item.id] || null)}
                                            disabled={isBusy || !selTipo}
                                            className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 shrink-0 active:scale-[0.97] transition-all"
                                        >
                                            {isBusy ? <Loader2 size={10} className="animate-spin" /> : res === 'rechazada' ? 'Volver a proponer' : 'Proponer'}
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* ── Estado: null — SUCURSAL espera ── */}
                            {!res && isBranch && !readOnly && (
                                <p className="text-[10px] text-content-3 italic">Esperando resolución de bodega…</p>
                            )}

                            {/* ── Estado: propuesta — mostrar propuesta ── */}
                            {res === 'propuesta' && !readOnly && (
                                <>
                                    <div className="flex items-start gap-1.5 text-[10px] bg-violet-50 rounded-lg px-2.5 py-1.5 border border-violet-100">
                                        {resueltoEmp?.photo_url
                                            ? <img src={resueltoEmp.photo_url} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm shrink-0 mt-0.5" alt="" />
                                            : <UserCircle2 size={14} className="text-violet-400 shrink-0 mt-0.5" />}
                                        <div className="flex-1">
                                            <span className="font-semibold text-violet-800">{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</span>
                                            {resueltoEmp && <span className="text-violet-600"> — {resueltoEmp.name?.split(' ')[0]}</span>}
                                            {item.resolucion_nota && <p className="text-violet-600 italic">{item.resolucion_nota}</p>}
                                        </div>
                                    </div>
                                    {isBranch && (
                                        rejectOpen[item.id] ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text" placeholder="Razón del rechazo…" autoFocus
                                                    value={notaRec[item.id] ?? ''}
                                                    onChange={e => setNotaRec(p => ({ ...p, [item.id]: e.target.value }))}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') onResolver(item.id, 'rechazar', null, notaRec[item.id] || null);
                                                        if (e.key === 'Escape') setRejectOpen(p => ({ ...p, [item.id]: false }));
                                                    }}
                                                    className="flex-1 text-[16px] border border-danger/30 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-red-400 bg-white placeholder-slate-300"
                                                />
                                                <button
                                                    onClick={() => onResolver(item.id, 'rechazar', null, notaRec[item.id] || null)}
                                                    disabled={isBusy}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 shrink-0 active:scale-[0.97] transition-all"
                                                >
                                                    {isBusy ? <Loader2 size={10} className="animate-spin" /> : 'Rechazar'}
                                                </button>
                                                <button onClick={() => setRejectOpen(p => ({ ...p, [item.id]: false }))} className="text-[10px] text-content-3 hover:text-content-2 px-1">✕</button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => onResolver(item.id, 'confirmar', null, null)}
                                                    disabled={isBusy}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.97] transition-all"
                                                >
                                                    {isBusy ? <Loader2 size={10} className="animate-spin" /> : '✓ Confirmar'}
                                                </button>
                                                <button
                                                    onClick={() => setRejectOpen(p => ({ ...p, [item.id]: true }))}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 active:scale-[0.97] transition-all"
                                                >
                                                    Rechazar
                                                </button>
                                            </div>
                                        )
                                    )}
                                    {!isBranch && (
                                        <p className="text-[10px] text-content-3 italic">Esperando confirmación de sucursal…</p>
                                    )}
                                </>
                            )}

                            {/* ── Estado: rechazada — SUCURSAL espera ── */}
                            {res === 'rechazada' && isBranch && (
                                <div className="text-[10px] bg-danger/10 rounded-lg px-2.5 py-1.5 border border-danger/30 space-y-0.5">
                                    <div>
                                        <span className="font-semibold text-red-700">Rechazada</span>
                                        {rechazadoEmp && <span className="text-danger"> por {rechazadoEmp.name?.split(' ')[0]}</span>}
                                    </div>
                                    {item.nota_rechazo && <p className="text-danger italic">{item.nota_rechazo}</p>}
                                    <p className="text-content-3">Esperando nueva propuesta de bodega…</p>
                                </div>
                            )}

                            {/* ── Estado: confirmada ── */}
                            {res === 'confirmada' && (
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-emerald-700">
                                    <CheckCircle2 size={11} className="text-success shrink-0" />
                                    <strong>{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</strong>
                                    {confirmadoEmp && <span className="text-success">— {confirmadoEmp.name?.split(' ')[0]}</span>}
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
                                    <p className="text-[10px] text-content-2 font-semibold">Todas las diferencias fueron resueltas — marca la corrección como completa</p>
                                    <div className="flex gap-2">
                                        <input
                                            type="text" placeholder="Nota (opcional)…"
                                            value={corrNota}
                                            onChange={e => setCorrNota(e.target.value)}
                                            className="flex-1 text-[16px] border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-400 bg-white placeholder-slate-300"
                                        />
                                        <button
                                            onClick={() => onCorregirBodega?.(corrNota || null)}
                                            disabled={busyAction === 'corr_bodega'}
                                            className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 shrink-0 active:scale-[0.97] transition-all"
                                        >
                                            {busyAction === 'corr_bodega' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar corregido'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-[10px] text-content-3 italic">Esperando que bodega marque la corrección…</p>
                            )
                        ) : isBranch ? (
                            <div className="space-y-2">
                                <div className="flex items-start gap-1.5 text-[10px] bg-success/10 rounded-lg px-2.5 py-1.5 border border-success/30">
                                    <CheckCircle2 size={10} className="text-success mt-0.5 shrink-0" />
                                    <div>
                                        <span className="font-semibold text-emerald-700">Bodega marcó la corrección</span>
                                        {corrBodegaEmp && <span className="text-success"> — {corrBodegaEmp.name?.split(' ')[0]}</span>}
                                        {row.corregido_bodega_nota && <p className="text-success italic">{row.corregido_bodega_nota}</p>}
                                    </div>
                                </div>
                                <button
                                    onClick={() => onConfirmarCorreccion?.()}
                                    disabled={busyAction === 'confirmar_corr'}
                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.97] transition-all"
                                >
                                    {busyAction === 'confirmar_corr' ? <Loader2 size={10} className="animate-spin" /> : '✓ Confirmar corrección recibida'}
                                </button>
                            </div>
                        ) : (
                            <p className="text-[10px] text-content-3 italic">Esperando confirmación de sucursal…</p>
                        )
                    ) : (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-emerald-700">
                            <CheckCircle2 size={11} className="text-success shrink-0" />
                            <strong>Corrección confirmada</strong>
                            {corrConfEmp && <span className="text-success">— {corrConfEmp.name?.split(' ')[0]}</span>}
                        </div>
                    )}
                </div>
            )}

            {/* ── Actividad ── */}
            {eventos.length > 0 && (
                <div className="border-t border-warning/30 pt-2 space-y-1.5">
                    <p className="text-[9px] text-content-2 uppercase tracking-widest font-bold">Actividad</p>
                    {eventos.map(ev => {
                        const emp       = ev.hecho_por ? empMap.get(ev.hecho_por) : null;
                        const itemName  = difItems.find(d => d.id === ev.pedido_item_id)?.products?.nombre;
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-[10px] text-content-2">
                                <span className="text-content-3 shrink-0 tabular-nums">{fmtRelative(ev.created_at)}</span>
                                <span>
                                    <strong className="text-content-2">{emp?.name?.split(' ')[0] ?? '—'}</strong>{' '}
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
                <button onClick={() => setShowAll(s => !s)}
                    className="w-full text-[10px] font-semibold text-warning hover:text-amber-800 py-1 rounded-lg hover:bg-warning/10 transition-all text-center">
                    {showAll ? 'Ver menos ↑' : `Ver todas las diferencias (${difItems.length}) ↓`}
                </button>
            )}
        </div>
    );
}
