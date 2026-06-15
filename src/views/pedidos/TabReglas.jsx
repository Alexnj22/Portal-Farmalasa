import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Check, X, Ban, AlertTriangle, Package,
    Sparkles, FlaskConical, Box, Layers, Sigma,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination                   from '../../components/common/TablePagination';
import LiquidSelect                      from '../../components/common/LiquidSelect';

const PAGE_SIZE      = 50;
const MULTIPLO_PILLS = [1, 2, 3, 5, 10, 25, 50];
const EASE           = [0.16, 1, 0.3, 1];

const EXPAND_BG     = 'bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/30';
const EXPAND_BORDER = 'border-blue-100/60';

const EMPTY_VALS = { dispatch_id_presentacion: null, dispatch_multiplo: '1', notes: '' };

const COLS = [
    { key: 'laboratorio_nombre', label: 'Laboratorio',     align: 'left',   sortable: true },
    { key: 'nombre',             label: 'Producto',        align: 'left',   sortable: true },
    { key: 'ab',                 label: 'AB',              align: 'center', className: 'w-10' },
    { key: 'estado',             label: 'Estado',          align: 'center', className: 'w-28' },
    { key: 'despacho',           label: 'Regla despacho',  align: 'center', className: 'w-44' },
    { key: 'notas',              label: 'Notas',           align: 'left'   },
];

// Icono + colores según tipo de presentación
const presStyle = (tipo) => {
    const t = (tipo || '').toUpperCase();
    if (t.startsWith('CAJA') || t.startsWith('BOLSA'))
        return { Icon: Box,     bg: 'bg-slate-800', text: 'text-white', iconInactive: 'text-slate-400' };
    if (t.startsWith('BLISTER') || t.startsWith('SOBRE'))
        return { Icon: Layers,  bg: 'bg-indigo-600', text: 'text-white', iconInactive: 'text-indigo-400' };
    if (t === 'UNIDAD' || t === 'UNIDADES' || t === 'PAR' || t === 'PARES')
        return { Icon: Sigma,   bg: 'bg-violet-600', text: 'text-white', iconInactive: 'text-violet-400' };
    return { Icon: Package, bg: 'bg-blue-600',   text: 'text-white', iconInactive: 'text-blue-400' };
};

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

