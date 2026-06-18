import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, RefreshCw, Truck, Package, CheckCircle2,
    AlertTriangle, Clock, Pause, Play, Building2,
    PackageCheck, Database, Activity,
} from 'lucide-react';
import { ERP_NAMES } from '../../constants/erp';

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const PEDIDO_STATUS_PILL = {
    confirmado: 'bg-blue-100 text-blue-700 border-blue-200',
    enviado:    'bg-indigo-100 text-indigo-700 border-indigo-200',
};
const PEDIDO_STATUS_LABEL = {
    confirmado: 'Por despachar',
    enviado:    'En camino',
};

// Determina la etapa del lifecycle de una sucursal
function getBranchStage(row, pedidoStatus) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                              return 'erp';
    if (row.llegada_fisica_at)                            return 'contando';
    if (row.finalizado_at && pedidoStatus === 'enviado')  return 'transito';
    if (row.finalizado_at)                                return 'preparado';
    if (row.pausado_at && !row.reanudado_at)              return 'pausado';
    if (row.iniciado_at)                                  return 'preparando';
    return 'sin_iniciar';
}

const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',          color: 'slate',   icon: Package      },
    preparando:  { label: 'En preparación',        color: 'blue',    icon: Activity     },
    pausado:     { label: 'Pausado',               color: 'amber',   icon: Pause        },
    preparado:   { label: 'Listo para envío',      color: 'violet',  icon: CheckCircle2 },
    transito:    { label: 'En tránsito',           color: 'indigo',  icon: Truck        },
    contando:    { label: 'Cajas recibidas',       color: 'teal',    icon: PackageCheck },
    erp:         { label: 'Ingresado al ERP',      color: 'emerald', icon: Database     },
};

const COLOR_CLASSES = {
    slate:   { bg: 'bg-slate-100',    text: 'text-slate-500',   border: 'border-slate-200'   },
    blue:    { bg: 'bg-blue-50',      text: 'text-blue-700',    border: 'border-blue-200'    },
    amber:   { bg: 'bg-amber-50',     text: 'text-amber-700',   border: 'border-amber-200'   },
    violet:  { bg: 'bg-violet-50',    text: 'text-violet-700',  border: 'border-violet-200'  },
    indigo:  { bg: 'bg-indigo-50',    text: 'text-indigo-700',  border: 'border-indigo-200'  },
    teal:    { bg: 'bg-teal-50',      text: 'text-teal-700',    border: 'border-teal-200'    },
    emerald: { bg: 'bg-emerald-50',   text: 'text-emerald-700', border: 'border-emerald-200' },
};

function fmtMin(min) {
    if (min == null || min < 0) return null;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    const from = new Date(isoFrom);
    const to   = isoTo ? new Date(isoTo) : new Date();
    return Math.floor((to - from) / 60_000);
}

function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min < 1)   return 'hace un momento';
    if (min < 60)  return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}

function BranchStagePill({ row, pedidoStatus }) {
    const stage  = getBranchStage(row, pedidoStatus);
    const cfg    = STAGE_CONFIG[stage];
    const colors = COLOR_CLASSES[cfg.color];
    const Icon   = cfg.icon;

    let detail = null;
    if (stage === 'preparando' && row?.iniciado_at) {
        const mins = elapsed(row.iniciado_at) - (row.min_pausado_total ?? 0);
        detail = fmtMin(Math.max(0, mins));
    }
    if (stage === 'pausado' && row?.pausado_at) {
        detail = `${fmtMin(elapsed(row.pausado_at))} — ${row.pausa_razon ?? 'sin razón'}`;
    }
    if (stage === 'transito' && row?.finalizado_at) {
        detail = fmtMin(elapsed(row.finalizado_at));
    }

    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
            <Icon size={10} />
            {cfg.label}
            {detail && <span className="opacity-70 font-normal">· {detail}</span>}
        </span>
    );
}

