import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Check, X, Trash2, AlertTriangle,
    ChevronLeft, ChevronRight, FlaskConical, Package,
    Filter, Sparkles, CheckSquare, Square, SlidersHorizontal,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable } from '../../components/common/DataTable';
import ConfirmModal from '../../components/common/ConfirmModal';

const PAGE_SIZE       = 50;
const NEW_DAYS        = 30;
// solo_cajas true por defecto para nuevas reglas
const EMPTY_VALS      = { solo_cajas: true, multiplo: '', blister: '', notes: '' };
const GLASS           = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';
const VALID_MULTIPLES = new Set([2, 3, 4, 5, 6, 10, 12, 20, 24, 25, 50]);
const MULTIPLO_PILLS  = [2, 3, 6, 10, 12, 20, 24, 50];

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

const isNewProduct = (prod) =>
    prod.created_at &&
    new Date(prod.created_at) > new Date(Date.now() - NEW_DAYS * 24 * 60 * 60 * 1000);

// ── Stat card clickable ──────────────────────────────────────────────────────
function InfoCard({ label, value, color = 'slate', onClick, active }) {
    const base = {
        slate:   'bg-white/90     border-slate-200   text-slate-700',
        emerald: 'bg-emerald-50   border-emerald-200 text-emerald-700',
        amber:   'bg-amber-50     border-amber-200   text-amber-700',
        red:     'bg-red-50       border-red-200     text-red-600',
        blue:    'bg-blue-50      border-blue-200    text-blue-700',
    }[color] ?? 'bg-white/90 border-slate-200 text-slate-700';
    return (
        <button
            onClick={onClick}
            className={`rounded-xl border px-4 py-2.5 flex flex-col items-center min-w-[74px] transition-all ${base} ${
                active ? 'ring-2 ring-offset-1 ring-blue-400 shadow-sm' : onClick ? 'hover:shadow-sm hover:scale-[1.02]' : ''
            }`}
        >
            <span className="text-[20px] font-black tabular-nums leading-none">{value ?? '—'}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide mt-0.5 opacity-70 whitespace-nowrap">{label}</span>
        </button>
    );
}