// ── Panel edición — basado en presentaciones reales del producto ──────────────
function EditPanel({ product, rule, vals, setVals, saving, justSaved, saveError, onApply, onCancel }) {
    const [presentations, setPresentations] = useState([]);
    const [loadingPres,   setLoadingPres]   = useState(true);

    useEffect(() => {
        setLoadingPres(true);
        supabase
            .from('product_precios')
            .select('id, id_presentacion, factor, descripcion, presentaciones!inner(id, tipo)')
            .eq('product_id', product.id)
            .order('factor', { ascending: false })
            .then(({ data }) => {
                // Deduplica por id_presentacion — queda la de mayor factor
                const seen = new Set();
                const uniq = (data || []).filter(row => {
                    if (seen.has(row.id_presentacion)) return false;
                    seen.add(row.id_presentacion);
                    return true;
                });
                setPresentations(uniq);
                setLoadingPres(false);
            });
    }, [product.id]);

    const multiplo      = Number(vals.dispatch_multiplo) || 1;
    const selectedPres  = presentations.find(p => p.id_presentacion === vals.dispatch_id_presentacion);
    const selectedTipo  = selectedPres?.presentaciones?.tipo ?? '';

    const selectPres = (idPres) => {
        if (saving) return;
        const next = { ...vals, dispatch_id_presentacion: idPres };
        setVals(next);
        onApply(next);
    };

    const selectMultiplo = (n) => {
        if (saving) return;
        const next = { ...vals, dispatch_multiplo: String(n) };
        setVals(next);
        onApply(next);
    };

    const clearRule = () => {
        if (saving) return;
        const next = { ...vals, dispatch_id_presentacion: null, dispatch_multiplo: '1' };
        setVals(next);
        onApply(next);
    };

    const commitNotes = () => {
        if (!vals.dispatch_id_presentacion) return;
        if ((vals.notes || '') === (rule?.notes || '')) return;
        onApply(vals);
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
                <div className="flex items-center gap-2 flex-shrink-0">
                    {saving && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Loader2 size={11} className="animate-spin" /> Guardando…
                        </span>
                    )}
                    {!saving && justSaved && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold">
                            <Check size={11} /> Guardado
                        </span>
                    )}
                    {!saving && !justSaved && saveError && (
                        <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[260px]">
                            <AlertTriangle size={10} className="shrink-0" /> {saveError}
                        </span>
                    )}
                    <button onClick={onCancel}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors flex-shrink-0">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Presentaciones del producto */}
            <div>
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-2 font-bold">
                    Presentación de despacho
                    <span className="normal-case tracking-normal font-medium text-slate-300"> · se aplica automáticamente</span>
                </p>
                {loadingPres ? (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <Loader2 size={12} className="animate-spin" /> Cargando presentaciones…
                    </div>
                ) : presentations.length === 0 ? (
                    <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
                        Sin presentaciones en catálogo — no se puede asignar regla de despacho.
                    </div>
                ) : (
                    <div className={`flex flex-wrap gap-2 ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
                        {presentations.map(pres => {
                            const tipo     = pres.presentaciones?.tipo ?? 'DESCONOCIDO';
                            const isActive = vals.dispatch_id_presentacion === pres.id_presentacion;
                            const style    = presStyle(tipo);
                            const { Icon } = style;
                            return (
                                <button key={pres.id_presentacion} type="button"
                                    onClick={() => selectPres(pres.id_presentacion)}
                                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border-2 transition-all duration-150 select-none text-left ${
                                        isActive
                                            ? `${style.bg} border-transparent ${style.text} shadow-lg`
                                            : 'bg-white/80 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                                    }`}
                                >
                                    <Icon size={15} className={isActive ? 'text-white' : style.iconInactive} />
                                    <div>
                                        <p className="text-[12px] font-semibold leading-tight">{tipo}</p>
                                        <p className={`text-[9px] leading-tight ${isActive ? 'text-white/70' : 'text-slate-400'}`}>
                                            {pres.factor > 1 ? `${pres.factor} und. por pack` : 'unidad base'}
                                            {pres.descripcion ? ` · ${pres.descripcion}` : ''}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Cantidad por lote — solo si hay presentación seleccionada */}
            <AnimatePresence>
                {vals.dispatch_id_presentacion && (
                    <motion.div
                        key="multiplo-block"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="space-y-2"
                    >
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Por lote</p>
                        <div className={`flex flex-wrap gap-1.5 ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
                            {MULTIPLO_PILLS.map(n => (
                                <button key={n} type="button"
                                    onClick={() => selectMultiplo(n)}
                                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border-2 transition-all ${
                                        multiplo === n
                                            ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                                >×{n}</button>
                            ))}
                            <input type="number" min={1} placeholder="Otro…"
                                value={MULTIPLO_PILLS.includes(multiplo) ? '' : multiplo}
                                onChange={e => {
                                    const n = parseInt(e.target.value);
                                    if (n > 0) selectMultiplo(n);
                                }}
                                className="w-20 border border-slate-200 rounded-xl px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white/80"
                            />
                        </div>

                        {/* Ejemplo de redondeo */}
                        <div className="px-3 py-2 rounded-xl bg-blue-50/60 border border-blue-200/60 text-[11px] text-blue-700">
                            <span className="font-medium">Ejemplo:</span> necesidad de 7 packs
                            {' → '}despacha{' '}
                            <strong>{Math.ceil(7 / multiplo) * multiplo} pack(s)</strong>
                            {' '}de{' '}<strong>{selectedTipo}</strong>
                            {multiplo > 1 ? ` (múltiplo de ${multiplo})` : ''}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Botón quitar regla */}
            {vals.dispatch_id_presentacion && (
                <button onClick={clearRule} disabled={saving}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl border-2 bg-white/80 border-slate-200 text-slate-400 hover:border-rose-300 hover:bg-rose-50/40 hover:text-rose-500 transition-all text-[12px]">
                    <Ban size={13} /> Quitar regla de despacho
                </button>
            )}

            {/* Notas */}
            <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">
                    Notas internas
                    <span className="normal-case tracking-normal font-medium text-slate-300"> · se guardan al salir del campo</span>
                </p>
                <input type="text"
                    placeholder={!vals.dispatch_id_presentacion ? 'Selecciona una presentación para agregar notas' : 'Observación opcional…'}
                    value={vals.notes}
                    disabled={!vals.dispatch_id_presentacion}
                    onChange={e => setVals(p => ({ ...p, notes: e.target.value }))}
                    onBlur={commitNotes}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                    className="w-full border border-slate-200/80 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:border-blue-400 bg-white/80 backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
                />
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
    const [justSaved,       setJustSaved]       = useState(false);

    // Ref siempre al día para que applyVals y loadProducts lean reglas frescas
    // sin que cada autoguardado dispare un re-fetch de la tabla de productos.
    const rulesMapRef    = useRef({});
    const justSavedTimer = useRef(null);
    useEffect(() => { rulesMapRef.current = rulesMap; }, [rulesMap]);
    useEffect(() => () => clearTimeout(justSavedTimer.current), []);

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
                .select('id, erp_product_id, solo_cajas, multiplo, blister, multiplo_unidades, notes, dispatch_id_presentacion, dispatch_multiplo')
                .range(0, 9999),
            supabase.from('products').select('id', { count: 'exact', head: true }).eq('activo', true),
            supabase.from('products').select('id', { count: 'exact' }).eq('activo', true).gte('created_at', startOfMonth),
        ]);
        // Resuelve tipos de presentación para reglas nuevas
        const presIds = [...new Set((rulesRes.data || [])
            .map(r => r.dispatch_id_presentacion).filter(Boolean))];
        let presMap = {};
        if (presIds.length > 0) {
            const { data: presData } = await supabase.from('presentaciones').select('id, tipo').in('id', presIds);
            for (const p of (presData || [])) presMap[p.id] = p.tipo;
        }
        const map = {};
        for (const r of (rulesRes.data || [])) {
            map[r.erp_product_id] = {
                ...r,
                dispatch_tipo: r.dispatch_id_presentacion ? (presMap[r.dispatch_id_presentacion] ?? null) : null,
            };
        }
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

    // Lee las reglas desde el ref: un autoguardado no re-fetchea la lista
    // (la lista con filtro con/sin se refresca al cambiar página/filtros).
    useEffect(() => {
        if (loadingRules) return;
        const ids = Object.keys(rulesMapRef.current).map(Number);
        loadProducts(page, searchTerm, filterLab, filterRule, ids, hiddenLabIds, sortKey, sortDir, newProductIds);
    }, [page, searchTerm, filterLab, filterRule, hiddenLabIds, newProductIds, loadProducts, loadingRules, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSort = useCallback((key) => {
        setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortKey(key);
        setPage(1);
    }, [sortKey]);

    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setJustSaved(false);
        setEditVals({
            dispatch_id_presentacion: rule?.dispatch_id_presentacion ?? null,
            dispatch_multiplo:        String(rule?.dispatch_multiplo ?? 1),
            notes:                    rule?.notes ?? '',
        });
    }, []);

    const cancelEdit  = useCallback(() => { setEditingId(null); setSaveError(null); }, []);
    const toggleEdit  = useCallback((productId) => {
        if (editingId === productId) { cancelEdit(); return; }
        startEdit(productId, rulesMap[productId] ?? null);
    }, [editingId, rulesMap, startEdit, cancelEdit]);

    // Autoguardado: aplica los vals al instante. Sin botón Guardar.
    const applyVals = useCallback(async (productId, v) => {
        setSaving(true); setSaveError(null);
        const existing = rulesMapRef.current[productId];
        try {
            if (!v.dispatch_id_presentacion) {
                // Quitar regla → delete si existe
                if (existing) {
                    const { error } = await supabase.from('dispatch_rules').delete().eq('id', existing.id);
                    if (error) throw error;
                    useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(existing.id), { erp_product_id: productId });
                    const next = { ...rulesMapRef.current };
                    delete next[productId];
                    rulesMapRef.current = next;
                    setRulesMap(next);
                }
            } else {
                const payload = {
                    erp_product_id:           productId,
                    dispatch_id_presentacion: v.dispatch_id_presentacion,
                    dispatch_multiplo:        Number(v.dispatch_multiplo) || 1,
                    // Limpia columnas legacy al guardar con el nuevo sistema
                    solo_cajas:               null,
                    multiplo:                 null,
                    blister:                  null,
                    multiplo_unidades:        null,
                    notes:                    v.notes || null,
                    updated_at:               new Date().toISOString(),
                };
                let saved;
                if (existing) {
                    const { data, error } = await supabase.from('dispatch_rules')
                        .update(payload).eq('id', existing.id).select().single();
                    if (error) throw error;
                    saved = data;
                    useStaff.getState().appendAuditLog('EDITAR_REGLA_DESPACHO', String(existing.id), payload);
                } else {
                    const { data, error } = await supabase.from('dispatch_rules')
                        .insert(payload).select().single();
                    if (error) throw error;
                    saved = data;
                    useStaff.getState().appendAuditLog('CREAR_REGLA_DESPACHO', String(productId), payload);
                }
                // Refresca dispatch_tipo para el badge en tabla
                const next = { ...rulesMapRef.current, [productId]: { ...saved, dispatch_tipo: null } };
                rulesMapRef.current = next;
                setRulesMap(next);
            }
            setJustSaved(true);
            clearTimeout(justSavedTimer.current);
            justSavedTimer.current = setTimeout(() => setJustSaved(false), 2200);
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, []);

    // Computed
    const rulesCount = Object.keys(rulesMap).length;
    const sinRegla   = Math.max(0, allCount - rulesCount);
    const mesActual  = new Date().toLocaleDateString('es-SV', { month: 'long' });
    const labOptions = useMemo(() =>
        labs.filter(l => !l.ocultar_en_minmax).map(l => ({ value: String(l.id), label: l.nombre })),
        [labs]);

    // Badge para la columna "Regla despacho" en tabla
    const ruleTypeLabel = (rule) => {
        if (!rule) return null;
        // Regla nueva: presentación seleccionada
        if (rule.dispatch_id_presentacion) {
            const tipo = rule.dispatch_tipo ?? '–';
            const mult = rule.dispatch_multiplo ?? 1;
            const style = presStyle(tipo);
            return { text: mult > 1 ? `${tipo} ×${mult}` : tipo, bg: style.bg, txt: style.text };
        }
        // Legacy
        if (rule.multiplo          != null) return { text: `×${rule.multiplo} cajas`,     bg: 'bg-blue-100',   txt: 'text-blue-700'   };
        if (rule.blister           != null) return { text: `×${rule.blister} blíst.`,     bg: 'bg-indigo-100', txt: 'text-indigo-700' };
        if (rule.multiplo_unidades != null) return { text: `×${rule.multiplo_unidades}u`, bg: 'bg-violet-100', txt: 'text-violet-700' };
        return { text: 'Solo cajas', bg: 'bg-slate-100', txt: 'text-slate-600' };
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
                                        ? <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${typeTag.bg} ${typeTag.txt}`}>{typeTag.text}</span>
                                        : <span className="text-slate-200 text-[13px]">—</span>
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
                                                        saving={saving} justSaved={justSaved} saveError={saveError}
                                                        onApply={(v) => applyVals(prod.id, v)}
                                                        onCancel={cancelEdit}
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
        </div>
    );
}
