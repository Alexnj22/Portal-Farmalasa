import React, { useState, useEffect, useCallback } from 'react';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import {
    Tag, Plus, ChevronDown, ChevronUp, Loader2, Package,
    Calendar, Building2, Play, Pause, Lock, Trash2,
    FlaskConical, Gift, AlertCircle,
} from 'lucide-react';
import { useToastStore } from '../../store/toastStore';
import PromoModal        from './PromoModal';
import ConfirmModal      from '../../components/common/ConfirmModal';
import { fetchPromotionsList, updatePromotionEstado, deletePromotion } from '../../data/promotions';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
    if (!d) return null;
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const ESTADO_CFG = {
    draft:  { bg: 'bg-surface-card-hover',    text: 'text-content-2',    border: 'border-divider',    dot: 'bg-content-3',    label: 'Borrador' },
    active: { bg: 'bg-success/10',   text: 'text-success-text',  border: 'border-success/30',  dot: 'bg-success',  label: 'Activa'   },
    paused: { bg: 'bg-warning/10',     text: 'text-warning-text',    border: 'border-warning/30',    dot: 'bg-warning',    label: 'Pausada'  },
    closed: { bg: 'bg-surface-card-hover',     text: 'text-content-3',    border: 'border-divider',    dot: 'bg-content-3',    label: 'Cerrada'  },
};

const ALL_STATES = ['draft', 'active', 'paused'];

// ── PromoCard ─────────────────────────────────────────────────────────────────

