import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Check, X, Trash2, AlertTriangle, Package,
    Sparkles, FlaskConical, Box, Layers,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination                   from '../../components/common/TablePagination';
import LiquidSelect                      from '../../components/common/LiquidSelect';
import ConfirmModal                      from '../../components/common/ConfirmModal';

const PAGE_SIZE       = 50;
const VALID_MULTIPLES = new Set([2, 3, 4, 5, 6, 10, 12, 20, 24, 25, 50]);
const MULTIPLO_PILLS  = [2, 3, 6, 10, 12, 20, 24, 50];
const EASE            = [0.16, 1, 0.3, 1];

// Tokens del expand row (valores fijos de DataTable.useTokens)
const EXPAND_BG     = 'bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/30';
const EXPAND_BORDER = 'border-blue-100/60';

// Tipos de regla: solo uno activo a la vez
const RULE_TYPES = [
    {
        id:    'solo_cajas',
        label: 'Solo cajas',
        desc:  'Despacha únicamente cajas completas',
        Icon:  Box,
        color: 'slate',
    },
    {
        id:    'multiplo',
        label: 'Múltiplo caja',
        desc:  'Distribuye en múltiplos de N cajas',
        Icon:  Layers,
        color: 'blue',
    },
    {
        id:    'blister',
        label: 'Múltiplo blíster',
        desc:  'Redondea a N blísters por envío',
        Icon:  Layers,
        color: 'indigo',
    },
];

// Detecta qué tipo de regla tiene un rule existente
const detectType = (rule) => {
    if (!rule) return 'solo_cajas';
    if (rule.multiplo != null) return 'multiplo';
    if (rule.blister  != null) return 'blister';
    return 'solo_cajas';
};

const EMPTY_VALS = { ruleType: 'solo_cajas', multiplo: '', blister: '', notes: '' };

const COLS = [
    { key: 'laboratorio_nombre', label: 'Laboratorio', align: 'left',   sortable: true },
    { key: 'nombre',             label: 'Producto',    align: 'left',   sortable: true },
    { key: 'ab',                 label: 'AB',          align: 'center', className: 'w-10' },
    { key: 'estado',             label: 'Estado',      align: 'center', className: 'w-28' },
    { key: 'tipo',               label: 'Tipo regla',  align: 'center', className: 'w-32' },
    { key: 'valor',              label: 'Valor',       align: 'center', className: 'w-20' },
    { key: 'notas',              label: 'Notas',       align: 'left'   },
];

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, sub, value, Icon, iconBg, iconCls, countCls, active, activeBg, inactiveBg, loading, onClick }) {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag onClick={onClick} disabled={loading}
            className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${active ? activeBg : inactiveBg}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading ? <Loader2 size={14} className="animate-spin text-slate-300" /> : <Icon size={15} className={iconCls} />}
            </div>
            <div className="text-left min-w-0">
                <div className={`text-[22px] font-black leading-none tabular-nums ${countCls}`}>
                    {loading ? <span className="text-slate-200">–</span> : (value ?? 0).toLocaleString()}
                </div>
                <div className="text-[10px] font-bold leading-tight text-slate-600">{label}</div>
                {sub && <div className="text-[9px] text-slate-400">{sub}</div>}
            </div>
            {active && onClick && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
        </Tag>
    );
}

