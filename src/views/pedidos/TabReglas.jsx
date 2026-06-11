import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Check, X, Trash2, AlertTriangle, Package,
    Sparkles, CheckSquare, Square, FlaskConical,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination                   from '../../components/common/TablePagination';
import LiquidSelect                      from '../../components/common/LiquidSelect';
import ConfirmModal                      from '../../components/common/ConfirmModal';

const PAGE_SIZE       = 50;
// solo_cajas=true por defecto en reglas nuevas
const EMPTY_VALS      = { solo_cajas: true, multiplo: '', blister: '', notes: '' };
const VALID_MULTIPLES = new Set([2, 3, 4, 5, 6, 10, 12, 20, 24, 25, 50]);
const MULTIPLO_PILLS  = [2, 3, 6, 10, 12, 20, 24, 50];

// Tokens del expand row — valores fijos del DataTable useTokens()
const EXPAND_BG     = 'bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/30';
const EXPAND_BORDER = 'border-blue-100/60';

const COLS = [
    { key: 'laboratorio_nombre', label: 'Laboratorio', align: 'left',   sortable: true },
    { key: 'nombre',             label: 'Producto',    align: 'left',   sortable: true },
    { key: 'ab',                 label: 'AB',          align: 'center', className: 'w-10' },
    { key: 'estado',             label: 'Estado',      align: 'center', className: 'w-28' },
    { key: 'cajas',              label: 'Solo cajas',  align: 'center', className: 'w-20' },
    { key: 'multiplo',           label: 'Múltiplo',    align: 'center', className: 'w-20' },
    { key: 'blister',            label: 'Blíster',     align: 'center', className: 'w-20' },
    { key: 'notas',              label: 'Notas',       align: 'left'   },
];