function PromoCard({ promo, onStateChange, onDelete, canEdit }) {
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
            relative bg-surface-card backdrop-blur-sm border rounded-2xl overflow-hidden
            shadow-[var(--shadow-glass-1)]
            transition-all duration-200 hover:shadow-[var(--shadow-elevation-md)]
            ${promo.estado === 'active' ? 'border-success/30' : 'border-border-card'}
        `}>
            {/* Active glow stripe */}
            {promo.estado === 'active' && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-success/0 via-success to-success/0" />
            )}

            <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-bold border ${es.bg} ${es.text} ${es.border}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${es.dot}`} />
                                {es.label}
                            </span>
                            {promo.fecha_inicio && (
                                <span className="flex items-center gap-1 text-caption text-content-3">
                                    <Calendar size={9} />
                                    {fmtDate(promo.fecha_inicio)}
                                    {promo.fecha_fin && ` → ${fmtDate(promo.fecha_fin)}`}
                                </span>
                            )}
                        </div>
                        <h3 className="text-body-lg font-bold text-content leading-tight">{promo.nombre}</h3>
                        {labs.length > 0 && (
                            <p className="flex items-center gap-1 text-caption text-content-3 mt-0.5">
                                <FlaskConical size={9} /> {labs.join(', ')}
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    {canEdit && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {promo.estado === 'draft' && (
                                <Button tone="success" icon={Play} title="Activar" iconOnly onClick={() => onStateChange(promo, 'active')} />
                            )}
                            {promo.estado === 'active' && (
                                <Button tone="warning" icon={Pause} title="Pausar" iconOnly onClick={() => onStateChange(promo, 'paused')} />
                            )}
                            {promo.estado === 'paused' && (
                                <Button tone="success" icon={Play} title="Reactivar" iconOnly onClick={() => onStateChange(promo, 'active')} />
                            )}
                            {(promo.estado === 'active' || promo.estado === 'paused') && (
                                <Button variant="secondary" icon={Lock} title="Cerrar promoción" iconOnly onClick={() => onStateChange(promo, 'closed')} />
                            )}
                            {promo.estado === 'draft' && (
                                <Button variant="destructive" icon={Trash2} title="Eliminar borrador" iconOnly onClick={() => onDelete(promo)} />
                            )}
                        </div>
                    )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
                    {branches.length > 0 && (
                        <span className="flex items-center gap-1 text-caption text-content-3">
                            <Building2 size={9} />
                            {branches.length <= 3 ? branches.join(', ') : `${branches.slice(0, 2).join(', ')} +${branches.length - 2}`}
                        </span>
                    )}
                    <span className="flex items-center gap-1 text-caption text-content-3">
                        <Package size={9} /> {pps.length} {pps.length === 1 ? 'producto' : 'productos'}
                    </span>
                    {pps.some(pp => pp.bono_vendedor > 0 || pp.bono_admin_pool > 0 || pp.bono_bodega_pool > 0) && (
                        <span className="flex items-center gap-1 text-caption text-success">
                            <Gift size={9} /> Con bonificación
                        </span>
                    )}
                </div>

                {/* Stock progress */}
                {pct !== null && (
                    <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-caption text-content-3">Stock vendido</span>
                            <span className="text-caption font-semibold text-content-2">{totalSold}/{totalStock} und · {pct}%</span>
                        </div>
                        <div className="h-2 bg-surface-card-hover rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success' : promo.estado === 'active' ? 'bg-chart-1' : 'bg-content-3'}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                )}

                {promo.notas && (
                    <p className="text-caption text-content-3 italic mb-3 leading-relaxed">"{promo.notas}"</p>
                )}

                {/* Expand toggle */}
                {pps.length > 0 && (
                    <Button variant="ghost" onClick={() => setExpanded(e => !e)}>{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {expanded ? 'Ocultar productos' : 'Ver productos'}</Button>
                )}
            </div>

            {/* Expanded products */}
            {expanded && pps.length > 0 && (
                <div className="border-t border-divider bg-surface-card-hover/50 px-4 pb-3 pt-2.5 space-y-2">
                    {pps.map(pp => {
                        const sold = (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0);
                        const ppPct = pp.stock_inicial && pp.stock_inicial > 0
                            ? Math.min(100, Math.round(sold / pp.stock_inicial * 100))
                            : null;
                        return (
                            <div key={pp.id} className="flex gap-2.5 items-start">
                                <div className="w-7 h-7 rounded-lg bg-surface-card border border-divider flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">
                                    {pp.products?.foto_url
                                        ? <img src={pp.products.foto_url} className="w-full h-full object-cover" alt="" />
                                        : <Package size={11} className="text-content-3" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-label font-semibold text-content-2 truncate">{pp.products?.nombre}</span>
                                        {pp.presentaciones?.tipo && (
                                            <span className="text-caption font-semibold bg-surface-card-hover text-content-2 px-1.5 py-0.5 rounded-md">{pp.presentaciones.tipo}</span>
                                        )}
                                        {pp.factor_descripcion && (
                                            <span className="text-caption text-chart-3-text font-medium bg-chart-3/10 px-1.5 py-0.5 rounded-md">{pp.factor_descripcion}</span>
                                        )}
                                    </div>
                                    {/* Bonos */}
                                    <div className="flex flex-wrap gap-x-2 mt-0.5">
                                        {pp.bono_vendedor > 0 && (
                                            <span className="text-caption text-success">Vend: ${parseFloat(pp.bono_vendedor).toFixed(2)}</span>
                                        )}
                                        {pp.bono_admin_pool > 0 && (
                                            <span className="text-caption text-chart-1-text">Admin: ${parseFloat(pp.bono_admin_pool).toFixed(2)}</span>
                                        )}
                                        {pp.bono_bodega_pool > 0 && (
                                            <span className="text-caption text-warning">Bodega: ${parseFloat(pp.bono_bodega_pool).toFixed(2)}</span>
                                        )}
                                    </div>
                                    {/* Mini progress */}
                                    {ppPct !== null && (
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <div className="flex-1 h-1 bg-surface-card-hover rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${ppPct >= 100 ? 'bg-success' : 'bg-chart-1'}`}
                                                    style={{ width: `${ppPct}%` }}
                                                />
                                            </div>
                                            <span className="text-micro text-content-3 w-8 text-right">{sold}/{pp.stock_inicial}</span>
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
    const [promoToDelete, setPromoToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await fetchPromotionsList(ALL_STATES);

        if (error) showToast('Error cargando promociones', error.message, 'error');
        setPromos(data || []);
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const handleStateChange = async (promo, newEstado) => {
        const { error } = await updatePromotionEstado(promo.id, newEstado);
        if (error) return showToast('Error', error.message, 'error');
        const labels = { active: 'Activada', paused: 'Pausada', closed: 'Movida a historial', draft: 'Borrador' };
        showToast(labels[newEstado] || 'Actualizada', promo.nombre, 'success');
        load();
    };

    const handleDelete = (promo) => setPromoToDelete(promo);

    const confirmDelete = async () => {
        if (!promoToDelete) return;
        setIsDeleting(true);
        const { error } = await deletePromotion(promoToDelete.id);
        setIsDeleting(false);
        setPromoToDelete(null);
        if (error) return showToast('Error', error.message, 'error');
        showToast('Eliminado', promoToDelete.nombre, 'success');
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
                <div className="group flex items-center gap-0 flex-wrap rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[var(--shadow-glass-1)] transition-all duration-300 hover:shadow-[var(--shadow-elevation-md)] hover:-translate-y-0.5 shrink-0 overflow-visible max-w-full">
                    <div className="flex items-center px-2 py-2">
                        <Tag size={13} className="text-content-3 flex-shrink-0" />
                    </div>
                    <div className="h-5 w-px bg-divider shrink-0" />
                    {pillFilters.map((pf, idx) => (
                        <React.Fragment key={pf.key}>
                            {idx > 0 && <div className="h-5 w-px bg-divider shrink-0" />}
                            <button
                                onClick={() => setFilterState(pf.key)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-label font-semibold transition-all ${
                                    filterState === pf.key
                                        ? 'bg-chart-1-solid text-white shadow-sm'
                                        : 'text-content-3 hover:text-content-2 hover:bg-surface-card-hover'
                                }`}
                            >
                                {pf.label}
                                {pf.count > 0 && (
                                    <span className={`text-micro font-bold px-1 py-0.5 rounded-full ${
                                        filterState === pf.key ? 'bg-surface-card text-white' : 'bg-surface-card-hover text-content-3'
                                    }`}>
                                        {pf.count}
                                    </span>
                                )}
                            </button>
                        </React.Fragment>
                    ))}

                    {canEdit && (
                        <>
                            <div className="h-5 w-px bg-divider shrink-0" />
                            <Button tone="chart-1" icon={Plus} onClick={() => setShowModal(true)}>Nueva</Button>
                        </>
                    )}
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="py-16"><SkeletonText lines={5} /></div>
            )}

            {/* Empty */}
            {!loading && filtered.length === 0 && (
                <div className="text-center py-16">
                    <Tag size={32} className="mx-auto mb-3 text-content-3" />
                    <p className="text-body text-content-3 font-medium">
                        {searchTerm ? 'Sin resultados para esa búsqueda' : 'No hay promociones aquí'}
                    </p>
                    {canEdit && !searchTerm && (
                        <Button icon={Plus} onClick={() => setShowModal(true)}>Nueva Promoción</Button>
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
                onCreated={() => { setShowModal(false); load(); }}
            />

            <ConfirmModal
                isOpen={!!promoToDelete}
                onClose={() => setPromoToDelete(null)}
                onConfirm={confirmDelete}
                title="Eliminar Borrador"
                message={`¿Eliminar el borrador "${promoToDelete?.nombre}"?`}
                confirmText="Eliminar"
                cancelText="Cancelar"
                isProcessing={isDeleting}
                isDestructive={true}
            />
        </div>
    );
}