// ── Panel de edición rediseñado ──────────────────────────────────────────────
function EditPanel({ product, rule, vals, setVals, saving, saveError, onSave, onCancel, onDelete }) {
    const hasRule = !!rule;
    return (
        <div className="space-y-3">
            {/* Header */}
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

            {/* Controls */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

                {/* Solo cajas — toggle prominente */}
                <button
                    type="button"
                    onClick={() => setVals(p => ({ ...p, solo_cajas: !p.solo_cajas }))}
                    className={`col-span-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border-2 font-semibold transition-all select-none ${
                        vals.solo_cajas
                            ? 'bg-slate-800 border-slate-700 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}
                >
                    {vals.solo_cajas
                        ? <CheckSquare size={18} />
                        : <Square size={18} />
                    }
                    <span className="text-[11px] text-center leading-tight">Solo cajas<br/>completas</span>
                </button>

                {/* Múltiplo packs */}
                <div className="col-span-1">
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
                    <input type="number" min={1} placeholder="Otro…"
                        value={vals.multiplo}
                        onChange={e => setVals(p => ({ ...p, multiplo: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white"
                    />
                </div>

                {/* Múltiplo blíster */}
                <div className="col-span-1">
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
                    <input type="number" min={1} placeholder="Otro…"
                        value={vals.blister}
                        onChange={e => setVals(p => ({ ...p, blister: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-indigo-400 bg-white"
                    />
                </div>

                {/* Notas */}
                <div className="col-span-1">
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Notas internas</p>
                    <div className="h-[26px] mb-1.5" />
                    <input type="text" placeholder="Observación…"
                        value={vals.notes}
                        onChange={e => setVals(p => ({ ...p, notes: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 bg-white"
                    />
                </div>
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
                        <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[200px]">
                            <AlertTriangle size={10} className="shrink-0" /> {saveError}
                        </span>
                    )}
                    <button onClick={onCancel}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-[12px] transition-colors">
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

// ── Main component ───────────────────────────────────────────────────────────
export default function TabReglas({ searchTerm = '' }) {
    const [rulesMap,          setRulesMap]          = useState({});
    const [loadingRules,      setLoadingRules]      = useState(true);
    const [products,          setProducts]          = useState([]);
    const [totalCount,        setTotalCount]        = useState(0);
    const [allProductsCount,  setAllProductsCount]  = useState(0);
    const [newCount,          setNewCount]          = useState(0);
    const [loadingProducts,   setLoadingProducts]   = useState(true);
    const [page,              setPage]              = useState(0);
    const [sortKey,           setSortKey]           = useState('laboratorio_nombre');
    const [sortDir,           setSortDir]           = useState('asc');
    const [labs,              setLabs]              = useState([]);
    const [filterLab,         setFilterLab]         = useState('');
    const [filterRule,        setFilterRule]        = useState('');
    const [editingId,         setEditingId]         = useState(null);
    const [editVals,          setEditVals]          = useState(EMPTY_VALS);
    const [saving,            setSaving]            = useState(false);
    const [saveError,         setSaveError]         = useState(null);
    const [confirmDel,        setConfirmDel]        = useState(null);
    const [deleting,          setDeleting]          = useState(false);

    // Labs dropdown
    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
    }, []);

    // Reset page when filters change
    useEffect(() => { setPage(0); }, [searchTerm, filterLab, filterRule, sortKey, sortDir]);

    // ── Cargar todas las reglas (una vez) ─────────────────────────────────────
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        const [rulesRes, totalRes, newRes] = await Promise.all([
            supabase.from('dispatch_rules')
                .select('id, erp_product_id, solo_cajas, multiplo, blister, notes')
                .range(0, 9999),
            supabase.from('products_with_lab')
                .select('id', { count: 'exact', head: true })
                .eq('activo', true),
            supabase.from('products_with_lab')
                .select('id', { count: 'exact', head: true })
                .eq('activo', true)
                .gte('created_at', new Date(Date.now() - NEW_DAYS * 24 * 60 * 60 * 1000).toISOString()),
        ]);
        const map = {};
        for (const r of (rulesRes.data || [])) map[r.erp_product_id] = r;
        setRulesMap(map);
        setAllProductsCount(totalRes.count ?? 0);
        setNewCount(newRes.count ?? 0);
        setLoadingRules(false);
    }, []);

    // ── Cargar productos paginados (server-side filter + sort) ────────────────
    const loadProducts = useCallback(async (currentPage, term, labId, ruleFilter, ruleIds, sk, sd) => {
        setLoadingProducts(true);
        const offset = currentPage * PAGE_SIZE;
        let q = supabase
            .from('products_with_lab')
            .select('id, nombre, es_antibiotico, laboratorio_nombre, laboratorio_id, created_at', { count: 'exact' })
            .eq('activo', true)
            .range(offset, offset + PAGE_SIZE - 1);

        // Sort
        const asc = sd !== 'desc';
        q = q.order(sk, { ascending: asc });
        if (sk !== 'nombre') q = q.order('nombre', { ascending: true });

        // Text search
        if (term.length >= 2) q = q.ilike('nombre', `%${term}%`);

        // Lab filter
        if (labId) q = q.eq('laboratorio_id', parseInt(labId));

        // Rule filter — server side
        if (ruleFilter === 'con') {
            q = ruleIds.length > 0 ? q.in('id', ruleIds) : q.in('id', [0]);
        } else if (ruleFilter === 'sin' && ruleIds.length > 0) {
            q = q.not('id', 'in', `(${ruleIds.join(',')})`);
        } else if (ruleFilter === 'nuevo') {
            q = q.gte('created_at', new Date(Date.now() - NEW_DAYS * 24 * 60 * 60 * 1000).toISOString());
        }

        const { data, count } = await q;
        setProducts(data || []);
        setTotalCount(count ?? 0);
        setLoadingProducts(false);
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);

    useEffect(() => {
        if (loadingRules) return;
        const ids = Object.keys(rulesMap).map(Number);
        loadProducts(page, searchTerm, filterLab, filterRule, ids, sortKey, sortDir);
    }, [page, searchTerm, filterLab, filterRule, rulesMap, loadProducts, loadingRules, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sort handler ──────────────────────────────────────────────────────────
    const handleSort = useCallback((key) => {
        setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortKey(key);
        setPage(0);
    }, [sortKey]);

    // ── Validation ────────────────────────────────────────────────────────────
    const validateVals = (vals) => {
        const m = parseInt(vals.multiplo);
        const b = parseInt(vals.blister);
        if (vals.multiplo && !VALID_MULTIPLES.has(m))
            return `Múltiplo inválido (${m}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        if (vals.blister && !VALID_MULTIPLES.has(b))
            return `Blíster inválido (${b}). Válidos: ${[...VALID_MULTIPLES].join(', ')}`;
        return null;
    };

    // ── Edit helpers ──────────────────────────────────────────────────────────
    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setEditVals({
            solo_cajas: rule?.solo_cajas ?? true,   // defecto: solo cajas
            multiplo:   rule?.multiplo != null ? String(rule.multiplo) : '',
            blister:    rule?.blister  != null ? String(rule.blister)  : '',
            notes:      rule?.notes    ?? '',
        });
    }, []);

    const cancelEdit = useCallback(() => { setEditingId(null); setSaveError(null); }, []);

    const toggleEdit = useCallback((productId) => {
        if (editingId === productId) { cancelEdit(); return; }
        const rule = rulesMap[productId] ?? null;
        startEdit(productId, rule);
    }, [editingId, rulesMap, startEdit, cancelEdit]);

    const handleSave = useCallback(async (productId) => {
        const valErr = validateVals(editVals);
        if (valErr) { setSaveError(valErr); return; }
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

    const totalPages  = Math.ceil(totalCount / PAGE_SIZE);
    const rulesCount  = Object.keys(rulesMap).length;
    const sinRegla    = Math.max(0, allProductsCount - rulesCount);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4 p-4">

            {/* ── Header: cards izq + filtros der ────────────────────────── */}
            <div className="flex flex-wrap items-start gap-3">

                {/* Stat cards */}
                <div className="flex flex-wrap gap-2">
                    <InfoCard label="Productos"  value={allProductsCount.toLocaleString()} color="slate" />
                    <InfoCard label="Con regla"  value={rulesCount.toLocaleString()}  color="emerald"
                        onClick={() => setFilterRule(f => f === 'con' ? '' : 'con')}
                        active={filterRule === 'con'} />
                    <InfoCard label="Sin regla"  value={sinRegla.toLocaleString()}    color="red"
                        onClick={() => setFilterRule(f => f === 'sin' ? '' : 'sin')}
                        active={filterRule === 'sin'} />
                    {newCount > 0 && (
                        <InfoCard
                            label={`Nuevos ${NEW_DAYS}d`}
                            value={newCount}
                            color="amber"
                            onClick={() => setFilterRule(f => f === 'nuevo' ? '' : 'nuevo')}
                            active={filterRule === 'nuevo'}
                        />
                    )}
                </div>

                {/* Filter pill */}
                <div className={`${GLASS} ml-auto flex flex-wrap items-center gap-2 px-4 py-2.5`}>
                    <Filter size={12} className="text-slate-400 shrink-0" />
                    <select
                        value={filterLab}
                        onChange={e => { setFilterLab(e.target.value); setPage(0); }}
                        className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors min-w-[160px]"
                    >
                        <option value="">Todos los laboratorios</option>
                        {labs.map(l => <option key={l.id} value={String(l.id)}>{l.nombre}</option>)}
                    </select>
                    <div className="w-px h-5 bg-slate-200 shrink-0" />
                    <span className="text-[11px] text-slate-400 tabular-nums">
                        {loadingProducts ? '…' : totalCount.toLocaleString()} productos
                    </span>
                    {(filterLab || filterRule) && (
                        <button
                            onClick={() => { setFilterLab(''); setFilterRule(''); }}
                            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                        >
                            <X size={11} /> Limpiar
                        </button>
                    )}
                </div>
            </div>

            {/* ── Aviso filtro activo ─────────────────────────────────────── */}
            {filterRule === 'nuevo' && newCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-[12px]">
                    <Sparkles size={13} />
                    <span>Mostrando <b>{totalCount}</b> producto{totalCount !== 1 ? 's' : ''} añadidos en los últimos {NEW_DAYS} días — verificá si necesitan regla de despacho.</span>
                </div>
            )}

            {/* ── Tabla ──────────────────────────────────────────────────── */}
            <DataTable
                columns={COLS}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loadingProducts || loadingRules}
                empty={{
                    icon: Package,
                    message: searchTerm.length >= 2
                        ? `No se encontraron productos para "${searchTerm}".`
                        : filterRule === 'con'  ? 'No hay productos con regla asignada.'
                        : filterRule === 'sin'  ? 'Todos los productos tienen regla asignada.'
                        : filterRule === 'nuevo'? `Sin productos nuevos en los últimos ${NEW_DAYS} días.`
                        : 'Sin productos en catálogo.',
                }}
                minWidth="700px"
            >
                {products.map((prod, i) => {
                    const isEditing = editingId === prod.id;
                    const rule      = rulesMap[prod.id] ?? null;
                    const hasRule   = !!rule;
                    const isNew     = isNewProduct(prod);

                    return (
                        <React.Fragment key={prod.id}>
                            {/* ── Fila producto ─────────────────────────── */}
                            <tr
                                onClick={() => toggleEdit(prod.id)}
                                className={`border-t border-[#0052CC]/[0.06] cursor-pointer transition-colors select-none ${
                                    isEditing
                                        ? 'bg-blue-50/70'
                                        : `${i % 2 !== 0 ? 'bg-[#0052CC]/[0.015]' : ''} hover:bg-[#0052CC]/[0.035]`
                                }`}
                            >
                                <td className="px-4 py-2.5 text-slate-400 text-[12px] max-w-[160px]">
                                    <span className="block truncate">{prod.laboratorio_nombre ?? '—'}</span>
                                </td>
                                <td className="px-4 py-2.5 max-w-[240px]">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-slate-700 text-[13px]">{prod.nombre}</span>
                                        {isNew && (
                                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-bold uppercase tracking-wide flex-shrink-0">
                                                <Sparkles size={8} /> Nuevo
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                    {prod.es_antibiotico && (
                                        <span title="Antibiótico" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 border border-violet-200">
                                            <FlaskConical size={10} className="text-violet-600" />
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                    {hasRule ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium">
                                            <Check size={9} /> Con regla
                                        </span>
                                    ) : (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200 font-medium">
                                            Sin regla
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                    {hasRule
                                        ? rule.solo_cajas
                                            ? <Check size={14} className="text-emerald-500 mx-auto" />
                                            : <X size={14} className="text-slate-300 mx-auto" />
                                        : <span className="text-slate-200 text-[13px]">—</span>
                                    }
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-600 text-[13px] tabular-nums">
                                    {hasRule ? (rule.multiplo ? `×${rule.multiplo}` : <span className="text-slate-300">—</span>) : <span className="text-slate-200">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-600 text-[13px] tabular-nums">
                                    {hasRule ? (rule.blister ? `×${rule.blister}` : <span className="text-slate-300">—</span>) : <span className="text-slate-200">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-slate-400 italic text-[12px] max-w-[140px]">
                                    {hasRule ? (
                                        <span className="block truncate">{rule.notes || <span className="text-slate-200 not-italic">—</span>}</span>
                                    ) : <span className="text-slate-200">—</span>}
                                </td>
                            </tr>

                            {/* ── Panel de edición ──────────────────────── */}
                            {isEditing && (
                                <tr className="bg-blue-50/50 border-b border-blue-100/80">
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

            {/* ── Paginación ──────────────────────────────────────────────── */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-1">
                    <span className="text-[12px] text-slate-400">
                        Página {page + 1} de {totalPages} · {totalCount.toLocaleString()} productos
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0 || loadingProducts}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
                        >
                            <ChevronLeft size={13} /> Anterior
                        </button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                            const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                            const p     = start + i;
                            return (
                                <button key={p} onClick={() => setPage(p)}
                                    className={`w-8 h-8 rounded-lg text-[12px] font-medium transition-colors ${
                                        p === page ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                                    }`}>
                                    {p + 1}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1 || loadingProducts}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
                        >
                            Siguiente <ChevronRight size={13} />
                        </button>
                    </div>
                </div>
            )}

            {/* ── Confirm eliminar regla ──────────────────────────────────── */}
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