// ── Stat card (igual que en TabCatalogo) ──────────────────────────────────────
function StatCard({ label, sub, value, Icon, iconBg, iconCls, countCls, active, activeBg, inactiveBg, loading, onClick }) {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            onClick={onClick}
            disabled={loading}
            className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${active ? activeBg : inactiveBg}`}
        >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                {loading
                    ? <Loader2 size={14} className="animate-spin text-slate-300" />
                    : <Icon size={15} className={iconCls} />
                }
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

// ── Panel de edición rediseñado ───────────────────────────────────────────────
function EditPanel({ product, rule, vals, setVals, saving, saveError, onSave, onCancel, onDelete }) {
    const hasRule = !!rule;
    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-semibold text-slate-800 text-[14px] leading-tight">{product.nombre}</p>
                    {product.laboratorio_nombre && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{product.laboratorio_nombre}</p>
                    )}
                </div>
                <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors flex-shrink-0">
                    <X size={14} />
                </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Solo cajas — toggle prominente */}
                <button type="button"
                    onClick={() => setVals(p => ({ ...p, solo_cajas: !p.solo_cajas }))}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border-2 font-semibold transition-all select-none ${
                        vals.solo_cajas
                            ? 'bg-slate-800 border-slate-700 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}
                >
                    {vals.solo_cajas ? <CheckSquare size={18} /> : <Square size={18} />}
                    <span className="text-[11px] text-center leading-tight">Solo cajas<br/>completas</span>
                </button>

                {/* Múltiplo packs */}
                <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Múltiplo packs</p>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                        {MULTIPLO_PILLS.map(n => (
                            <button key={n} type="button"
                                onClick={() => setVals(p => ({ ...p, multiplo: p.multiplo === String(n) ? '' : String(n) }))}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                                    vals.multiplo === String(n)
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white border border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600'
                                }`}
                            >×{n}</button>
                        ))}
                    </div>
                    <input type="number" min={1} placeholder="Otro…" value={vals.multiplo}
                        onChange={e => setVals(p => ({ ...p, multiplo: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white"
                    />
                </div>

                {/* Múltiplo blíster */}
                <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Múltiplo blíster</p>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                        {MULTIPLO_PILLS.map(n => (
                            <button key={n} type="button"
                                onClick={() => setVals(p => ({ ...p, blister: p.blister === String(n) ? '' : String(n) }))}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                                    vals.blister === String(n)
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white border border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600'
                                }`}
                            >×{n}</button>
                        ))}
                    </div>
                    <input type="number" min={1} placeholder="Otro…" value={vals.blister}
                        onChange={e => setVals(p => ({ ...p, blister: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-indigo-400 bg-white"
                    />
                </div>

                {/* Notas */}
                <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Notas internas</p>
                    <div className="h-[26px] mb-1.5" />
                    <input type="text" placeholder="Observación…" value={vals.notes}
                        onChange={e => setVals(p => ({ ...p, notes: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white"
                    />
                </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
                <div>
                    {hasRule && (
                        <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-colors">
                            <Trash2 size={11} /> Eliminar regla
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {saveError && (
                        <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[200px]">
                            <AlertTriangle size={10} className="shrink-0" /> {saveError}
                        </span>
                    )}
                    <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-[12px] transition-colors">
                        Cancelar
                    </button>
                    <button onClick={onSave} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm">
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

    // Rules
    const [rulesMap,        setRulesMap]        = useState({});
    const [loadingRules,    setLoadingRules]    = useState(true);

    // Products
    const [products,        setProducts]        = useState([]);
    const [totalCount,      setTotalCount]      = useState(0);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [page,            setPage]            = useState(1);

    // Stats
    const [allCount,        setAllCount]        = useState(0);
    const [statsLoading,    setStatsLoading]    = useState(true);
    const [newProductIds,   setNewProductIds]   = useState(new Set());
    const [thisMonthCount,  setThisMonthCount]  = useState(0);

    // Sort
    const [sortKey, setSortKey] = useState('laboratorio_nombre');
    const [sortDir, setSortDir] = useState('asc');

    // Filters
    const [labs,         setLabs]         = useState([]);
    const [hiddenLabIds, setHiddenLabIds] = useState([]);
    const [filterLab,    setFilterLab]    = useState(null);
    const [filterRule,   setFilterRule]   = useState(''); // '' | 'con' | 'sin' | 'nuevo'

    // Edit
    const [editingId,  setEditingId]  = useState(null);
    const [editVals,   setEditVals]   = useState(EMPTY_VALS);
    const [saving,     setSaving]     = useState(false);
    const [saveError,  setSaveError]  = useState(null);

    // Delete
    const [confirmDel, setConfirmDel] = useState(null);
    const [deleting,   setDeleting]   = useState(false);

    // ── Labs con flag ocultar_en_minmax ───────────────────────────────────────
    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre')
            .then(({ data }) => {
                setLabs(data || []);
                setHiddenLabIds((data || []).filter(l => l.ocultar_en_minmax).map(l => l.id));
            });
    }, []);

    // ── Reglas + stats globales ───────────────────────────────────────────────
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        setStatsLoading(true);
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [rulesRes, totalRes, newRes] = await Promise.all([
            supabase.from('dispatch_rules')
                .select('id, erp_product_id, solo_cajas, multiplo, blister, notes')
                .range(0, 9999),
            // total activos desde products (no products_with_lab, para evitar problemas de vista)
            supabase.from('products')
                .select('id', { count: 'exact', head: true })
                .eq('activo', true),
            // nuevos este mes — query separado en products (tiene created_at)
            supabase.from('products')
                .select('id', { count: 'exact' })
                .eq('activo', true)
                .gte('created_at', startOfMonth),
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

    // Reset página cuando cambian filtros
    useEffect(() => { setPage(1); }, [searchTerm, filterLab, filterRule, sortKey, sortDir]);

    // ── Productos paginados ───────────────────────────────────────────────────
    // newIds: Set de IDs de productos nuevos este mes (cargado en loadRules)
    const loadProducts = useCallback(async (pg, term, labId, ruleFilter, ruleIds, hiddenLabs, sk, sd, newIds) => {
        setLoadingProducts(true);
        const offset = (pg - 1) * PAGE_SIZE;

        // NOTA: products_with_lab NO incluye created_at — la vista solo expone id/nombre/lab/etc.
        let q = supabase
            .from('products_with_lab')
            .select('id, nombre, es_antibiotico, laboratorio_nombre, laboratorio_id', { count: 'exact' })
            .eq('activo', true)
            .range(offset, offset + PAGE_SIZE - 1);

        // Excluir labs ocultos en MinMax
        if (hiddenLabs.length > 0) {
            q = q.not('laboratorio_id', 'in', `(${hiddenLabs.join(',')})`);
        }

        // Sort server-side
        const asc = sd !== 'desc';
        q = q.order(sk, { ascending: asc });
        if (sk !== 'nombre') q = q.order('nombre', { ascending: true });

        // Búsqueda de texto
        if (term.length >= 2) q = q.ilike('nombre', `%${term}%`);

        // Filtro por laboratorio
        if (labId) q = q.eq('laboratorio_id', parseInt(labId));

        // Filtro regla / nuevo (server-side con IDs precargados)
        if (ruleFilter === 'con') {
            q = ruleIds.length > 0 ? q.in('id', ruleIds) : q.in('id', [0]);
        } else if (ruleFilter === 'sin' && ruleIds.length > 0) {
            q = q.not('id', 'in', `(${ruleIds.join(',')})`);
        } else if (ruleFilter === 'nuevo') {
            // newIds viene de la query products.created_at >= startOfMonth
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

    // ── Sort ──────────────────────────────────────────────────────────────────
    const handleSort = useCallback((key) => {
        setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortKey(key);
        setPage(1);
    }, [sortKey]);

    // ── Validación ────────────────────────────────────────────────────────────
    const validateVals = (v) => {
        const m = parseInt(v.multiplo), b = parseInt(v.blister);
        if (v.multiplo && !VALID_MULTIPLES.has(m))
            return `Múltiplo inválido (${m}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        if (v.blister && !VALID_MULTIPLES.has(b))
            return `Blíster inválido (${b}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        return null;
    };

    // ── Edit helpers ──────────────────────────────────────────────────────────
    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setEditVals({
            solo_cajas: rule?.solo_cajas ?? true,
            multiplo:   rule?.multiplo != null ? String(rule.multiplo) : '',
            blister:    rule?.blister  != null ? String(rule.blister)  : '',
            notes:      rule?.notes    ?? '',
        });
    }, []);

    const cancelEdit = useCallback(() => { setEditingId(null); setSaveError(null); }, []);

    const toggleEdit = useCallback((productId) => {
        if (editingId === productId) { cancelEdit(); return; }
        startEdit(productId, rulesMap[productId] ?? null);
    }, [editingId, rulesMap, startEdit, cancelEdit]);

    const handleSave = useCallback(async (productId) => {
        const err = validateVals(editVals);
        if (err) { setSaveError(err); return; }
        setSaving(true); setSaveError(null);
        const existing = rulesMap[productId];
        const payload  = {
            erp_product_id: productId,
            solo_cajas:     editVals.solo_cajas,
            multiplo:       editVals.multiplo ? parseInt(editVals.multiplo) : null,
            blister:        editVals.blister  ? parseInt(editVals.blister)  : null,
            notes:          editVals.notes    || null,
            updated_at:     new Date().toISOString(),
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

    // ── Computed ──────────────────────────────────────────────────────────────
    const rulesCount = Object.keys(rulesMap).length;
    const sinRegla   = Math.max(0, allCount - rulesCount);
    const mesActual  = new Date().toLocaleDateString('es-SV', { month: 'long' });

    const labOptions = useMemo(() =>
        labs.filter(l => !l.ocultar_en_minmax).map(l => ({ value: String(l.id), label: l.nombre })),
        [labs]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Row 1: stat cards (izq) + pill filtros (der) ──────────────── */}
            <div className="flex items-start gap-3 flex-wrap">

                {/* Stat cards */}
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">

                    {/* Total */}
                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[130px] bg-white/70 border-white/80 backdrop-blur-sm shadow-sm">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50">
                            {statsLoading
                                ? <Loader2 size={14} className="animate-spin text-slate-300" />
                                : <Package size={15} className="text-[#0052CC]" />
                            }
                        </div>
                        <div>
                            <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                                {statsLoading ? <span className="text-slate-200">–</span> : allCount.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-slate-600">Productos activos</div>
                        </div>
                    </div>

                    {/* Con regla */}
                    <StatCard
                        label="Con regla" value={rulesCount}
                        Icon={Check}
                        iconBg={filterRule === 'con' ? 'bg-white' : 'bg-emerald-50'}
                        iconCls="text-emerald-500"
                        countCls={rulesCount > 0 ? 'text-emerald-600' : 'text-slate-300'}
                        active={filterRule === 'con'}
                        activeBg="bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40"
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'con' ? '' : 'con')}
                    />

                    {/* Sin regla */}
                    <StatCard
                        label="Sin regla" value={sinRegla}
                        Icon={AlertTriangle}
                        iconBg={filterRule === 'sin' ? 'bg-white' : 'bg-red-50'}
                        iconCls="text-red-400"
                        countCls={sinRegla > 0 ? 'text-red-500' : 'text-slate-300'}
                        active={filterRule === 'sin'}
                        activeBg="bg-red-50 border-red-300 shadow-md shadow-red-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-red-200 hover:bg-red-50/40"
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'sin' ? '' : 'sin')}
                    />

                    {/* Nuevos este mes */}
                    <StatCard
                        label="Nuevos este mes"
                        sub={`agregados en ${mesActual}`}
                        value={thisMonthCount}
                        Icon={Sparkles}
                        iconBg={filterRule === 'nuevo' ? 'bg-white' : 'bg-emerald-50'}
                        iconCls="text-emerald-500"
                        countCls={thisMonthCount > 0 ? 'text-emerald-600' : 'text-slate-300'}
                        active={filterRule === 'nuevo'}
                        activeBg="bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px"
                        inactiveBg="bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40"
                        loading={statsLoading}
                        onClick={() => setFilterRule(f => f === 'nuevo' ? '' : 'nuevo')}
                    />
                </div>

                {/* Pill filtros derecha */}
                <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-sm">
                    <div style={{ minWidth: 210 }}>
                        <LiquidSelect
                            bare
                            compact
                            icon={FlaskConical}
                            placeholder="Todos los laboratorios"
                            options={labOptions}
                            value={filterLab}
                            onChange={v => { setFilterLab(v); setPage(1); }}
                            clearable
                        />
                    </div>
                    {(filterLab || filterRule) && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button
                                onClick={() => { setFilterLab(null); setFilterRule(''); }}
                                className="flex items-center gap-1 px-3 py-2 text-[11px] text-slate-400 hover:text-red-500 transition-colors whitespace-nowrap"
                            >
                                <X size={11} /> Limpiar
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Tabla ─────────────────────────────────────────────────────── */}
            <DataTable
                columns={COLS}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loadingProducts || loadingRules}
                skeletonRows={8}
                empty={{
                    icon: Package,
                    message: searchTerm.length >= 2
                        ? `Sin resultados para "${searchTerm}".`
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

                    return (
                        <React.Fragment key={prod.id}>
                            <DataRow
                                index={i}
                                onClick={() => toggleEdit(prod.id)}
                                className={isEditing ? 'bg-blue-50/60' : ''}
                            >
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
                                    {hasRule
                                        ? rule.solo_cajas
                                            ? <Check size={14} className="text-emerald-500 mx-auto" />
                                            : <X    size={14} className="text-slate-300 mx-auto" />
                                        : <span className="text-slate-200 text-[13px]">—</span>
                                    }
                                </DataCell>

                                <DataCell align="center" className="text-[13px] tabular-nums">
                                    {hasRule
                                        ? rule.multiplo ? `×${rule.multiplo}` : <span className="text-slate-300">—</span>
                                        : <span className="text-slate-200">—</span>
                                    }
                                </DataCell>

                                <DataCell align="center" className="text-[13px] tabular-nums">
                                    {hasRule
                                        ? rule.blister ? `×${rule.blister}` : <span className="text-slate-300">—</span>
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

                            {/* Panel edición inline */}
                            {isEditing && (
                                <tr className={`${EXPAND_BG} border-b ${EXPAND_BORDER}`}>
                                    <td colSpan={COLS.length} className="px-5 py-4">
                                        <EditPanel
                                            product={prod}
                                            rule={rule}
                                            vals={editVals}
                                            setVals={setEditVals}
                                            saving={saving}
                                            saveError={saveError}
                                            onSave={() => handleSave(prod.id)}
                                            onCancel={cancelEdit}
                                            onDelete={() => handleDelete(prod.id)}
                                        />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>

            {/* ── Paginación ────────────────────────────────────────────────── */}
            <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={totalCount}
                onPageChange={setPage}
                onPageSizeChange={() => {}}
            />

            {/* ── Confirm eliminar regla ────────────────────────────────────── */}
            <ConfirmModal
                isOpen={!!confirmDel}
                onClose={() => setConfirmDel(null)}
                onConfirm={doDelete}
                title="Eliminar regla"
                message={`¿Eliminar la regla de "${confirmDel?.nombre}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                isDestructive
                isProcessing={deleting}
            />
        </div>
    );
}