// ── Panel edición con tipo único de regla ─────────────────────────────────────
function EditPanel({ product, rule, vals, setVals, saving, saveError, onSave, onCancel, onDelete }) {
    const hasRule = !!rule;

    const typeColors = {
        solo_cajas: {
            active:   'bg-slate-800 border-slate-700 text-white shadow-lg',
            inactive: 'bg-white/80 border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-white',
            icon:     hasRule && vals.ruleType === 'solo_cajas' ? 'text-white' : 'text-slate-400',
            dot:      'bg-slate-600',
        },
        multiplo: {
            active:   'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-200/50',
            inactive: 'bg-white/80 border-slate-200 text-slate-500 hover:border-blue-300 hover:bg-blue-50/40',
            icon:     vals.ruleType === 'multiplo' ? 'text-white' : 'text-blue-400',
            dot:      'bg-blue-500',
        },
        blister: {
            active:   'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-200/50',
            inactive: 'bg-white/80 border-slate-200 text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/40',
            icon:     vals.ruleType === 'blister' ? 'text-white' : 'text-indigo-400',
            dot:      'bg-indigo-500',
        },
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-semibold text-slate-800 text-[14px] leading-tight">{product.nombre}</p>
                    {product.laboratorio_nombre && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{product.laboratorio_nombre}</p>
                    )}
                </div>
                <button onClick={onCancel}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors flex-shrink-0">
                    <X size={14} />
                </button>
            </div>

            {/* Selector de tipo — solo uno activo */}
            <div>
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-2 font-bold">Tipo de regla</p>
                <div className="flex flex-wrap gap-2">
                    {RULE_TYPES.map(rt => {
                        const isActive = vals.ruleType === rt.id;
                        const c        = typeColors[rt.id];
                        return (
                            <button key={rt.id} type="button"
                                onClick={() => setVals(p => ({
                                    ...p,
                                    ruleType: rt.id,
                                    multiplo: rt.id !== 'multiplo' ? '' : p.multiplo,
                                    blister:  rt.id !== 'blister'  ? '' : p.blister,
                                }))}
                                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border-2 transition-all duration-150 select-none ${
                                    isActive ? c.active : c.inactive
                                }`}
                            >
                                <rt.Icon size={14} className={isActive ? 'text-white' : c.icon} />
                                <div className="text-left">
                                    <p className="text-[12px] font-semibold leading-tight">{rt.label}</p>
                                    <p className={`text-[9px] leading-tight ${isActive ? 'text-white/70' : 'text-slate-400'}`}>{rt.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Detalle según tipo */}
            <AnimatePresence mode="wait">
                {vals.ruleType === 'solo_cajas' && (
                    <motion.div key="solo_cajas"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="px-4 py-3 rounded-xl bg-slate-50/80 border border-slate-200/60 backdrop-blur-sm"
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                                <Box size={14} className="text-white" />
                            </div>
                            <div>
                                <p className="text-[12px] font-semibold text-slate-700">Solo cajas completas activado</p>
                                <p className="text-[11px] text-slate-400">El despacho no fraccionará cajas. El complemento queda en Bodega.</p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {vals.ruleType === 'multiplo' && (
                    <motion.div key="multiplo"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="space-y-2"
                    >
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Múltiplo de cajas</p>
                        <div className="flex flex-wrap gap-1.5">
                            {MULTIPLO_PILLS.map(n => (
                                <button key={n} type="button"
                                    onClick={() => setVals(p => ({ ...p, multiplo: p.multiplo === String(n) ? '' : String(n) }))}
                                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border-2 transition-all ${
                                        vals.multiplo === String(n)
                                            ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                                >×{n}</button>
                            ))}
                        </div>
                        <input type="number" min={1} placeholder="Otro número…"
                            value={vals.multiplo}
                            onChange={e => setVals(p => ({ ...p, multiplo: e.target.value }))}
                            className="w-36 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white/80"
                        />
                    </motion.div>
                )}

                {vals.ruleType === 'blister' && (
                    <motion.div key="blister"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="space-y-2"
                    >
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Múltiplo de blísters</p>
                        <div className="flex flex-wrap gap-1.5">
                            {MULTIPLO_PILLS.map(n => (
                                <button key={n} type="button"
                                    onClick={() => setVals(p => ({ ...p, blister: p.blister === String(n) ? '' : String(n) }))}
                                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border-2 transition-all ${
                                        vals.blister === String(n)
                                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                    }`}
                                >×{n}</button>
                            ))}
                        </div>
                        <input type="number" min={1} placeholder="Otro número…"
                            value={vals.blister}
                            onChange={e => setVals(p => ({ ...p, blister: e.target.value }))}
                            className="w-36 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-indigo-400 bg-white/80"
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Notas */}
            <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Notas internas</p>
                <input type="text" placeholder="Observación opcional…"
                    value={vals.notes}
                    onChange={e => setVals(p => ({ ...p, notes: e.target.value }))}
                    className="w-full border border-slate-200/80 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:border-blue-400 bg-white/80 backdrop-blur-sm"
                />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-0.5">
                <div>
                    {hasRule && (
                        <button onClick={onDelete}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-colors">
                            <Trash2 size={11} /> Eliminar regla
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {saveError && (
                        <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[220px]">
                            <AlertTriangle size={10} className="shrink-0" /> {saveError}
                        </span>
                    )}
                    <button onClick={onCancel}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-[12px] transition-colors">
                        Cancelar
                    </button>
                    <button onClick={onSave} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {hasRule ? 'Actualizar' : 'Crear regla'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TabReglas({ searchTerm = '' }) {

    const [rulesMap,        setRulesMap]        = useState({});
    const [loadingRules,    setLoadingRules]    = useState(true);
    const [products,        setProducts]        = useState([]);
    const [totalCount,      setTotalCount]      = useState(0);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [page,            setPage]            = useState(1);
    const [allCount,        setAllCount]        = useState(0);
    const [statsLoading,    setStatsLoading]    = useState(true);
    const [newProductIds,   setNewProductIds]   = useState(new Set());
    const [thisMonthCount,  setThisMonthCount]  = useState(0);
    const [sortKey,         setSortKey]         = useState('laboratorio_nombre');
    const [sortDir,         setSortDir]         = useState('asc');
    const [labs,            setLabs]            = useState([]);
    const [hiddenLabIds,    setHiddenLabIds]    = useState([]);
    const [filterLab,       setFilterLab]       = useState(null);
    const [filterRule,      setFilterRule]      = useState('');
    const [editingId,       setEditingId]       = useState(null);
    const [editVals,        setEditVals]        = useState(EMPTY_VALS);
    const [saving,          setSaving]          = useState(false);
    const [saveError,       setSaveError]       = useState(null);
    const [confirmDel,      setConfirmDel]      = useState(null);
    const [deleting,        setDeleting]        = useState(false);

    // Labs con flag ocultar_en_minmax
    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre')
            .then(({ data }) => {
                setLabs(data || []);
                setHiddenLabIds((data || []).filter(l => l.ocultar_en_minmax).map(l => l.id));
            });
    }, []);

    // Reglas + stats
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        setStatsLoading(true);
        const now          = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const [rulesRes, totalRes, newRes] = await Promise.all([
            supabase.from('dispatch_rules')
                .select('id, erp_product_id, solo_cajas, multiplo, blister, notes')
                .range(0, 9999),
            supabase.from('products').select('id', { count: 'exact', head: true }).eq('activo', true),
            supabase.from('products').select('id', { count: 'exact' }).eq('activo', true).gte('created_at', startOfMonth),
        ]);
        const map = {};
        for (const r of (rulesRes.data || [])) map[r.erp_product_id] = r;
        setRulesMap(map);
        setAllCount(totalRes.count ?? 0);
        setThisMonthCount(newRes.count ?? 0);
        setNewProductIds(new Set((newRes.data || []).map(p => p.id)));
        setLoadingRules(false);
        setStatsLoading(false);
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);
    useEffect(() => { setPage(1); }, [searchTerm, filterLab, filterRule, sortKey, sortDir]);

    // Productos paginados
    const loadProducts = useCallback(async (pg, term, labId, ruleFilter, ruleIds, hiddenLabs, sk, sd, newIds) => {
        setLoadingProducts(true);
        const offset = (pg - 1) * PAGE_SIZE;
        let q = supabase
            .from('products_with_lab')
            .select('id, nombre, es_antibiotico, laboratorio_nombre, laboratorio_id', { count: 'exact' })
            .eq('activo', true)
            .range(offset, offset + PAGE_SIZE - 1);

        if (hiddenLabs.length > 0)
            q = q.not('laboratorio_id', 'in', `(${hiddenLabs.join(',')})`);

        const asc = sd !== 'desc';
        q = q.order(sk, { ascending: asc });
        if (sk !== 'nombre') q = q.order('nombre', { ascending: true });

        if (term.length >= 2) q = q.ilike('nombre', `%${term}%`);
        if (labId) q = q.eq('laboratorio_id', parseInt(labId));

        if (ruleFilter === 'con') {
            q = ruleIds.length > 0 ? q.in('id', ruleIds) : q.in('id', [0]);
        } else if (ruleFilter === 'sin' && ruleIds.length > 0) {
            q = q.not('id', 'in', `(${ruleIds.join(',')})`);
        } else if (ruleFilter === 'nuevo') {
            const arr = [...newIds];
            q = arr.length > 0 ? q.in('id', arr) : q.in('id', [0]);
        }

        const { data, count } = await q;
        setProducts(data || []);
        setTotalCount(count ?? 0);
        setLoadingProducts(false);
    }, []);

    useEffect(() => {
        if (loadingRules) return;
        const ids = Object.keys(rulesMap).map(Number);
        loadProducts(page, searchTerm, filterLab, filterRule, ids, hiddenLabIds, sortKey, sortDir, newProductIds);
    }, [page, searchTerm, filterLab, filterRule, rulesMap, hiddenLabIds, newProductIds, loadProducts, loadingRules, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSort = useCallback((key) => {
        setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortKey(key);
        setPage(1);
    }, [sortKey]);

    // Validación: solo un tipo activo, y el valor requerido
    const validateVals = (v) => {
        if (v.ruleType === 'multiplo') {
            if (!v.multiplo) return 'Seleccioná un múltiplo de cajas.';
            const m = parseInt(v.multiplo);
            if (!VALID_MULTIPLES.has(m)) return `Múltiplo inválido (${m}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        }
        if (v.ruleType === 'blister') {
            if (!v.blister) return 'Seleccioná un múltiplo de blíster.';
            const b = parseInt(v.blister);
            if (!VALID_MULTIPLES.has(b)) return `Múltiplo inválido (${b}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        }
        return null;
    };

    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setEditVals({
            ruleType: detectType(rule),
            multiplo: rule?.multiplo != null ? String(rule.multiplo) : '',
            blister:  rule?.blister  != null ? String(rule.blister)  : '',
            notes:    rule?.notes    ?? '',
        });
    }, []);

    const cancelEdit  = useCallback(() => { setEditingId(null); setSaveError(null); }, []);
    const toggleEdit  = useCallback((productId) => {
        if (editingId === productId) { cancelEdit(); return; }
        startEdit(productId, rulesMap[productId] ?? null);
    }, [editingId, rulesMap, startEdit, cancelEdit]);

    const handleSave = useCallback(async (productId) => {
        const err = validateVals(editVals);
        if (err) { setSaveError(err); return; }
        setSaving(true); setSaveError(null);

        const existing = rulesMap[productId];
        // Garantiza un solo tipo: los campos no activos van a null
        const payload = {
            erp_product_id: productId,
            solo_cajas:  editVals.ruleType !== 'blister',
            multiplo:    editVals.ruleType === 'multiplo' ? (parseInt(editVals.multiplo) || null) : null,
            blister:     editVals.ruleType === 'blister'  ? (parseInt(editVals.blister)  || null) : null,
            notes:       editVals.notes || null,
            updated_at:  new Date().toISOString(),
        };

        try {
            if (existing) {
                const { error } = await supabase.from('dispatch_rules').update(payload).eq('id', existing.id);
                if (error) throw error;
                useStaff.getState().appendAuditLog('EDITAR_REGLA_DESPACHO', String(existing.id), payload);
            } else {
                const { error } = await supabase.from('dispatch_rules').insert(payload);
                if (error) throw error;
                useStaff.getState().appendAuditLog('CREAR_REGLA_DESPACHO', String(productId), payload);
            }
            setEditingId(null);
            await loadRules();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [editVals, rulesMap, loadRules]);

    const handleDelete = useCallback((productId) => {
        const rule    = rulesMap[productId];
        if (!rule) return;
        const product = products.find(p => p.id === productId);
        setConfirmDel({ productId, nombre: product?.nombre ?? '?', ruleId: rule.id });
    }, [rulesMap, products]);

    const doDelete = useCallback(async () => {
        if (!confirmDel) return;
        setDeleting(true);
        const { error } = await supabase.from('dispatch_rules').delete().eq('id', confirmDel.ruleId);
        if (!error) {
            useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(confirmDel.ruleId), {});
            setEditingId(null);
            await loadRules();
        }
        setDeleting(false);
        setConfirmDel(null);
    }, [confirmDel, loadRules]);

    // Computed
    const rulesCount = Object.keys(rulesMap).length;
    const sinRegla   = Math.max(0, allCount - rulesCount);
    const mesActual  = new Date().toLocaleDateString('es-SV', { month: 'long' });
    const labOptions = useMemo(() =>
        labs.filter(l => !l.ocultar_en_minmax).map(l => ({ value: String(l.id), label: l.nombre })),
        [labs]);

    // Etiqueta de tipo de regla para la tabla
    const ruleTypeLabel = (rule) => {
        if (!rule) return null;
        if (rule.multiplo != null) return { text: `×${rule.multiplo} cajas`, cls: 'bg-blue-100 text-blue-700 border-blue-200' };
        if (rule.blister  != null) return { text: `×${rule.blister} blíst.`, cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
        return { text: 'Solo cajas', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    };

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Stat cards + filtros ───────────────────────────────────────── */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">

                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[130px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50">
                            {statsLoading ? <Loader2 size={14} className="animate-spin text-slate-300" /> : <Package size={15} className="text-[#0052CC]" />}
                        </div>
                        <div>
                            <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                                {statsLoading ? <span className="text-slate-200">–</span> : allCount.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">Productos activos</div>
                        </div>
                    </div>

                    <StatCard label="Con regla" value={rulesCount}
                        Icon={Check} iconBg={filterRule === 'con' ? 'bg-white' : 'bg-emerald-50'} iconCls="text-emerald-500"
                        countCls={rulesCount > 0 ? 'text-emerald-600' : 'text-slate-300'}
                        active={filterRule === 'con'}
                        activeBg="bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40"
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'con' ? '' : 'con')}
                    />

                    <StatCard label="Sin regla" value={sinRegla}
                        Icon={AlertTriangle} iconBg={filterRule === 'sin' ? 'bg-white' : 'bg-red-50'} iconCls="text-red-400"
                        countCls={sinRegla > 0 ? 'text-red-500' : 'text-slate-300'}
                        active={filterRule === 'sin'}
                        activeBg="bg-red-50 border-red-300 shadow-md shadow-red-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-red-200 hover:bg-red-50/40"
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'sin' ? '' : 'sin')}
                    />

                    <StatCard label="Nuevos este mes" sub={`agregados en ${mesActual}`} value={thisMonthCount}
                        Icon={Sparkles} iconBg={filterRule === 'nuevo' ? 'bg-white' : 'bg-emerald-50'} iconCls="text-emerald-500"
                        countCls={thisMonthCount > 0 ? 'text-emerald-600' : 'text-slate-300'}
                        active={filterRule === 'nuevo'}
                        activeBg="bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40"
                        loading={statsLoading}
                        onClick={() => setFilterRule(f => f === 'nuevo' ? '' : 'nuevo')}
                    />
                </div>

                {/* Pill filtros */}
                <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-sm">
                    <div style={{ minWidth: 210 }}>
                        <LiquidSelect bare compact icon={FlaskConical}
                            placeholder="Todos los laboratorios"
                            options={labOptions} value={filterLab}
                            onChange={v => { setFilterLab(v); setPage(1); }} clearable
                        />
                    </div>
                    {(filterLab || filterRule) && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button onClick={() => { setFilterLab(null); setFilterRule(''); }}
                                className="flex items-center gap-1 px-3 py-2 text-[11px] text-slate-400 hover:text-red-500 transition-colors whitespace-nowrap">
                                <X size={11} /> Limpiar
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Tabla ─────────────────────────────────────────────────────── */}
            <DataTable columns={COLS} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
                loading={loadingProducts || loadingRules} skeletonRows={8}
                empty={{
                    icon: Package,
                    message: searchTerm.length >= 2 ? `Sin resultados para "${searchTerm}".`
                        : filterRule === 'con'   ? 'No hay productos con regla asignada.'
                        : filterRule === 'sin'   ? 'Todos los productos tienen regla asignada.'
                        : filterRule === 'nuevo' ? `Sin productos nuevos en ${mesActual}.`
                        : 'Sin productos en catálogo.',
                }}
                minWidth="720px"
            >
                {products.map((prod, i) => {
                    const isEditing = editingId === prod.id;
                    const rule      = rulesMap[prod.id] ?? null;
                    const hasRule   = !!rule;
                    const isNew     = newProductIds.has(prod.id);
                    const typeTag   = ruleTypeLabel(rule);

                    return (
                        <React.Fragment key={prod.id}>
                            <DataRow index={i} onClick={() => toggleEdit(prod.id)}
                                className={isEditing ? 'bg-blue-50/60' : ''}>

                                <DataCell className="text-slate-400 text-[12px]">
                                    <span className="block truncate max-w-[150px]">{prod.laboratorio_nombre ?? '—'}</span>
                                </DataCell>

                                <DataCell>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-slate-700 text-[13px]">{prod.nombre}</span>
                                        {isNew && (
                                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold uppercase tracking-wide flex-shrink-0">
                                                <Sparkles size={8} /> Nuevo
                                            </span>
                                        )}
                                    </div>
                                </DataCell>

                                <DataCell align="center">
                                    {prod.es_antibiotico && (
                                        <span title="Antibiótico" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 border border-violet-200">
                                            <FlaskConical size={10} className="text-violet-600" />
                                        </span>
                                    )}
                                </DataCell>

                                <DataCell align="center">
                                    {hasRule ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium">
                                            <Check size={9} /> Con regla
                                        </span>
                                    ) : (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200 font-medium">
                                            Sin regla
                                        </span>
                                    )}
                                </DataCell>

                                <DataCell align="center">
                                    {typeTag
                                        ? <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${typeTag.cls}`}>{typeTag.text}</span>
                                        : <span className="text-slate-200 text-[13px]">—</span>
                                    }
                                </DataCell>

                                <DataCell align="center" className="text-[13px] tabular-nums text-slate-500">
                                    {hasRule
                                        ? rule.multiplo ? `×${rule.multiplo}` : rule.blister ? `×${rule.blister}` : <span className="text-slate-300">—</span>
                                        : <span className="text-slate-200">—</span>
                                    }
                                </DataCell>

                                <DataCell className="text-slate-400 italic text-[12px] max-w-[140px]">
                                    {hasRule
                                        ? <span className="block truncate">{rule.notes || <span className="not-italic text-slate-200">—</span>}</span>
                                        : <span className="text-slate-200">—</span>
                                    }
                                </DataCell>
                            </DataRow>

                            {/* Panel edición con animación entrada/salida */}
                            <AnimatePresence>
                                {isEditing && (
                                    <motion.tr key={`ep-${prod.id}`}
                                        className={`${EXPAND_BG} border-b ${EXPAND_BORDER}`}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <td colSpan={COLS.length} className="p-0">
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.25, ease: EASE }}
                                                style={{ overflow: 'hidden' }}
                                            >
                                                <div className="px-5 py-4">
                                                    <EditPanel
                                                        product={prod} rule={rule}
                                                        vals={editVals} setVals={setEditVals}
                                                        saving={saving} saveError={saveError}
                                                        onSave={() => handleSave(prod.id)}
                                                        onCancel={cancelEdit}
                                                        onDelete={() => handleDelete(prod.id)}
                                                    />
                                                </div>
                                            </motion.div>
                                        </td>
                                    </motion.tr>
                                )}
                            </AnimatePresence>
                        </React.Fragment>
                    );
                })}
            </DataTable>

            <TablePagination page={page} pageSize={PAGE_SIZE} total={totalCount}
                onPageChange={setPage} onPageSizeChange={() => {}} />

            <ConfirmModal
                isOpen={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={doDelete}
                title="Eliminar regla"
                message={`¿Eliminar la regla de "${confirmDel?.nombre}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar" isDestructive isProcessing={deleting}
            />
        </div>
    );
}
