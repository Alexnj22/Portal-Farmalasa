import React, { useState, useEffect, useCallback } from 'react';
import {
    Tag, Plus, ChevronDown, ChevronUp, Loader2, Package,
    Calendar, Building2, Play, Pause, Lock, Trash2,
    FlaskConical, Gift, AlertCircle,
} from 'lucide-react';
import { supabase }      from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import PromoModal        from './PromoModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
    if (!d) return null;
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const ESTADO_CFG = {
    draft:  { bg: 'bg-slate-100',    text: 'text-slate-600',    border: 'border-slate-200',    dot: 'bg-slate-400',    label: 'Borrador' },
    active: { bg: 'bg-emerald-50',   text: 'text-emerald-700',  border: 'border-emerald-200',  dot: 'bg-emerald-500',  label: 'Activa'   },
    paused: { bg: 'bg-amber-50',     text: 'text-amber-700',    border: 'border-amber-200',    dot: 'bg-amber-400',    label: 'Pausada'  },
    closed: { bg: 'bg-slate-50',     text: 'text-slate-400',    border: 'border-slate-150',    dot: 'bg-slate-300',    label: 'Cerrada'  },
};

const ALL_STATES = ['draft', 'active', 'paused'];

// ── PromoCard ─────────────────────────────────────────────────────────────────