export default function TabEnCurso({ searchTerm = '' }) {
    const [rows,      setRows]      = useState([]);    // flat rows from get_pedidos_en_curso
    const [loading,   setLoading]   = useState(true);
    const [lastSync,  setLastSync]  = useState(null);
    const [refreshing,setRefreshing]= useState(false);

    const load = useCallback(async () => {
        setRefreshing(true);
        const { data, error } = await supabase.rpc('get_pedidos_en_curso');
        if (!error) {
            setRows(data ?? []);
            setLastSync(new Date());
        }
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    // Realtime: recarga cuando cambia el estado de pedidos o lifecycle
    useEffect(() => {
        const ch = supabase
            .channel('en-curso-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => load())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_sucursal_status' }, () => load())
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [load]);

    // Agrupar filas por pedido_id
    const pedidosMap = rows.reduce((acc, row) => {
        if (!acc[row.pedido_id]) {
            acc[row.pedido_id] = {
                pedido_id:     row.pedido_id,
                numero:        row.numero,
                created_at:    row.created_at,
                status:        row.pedido_status,
                notes:         row.notes,
                enviado_at:    row.enviado_at,
                sucursales:    [],
            };
        }
        acc[row.pedido_id].sucursales.push(row);
        return acc;
    }, {});

    const pedidos = Object.values(pedidosMap).sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const filtered = pedidos.filter(p => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return String(p.numero).includes(q) || (p.notes ?? '').toLowerCase().includes(q);
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando pedidos activos…</span>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">

            {/* Header con última actualización */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity size={14} className="text-blue-500" />
                    <span className="text-[12px] font-semibold text-slate-600">Pedidos en curso</span>
                    {lastSync && (
                        <span className="text-[10px] text-slate-400">
                            · actualizado {fmtRelative(lastSync.toISOString())}
                        </span>
                    )}
                </div>
                <button
                    onClick={load}
                    disabled={refreshing}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                    Refrescar
                </button>
            </div>

            {/* Leyenda de etapas */}
            <div className="flex flex-wrap gap-1.5">
                {Object.entries(STAGE_CONFIG).map(([key, cfg]) => {
                    const colors = COLOR_CLASSES[cfg.color];
                    const Icon   = cfg.icon;
                    return (
                        <span key={key} className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                            <Icon size={9} />
                            {cfg.label}
                        </span>
                    );
                })}
            </div>

            {/* Empty state */}
            {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-300">
                    <CheckCircle2 size={32} className="opacity-50" />
                    <p className="text-[13px] text-slate-400">No hay pedidos activos en este momento.</p>
                </div>
            )}

            {/* Pedido cards */}
            {filtered.map(pedido => {
                const anyPaused = pedido.sucursales.some(
                    s => s.pausado_at && !s.reanudado_at
                );
                const allReady = pedido.sucursales.every(
                    s => s.finalizado_at || !s.iniciado_at
                );

                return (
                    <div key={pedido.pedido_id} className={`${GLASS} ${anyPaused ? 'ring-1 ring-amber-300' : ''}`}>
                        {/* Header del pedido */}
                        <div className="flex items-center gap-3 px-4 py-3">
                            <span className="text-[13px] font-bold text-slate-700 tabular-nums">
                                #{pedido.numero}
                            </span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PEDIDO_STATUS_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {PEDIDO_STATUS_LABEL[pedido.status] ?? pedido.status}
                            </span>
                            {anyPaused && (
                                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                    <Pause size={10} />
                                    Pausado
                                </span>
                            )}
                            {allReady && pedido.status === 'confirmado' && (
                                <span className="flex items-center gap-1 text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                                    <Play size={10} />
                                    Listo para enviar
                                </span>
                            )}
                            <span className="ml-auto text-[10px] text-slate-400">
                                {fmtRelative(pedido.enviado_at ?? pedido.created_at)}
                            </span>
                        </div>

                        {/* Notas del pedido */}
                        {pedido.notes && (
                            <p className="px-4 pb-1 text-[11px] text-slate-400 italic">{pedido.notes}</p>
                        )}

                        {/* Sucursales */}
                        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                            {pedido.sucursales
                                .sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id)
                                .map(suc => {
                                    const stage     = getBranchStage(suc, pedido.status);
                                    const hasPausas = suc.num_pausas > 0;
                                    const isPaused  = stage === 'pausado';
                                    return (
                                        <div key={suc.erp_sucursal_id} className={`flex items-center gap-2 py-1.5 px-2.5 rounded-xl transition-colors ${
                                            isPaused ? 'bg-amber-50/60 border border-amber-100' : 'bg-slate-50/60 border border-slate-100/80'
                                        }`}>
                                            <Building2 size={11} className="text-slate-400 shrink-0" />
                                            <span className="text-[11px] font-semibold text-slate-600 w-20 shrink-0">
                                                {ERP_NAMES[suc.erp_sucursal_id] ?? `Suc. ${suc.erp_sucursal_id}`}
                                            </span>
                                            <BranchStagePill row={suc} pedidoStatus={pedido.status} />
                                            {hasPausas && (
                                                <span className="ml-auto text-[9px] text-amber-500 font-medium flex items-center gap-0.5 shrink-0">
                                                    <Pause size={9} />
                                                    {suc.num_pausas} {suc.num_pausas === 1 ? 'pausa' : 'pausas'}
                                                    {suc.min_pausado_total > 0 && ` · ${fmtMin(suc.min_pausado_total)}`}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>

                        {/* Progress bar de sucursales completadas */}
                        {(() => {
                            const total    = pedido.sucursales.length;
                            const done     = pedido.sucursales.filter(s => s.recibido_erp_at).length;
                            const sent     = pedido.sucursales.filter(s => s.llegada_fisica_at).length;
                            const finished = pedido.sucursales.filter(s => s.finalizado_at).length;
                            const pctDone  = Math.round((done / total) * 100);

                            if (pedido.status !== 'enviado') return null;
                            return (
                                <div className="border-t border-slate-100 px-4 py-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[9px] text-slate-400 font-medium">
                                            Progreso de recepción
                                        </span>
                                        <span className="text-[9px] text-slate-500 font-semibold">
                                            {done}/{total} ingresados al ERP
                                            {sent > done && ` · ${sent - done} contando`}
                                            {finished > sent && ` · ${finished - sent} en tránsito`}
                                        </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                            style={{ width: `${pctDone}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </div>
    );
}
