// Extracted from TabMinMax.jsx (Bloque 6.C)
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, X, Search, Loader2 } from 'lucide-react';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { smartFilter } from '../../../utils/searchUtils';
import {
    fetchLaboratoriosMinMaxVisibility, fetchActiveProductLabIds, updateLaboratorioMinMaxVisibility,
    fetchProductIdsByLaboratorio, unhideStockParamsForProducts,
} from '../../../data/minmaxLabs';

export default function LabsPanel({ onClose, onChanged }) {
    const [labs,      setLabs]      = useState([]);
    const [counts,    setCounts]    = useState({});  // laboratorio_id → product count
    const [loading,   setLoading]   = useState(true);
    const [saving,    setSaving]    = useState(null);
    const [err,       setErr]       = useState(null);
    const [search,    setSearch]    = useState('');
    const searchRef = useRef();

    useEffect(() => {
        Promise.all([
            fetchLaboratoriosMinMaxVisibility(),
            fetchActiveProductLabIds(),
        ]).then(([{ data: labData }, { data: prodData }]) => {
            setLabs(labData || []);
            const cm = {};
            (prodData || []).forEach(p => { if (p.laboratorio_id) cm[p.laboratorio_id] = (cm[p.laboratorio_id] || 0) + 1; });
            setCounts(cm);
            setLoading(false);
        });
        // Auto-focus search after mount
        setTimeout(() => searchRef.current?.focus(), 80);
    }, []);

    const toggle = async (lab) => {
        setSaving(lab.id);
        setErr(null);
        const newVal = !lab.ocultar_en_minmax;
        const { error } = await updateLaboratorioMinMaxVisibility(lab.id, newVal);
        if (!error) {
            // Al desocultar un lab, limpia is_hidden individual para que los productos
            // reaparezcan sin estar marcados como ocultos a nivel de producto
            if (!newVal) {
                const { data: prods } = await fetchProductIdsByLaboratorio(lab.id);
                if (prods?.length) {
                    // unhideStockParamsForProducts devuelve un array de resultados
                    // (uno por chunk de 1000) — un chunk fallido antes quedaba en
                    // silencio (hallazgo de /code-review post-auditoría).
                    const results = await unhideStockParamsForProducts(prods.map(p => p.id));
                    const failed = results.find(r => r.error);
                    if (failed) {
                        setErr(`Algunos productos no se pudieron desocultar: ${failed.error.message}`);
                        setSaving(null);
                        return;
                    }
                }
            }
            setLabs(prev => prev.map(l => l.id === lab.id ? { ...l, ocultar_en_minmax: newVal } : l));
            useStaff.getState().appendAuditLog('MINMAX_LAB_VISIBILITY', String(lab.id), {
                lab: lab.nombre, ocultar: newVal,
            });
            onChanged?.();
        } else {
            setErr(error.message);
        }
        setSaving(null);
    };

    const visible = search.trim() ? smartFilter(search, labs, l => [l.nombre]).results : labs;
    const hiddenCount = labs.filter(l => l.ocultar_en_minmax).length;

    // Glassmorphism tokens shared across elements
    const glass = {
        panel:  { background: 'rgba(240,245,255,0.72)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 24px 64px rgba(0,30,80,0.13), inset 0 1px 0 rgba(255,255,255,0.9)' },
        divider:{ borderColor: 'rgba(148,163,184,0.15)' },
        search: { background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(8px)', border: '1px solid rgba(148,163,184,0.22)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' },
        row:    { background: 'rgba(255,255,255,0.42)', border: '1px solid rgba(226,232,240,0.5)' },
        rowOff: { background: 'rgba(254,242,242,0.6)',  border: '1px solid rgba(252,165,165,0.4)' },
        footer: { background: 'rgba(255,255,255,0.38)', border: '1px solid rgba(226,232,240,0.4)' },
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-20 pointer-events-none">
            <motion.div
                className="pointer-events-auto w-72 rounded-2xl overflow-hidden flex flex-col"
                style={glass.panel}
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b" style={glass.divider}>
                    <div className="flex items-center gap-2">
                        <FlaskConical size={14} className="text-[#0052CC]" />
                        <span className="text-[12px] font-black text-slate-800">Visibilidad de laboratorios</span>
                        {hiddenCount > 0 && (
                            <span className="text-[9px] font-black text-[#0052CC] bg-blue-50/80 border border-blue-200/70 px-1.5 py-0.5 rounded-full leading-none">
                                {hiddenCount} oculto{hiddenCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 transition-colors"
                        style={{ background: 'rgba(255,255,255,0.6)' }}>
                        <X size={11} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-3 pt-3 pb-1.5">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={glass.search}>
                        <Search size={11} className="text-slate-400 shrink-0" />
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar laboratorio…"
                            className="flex-1 text-[16px] text-slate-700 placeholder-slate-400 bg-transparent outline-none"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-500 transition-colors shrink-0">
                                <X size={10} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Hint */}
                <p className="px-4 pb-1.5 text-[9.5px] text-slate-500 leading-relaxed">
                    Ocultos: no aparecen en MinMax ni en el cálculo. No se cuentan como productos ocultos individualmente.
                </p>

                {err && (
                    <p className="mx-3 mb-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 text-[10px] text-red-600 font-semibold">
                        {err}
                    </p>
                )}

                {/* List */}
                <div className="px-3 pb-2 flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '54vh' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 size={18} className="animate-spin text-slate-400" />
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="flex flex-col items-center py-8 gap-2 text-slate-500">
                            <FlaskConical size={22} />
                            <span className="text-[10px] font-semibold">Sin resultados</span>
                        </div>
                    ) : visible.map(lab => {
                        const hidden = lab.ocultar_en_minmax;
                        const count  = counts[lab.id] ?? 0;
                        return (
                            <button key={lab.id}
                                onClick={() => toggle(lab)}
                                disabled={saving === lab.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-200 disabled:opacity-60 hover:scale-[1.01] active:scale-[0.99]"
                                style={hidden ? glass.rowOff : glass.row}>
                                <div className="flex-1 min-w-0">
                                    <div className={`text-[11px] font-semibold truncate ${hidden ? 'text-red-700' : 'text-slate-700'}`}>
                                        {lab.nombre}
                                    </div>
                                    {count > 0 && (
                                        <div className={`text-[9px] tabular-nums ${hidden ? 'text-red-400' : 'text-slate-500'}`}>
                                            {count} producto{count !== 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    {saving === lab.id ? (
                                        <Loader2 size={12} className="animate-spin text-slate-400" />
                                    ) : (
                                        <div className={`w-8 h-4 rounded-full transition-all duration-300 relative ${hidden ? 'bg-red-400' : 'bg-slate-200'}`}
                                            style={hidden ? { boxShadow: '0 0 8px rgba(248,113,113,0.35)' } : {}}>
                                            <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-300 ${hidden ? 'left-[18px]' : 'left-0.5'}`} />
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-3 pb-3 pt-1 border-t mt-auto" style={glass.divider}>
                    <button onClick={onClose}
                        className="w-full py-2 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors duration-150"
                        style={glass.footer}
                        onMouseOver={e => Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,0.65)' })}
                        onMouseOut={e => Object.assign(e.currentTarget.style, glass.footer)}>
                        Cerrar
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