function PromoCard({ promo, onStateChange, onDelete, onRefresh, canEdit }) {
    const [expanded, setExpanded] = useState(false);
    const es = ESTADO_CFG[promo.estado] || ESTADO_CFG.draft;

    const branches    = (promo.promotion_branches || [])
        .map(pb => pb.branches?.name)
        .filter(Boolean);
    const pps         = promo.promotion_products || [];
    const totalSold   = pps.reduce((s, pp) =>
        s + (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0), 0);
    const totalStock  = pps.reduce((s, pp) => s + (pp.stock_inicial || 0), 0);
    const pct         = totalStock > 0 ? Math.min(100, Math.round(totalSold / totalStock * 100)) : null;

    // Laboratorios únicos de los productos
    const labs = [...new Set(
        pps.map(pp => pp.products?.laboratorios?.nombre).filter(Boolean)
    )];

    return (
        <div className={`
            relative bg-white/70 backdrop-blur-sm border rounded-2xl overflow-hidden
            shadow-[0_2px_12px_rgba(0,0,0,0.05),inset_0_1px_4px_rgba(255,255,255,0.9)]
            transition-all duration-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)]
            ${promo.estado === 'active' ? 'border-emerald-200/70' : 'border-white/80'}
        `}>
            {/* Active glow stripe */}
            {promo.estado === 'active' && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-400/0 via-emerald-400 to-emerald-400/0" />
            )}

            <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${es.bg} ${es.text} ${es.border}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${es.dot}`} />
                                {es.label}
                            </span>
                            {promo.fecha_inicio && (
                                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                    <Calendar size={9} />
                                    {fmtDate(promo.fecha_inicio)}
                                    {promo.fecha_fin && ` → ${fmtDate(promo.fecha_fin)}`}
                                </span>
                            )}
                        </div>
                        <h3 className="text-[14px] font-bold text-slate-800 leading-tight">{promo.nombre}</h3>
                        {labs.length > 0 && (
                            <p className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                                <FlaskConical size={9} /> {labs.join(', ')}
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    {canEdit && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {promo.estado === 'draft' && (
                                <button
                                    title="Activar"
                                    onClick={() => onStateChange(promo, 'active')}
                                    className="p-2 rounded-xl hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                                >
                                    <Play size={14} />
                                </button>
                            )}
                            {promo.estado === 'active' && (
                                <button
                                    title="Pausar"
                                    onClick={() => onStateChange(promo, 'paused')}
                                    className="p-2 rounded-xl hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors"
                                >
                                    <Pause size={14} />
                                </button>
                            )}
                            {promo.estado === 'paused' && (
                                <button
                                    title="Reactivar"
                                    onClick={() => onStateChange(promo, 'active')}
                                    className="p-2 rounded-xl hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                                >
                                    <Play size={14} />
                                </button>
                            )}
                            {(promo.estado === 'active' || promo.estado === 'paused') && (
                                <button
                                    title="Cerrar promoción"
                                    onClick={() => onStateChange(promo, 'closed')}
                                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    <Lock size={14} />
                                </button>
                            )}
                            {promo.estado === 'draft' && (
                                <button
                                    title="Eliminar borrador"
                                    onClick={() => onDelete(promo)}
                                    className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
                    {branches.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                            <Building2 size={9} />
                            {branches.length <= 3 ? branches.join(', ') : `${branches.slice(0, 2).join(', ')} +${branches.length - 2}`}
                        </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Package size={9} /> {pps.length} {pps.length === 1 ? 'producto' : 'productos'}
                    </span>
                    {pps.some(pp => pp.bono_vendedor > 0 || pp.bono_admin_pool > 0 || pp.bono_bodega_pool > 0) && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                            <Gift size={9} /> Con bonificación
                        </span>
                    )}
                </div>

                {/* Stock progress */}
                {pct !== null && (
                    <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400">Stock vendido</span>
                            <span className="text-[10px] font-semibold text-slate-600">{totalSold}/{totalStock} und · {pct}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-400' : promo.estado === 'active' ? 'bg-blue-500' : 'bg-slate-300'}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                )}

                {promo.notas && (
                    <p className="text-[10px] text-slate-400 italic mb-3 leading-relaxed">"{promo.notas}"</p>
                )}

                {/* Expand toggle */}
                {pps.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setExpanded(e => !e)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors w-full justify-center pt-1 border-t border-slate-100"
                    >
                        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {expanded ? 'Ocultar productos' : 'Ver productos'}
                    </button>
                )}
            </div>

            {/* Expanded products */}
            {expanded && pps.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-3 pt-2.5 space-y-2">
                    {pps.map(pp => {
                        const sold = (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0);
                        const ppPct = pp.stock_inicial && pp.stock_inicial > 0
                            ? Math.min(100, Math.round(sold / pp.stock_inicial * 100))
                            : null;
                        return (
                            <div key={pp.id} className="flex gap-2.5 items-start">
                                <div className="w-7 h-7 rounded-lg bg-white border border-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">
                                    {pp.products?.foto_url
                                        ? <img src={pp.products.foto_url} className="w-full h-full object-cover" alt="" />
                                        : <Package size={11} className="text-slate-300" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-semibold text-slate-700 truncate">{pp.products?.nombre}</span>
                                        {pp.presentaciones?.tipo && (
                                            <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">{pp.presentaciones.tipo}</span>
                                        )}
                                        {pp.factor_descripcion && (
                                            <span className="text-[10px] text-violet-600 font-medium bg-violet-50 px-1.5 py-0.5 rounded-md">{pp.factor_descripcion}</span>
                                        )}
                                    </div>
                                    {/* Bonos */}
                                    <div className="flex flex-wrap gap-x-2 mt-0.5">
                                        {pp.bono_vendedor > 0 && (
                                            <span className="text-[10px] text-emerald-600">Vend: ${parseFloat(pp.bono_vendedor).toFixed(2)}</span>
                                        )}
                                        {pp.bono_admin_pool > 0 && (
                                            <span className="text-[10px] text-blue-600">Admin: ${parseFloat(pp.bono_admin_pool).toFixed(2)}</span>
                                        )}
                                        {pp.bono_bodega_pool > 0 && (
                                            <span className="text-[10px] text-amber-600">Bodega: ${parseFloat(pp.bono_bodega_pool).toFixed(2)}</span>
                                        )}
                                    </div>
                                    {/* Mini progress */}
                                    {ppPct !== null && (
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${ppPct >= 100 ? 'bg-emerald-400' : 'bg-blue-400'}`}
                                                    style={{ width: `${ppPct}%` }}
                                                />
                                            </div>
                                            <span className="text-[9px] text-slate-400 w-8 text-right">{sold}/{pp.stock_inicial}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabPromos({ searchTerm, canEdit }) {
    const { showToast } = useToastStore();
    const [promos,     setPromos]     = useState([]);
    const [loading,    setLoading]    = useState(true);
    const [showModal,  setShowModal]  = useState(false);
    const [filterState, setFilterState] = useState('all'); // 'all' | 'draft' | 'active' | 'paused'

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('promotions')
            .select(`
                id, nombre, estado, fecha_inicio, fecha_fin, end_condition, notas,
                promotion_branches(branch_id, branches(name)),
                promotion_products(
                    id, product_id, factor_descripcion, factor_denominador,
                    stock_inicial, bono_vendedor, bono_admin_pool, bono_bodega_pool,
                    presentacion_id, presentaciones(tipo),
                    products(nombre, foto_url, laboratorio_id, laboratorios(nombre)),
                    promotion_sales_cache(units_sold)
                )
            `)
            .in('estado', ALL_STATES)
            .order('created_at', { ascending: false });

        if (error) showToast('Error cargando promociones', error.message, 'error');
        setPromos(data || []);
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const handleStateChange = async (promo, newEstado) => {
        const { error } = await supabase.from('promotions')
            .update({ estado: newEstado })
            .eq('id', promo.id);
        if (error) return showToast('Error', error.message, 'error');
        const labels = { active: 'Activada', paused: 'Pausada', closed: 'Movida a historial', draft: 'Borrador' };
        showToast(labels[newEstado] || 'Actualizada', promo.nombre, 'success');
        load();
    };

    const handleDelete = async (promo) => {
        if (!window.confirm(`¿Eliminar el borrador "${promo.nombre}"?`)) return;
        const { error } = await supabase.from('promotions').delete().eq('id', promo.id);
        if (error) return showToast('Error', error.message, 'error');
        showToast('Eliminado', promo.nombre, 'success');
        load();
    };

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    const filtered = promos.filter(p => {
        if (filterState !== 'all' && p.estado !== filterState) return false;
        if (!searchTerm) return true;
        return (
            norm(p.nombre).includes(norm(searchTerm)) ||
            (p.promotion_products || []).some(pp =>
                norm(pp.products?.nombre).includes(norm(searchTerm)) ||
                norm(pp.products?.laboratorios?.nombre).includes(norm(searchTerm))
            )
        );
    });

    const counts = ALL_STATES.reduce((acc, s) => {
        acc[s] = promos.filter(p => p.estado === s).length;
        return acc;
    }, {});

    // Filter pill
    const pillFilters = [
        { key: 'all',    label: 'Todas',     count: promos.length },
        { key: 'active', label: 'Activas',   count: counts.active },
        { key: 'draft',  label: 'Borrador',  count: counts.draft  },
        { key: 'paused', label: 'Pausadas',  count: counts.paused },
    ];

    return (
        <div>
            {/* Filter pill — glassmorphic, right-aligned */}
            <div className="flex justify-end mb-4">
                <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 shrink-0 overflow-visible">
                    <div className="flex items-center px-2 py-2">
                        <Tag size={13} className="text-slate-400 flex-shrink-0" />
                    </div>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                    {pillFilters.map((pf, idx) => (
                        <React.Fragment key={pf.key}>
                            {idx > 0 && <div className="h-5 w-px bg-slate-100 shrink-0" />}
                            <button
                                onClick={() => setFilterState(pf.key)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all ${
                                    filterState === pf.key
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                {pf.label}
                                {pf.count > 0 && (
                                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${
                                        filterState === pf.key ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        {pf.count}
                                    </span>
                                )}
                            </button>
                        </React.Fragment>
                    ))}

                    {canEdit && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button
                                onClick={() => setShowModal(true)}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-bold text-blue-600 hover:bg-blue-50 transition-all"
                            >
                                <Plus size={12} /> Nueva
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-16 text-slate-400">
                    <Loader2 size={20} className="animate-spin mr-2" />
                    <span className="text-[12px]">Cargando promociones...</span>
                </div>
            )}

            {/* Empty */}
            {!loading && filtered.length === 0 && (
                <div className="text-center py-16">
                    <Tag size={32} className="mx-auto mb-3 text-slate-200" />
                    <p className="text-[13px] text-slate-400 font-medium">
                        {searchTerm ? 'Sin resultados para esa búsqueda' : 'No hay promociones aquí'}
                    </p>
                    {canEdit && !searchTerm && (
                        <button
                            onClick={() => setShowModal(true)}
                            className="mt-3 flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors mx-auto"
                        >
                            <Plus size={12} /> Nueva Promoción
                        </button>
                    )}
                </div>
            )}

            {/* Cards grid */}
            {!loading && filtered.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {filtered.map(promo => (
                        <PromoCard
                            key={promo.id}
                            promo={promo}
                            onStateChange={handleStateChange}
                            onDelete={handleDelete}
                            onRefresh={load}
                            canEdit={canEdit}
                        />
                    ))}
                </div>
            )}

            {/* Modal */}
            <PromoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(newId) => { setShowModal(false); load(); }}
            />
        </div>
    );
}
