import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Check, X, Plus, Pencil, Trash2,
    AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Package,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow } from '../../components/common/DataTable';

const PAGE_SIZE  = 50;
const EMPTY_VALS = { solo_cajas: false, multiplo: '', blister: '', notes: '' };
const GLASS      = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const COLS = [
    { key: 'lab',      label: 'Laboratorio', align: 'left'   },
    { key: 'producto', label: 'Producto',     align: 'left'   },
    { key: 'ab',       label: 'AB',           align: 'center', className: 'w-12' },
    { key: 'estado',   label: 'Estado',       align: 'center' },
    { key: 'cajas',    label: 'Solo cajas',   align: 'center' },
    { key: 'multiplo', label: 'Múltiplo',     align: 'center' },
    { key: 'blister',  label: 'Blíster',      align: 'center' },
    { key: 'notas',    label: 'Notas',        align: 'left'   },
    { key: '_',        label: '',             align: 'right',  className: 'w-28' },
];

export default function TabReglas({ searchTerm = '' }) {
    // Rules — loaded once, O(1) lookup
    const [rulesMap, setRulesMap]         = useState({});
    const [loadingRules, setLoadingRules] = useState(true);

    // Products — paginated from products_with_lab view
    const [products, setProducts]               = useState([]);
    const [totalCount, setTotalCount]           = useState(0);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [page, setPage]                       = useState(0);

    // Inline edit
    const [editingId, setEditingId]   = useState(null);
    const [editVals, setEditVals]     = useState(EMPTY_VALS);
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState(null);

    // Reset to page 0 when search changes
    useEffect(() => { setPage(0); }, [searchTerm]);

    // ── Load all rules once ───────────────────────────────────────────────────
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        const { data } = await supabase
            .from('dispatch_rules')
            .select('id, erp_product_id, solo_cajas, multiplo, blister, notes')
            .range(0, 9999);
        const map = {};
        for (const r of (data || [])) map[r.erp_product_id] = r;
        setRulesMap(map);
        setLoadingRules(false);
    }, []);

    // ── Load products paginated from view ─────────────────────────────────────
    const loadProducts = useCallback(async (currentPage, term) => {
        setLoadingProducts(true);
        const offset = currentPage * PAGE_SIZE;
        let q = supabase
            .from('products_with_lab')
            .select('id, nombre, es_antibiotico, laboratorio_nombre', { count: 'exact' })
            .eq('activo', true)
            .order('laboratorio_nombre', { ascending: true })
            .order('nombre', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
        if (term.length >= 2) q = q.ilike('nombre', `%${term}%`);
        const { data, count } = await q;
        setProducts(data || []);
        setTotalCount(count ?? 0);
        setLoadingProducts(false);
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);
    useEffect(() => { loadProducts(page, searchTerm); }, [page, searchTerm, loadProducts]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    // ── Edit helpers ──────────────────────────────────────────────────────────
    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setEditVals({
            solo_cajas: rule?.solo_cajas ?? false,
            multiplo:   rule?.multiplo   ?? '',
            blister:    rule?.blister    ?? '',
            notes:      rule?.notes      ?? '',
        });
    }, []);

    const cancelEdit = useCallback(() => { setEditingId(null); setSaveError(null); }, []);

    const handleSave = useCallback(async (productId) => {
        setSaving(true);
        setSaveError(null);
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

    const handleDelete = useCallback(async (productId) => {
        const rule = rulesMap[productId];
        if (!rule) return;
        const product = products.find(p => p.id === productId);
        if (!window.confirm(`¿Eliminar la regla de "${product?.nombre ?? 'este producto'}"?`)) return;
        const { error } = await supabase.from('dispatch_rules').delete().eq('id', rule.id);
        if (!error) {
            useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(rule.id), {});
            setEditingId(null);
            await loadRules();
        }
    }, [rulesMap, products, loadRules]);

    const rulesCount = Object.keys(rulesMap).length;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4 p-4">

            {/* Stats bar */}
            <div className={`${GLASS} px-4 py-2.5 flex items-center justify-between`}>
                <p className="text-[12px] text-slate-500">
                    {searchTerm.length >= 2
                        ? `${totalCount} resultado${totalCount !== 1 ? 's' : ''} para "${searchTerm}"`
                        : `${totalCount.toLocaleString()} productos en catálogo · ordenados por laboratorio`
                    }
                </p>
                {!loadingRules && (
                    <span className="text-[12px] text-slate-400">
                        {rulesCount} {rulesCount === 1 ? 'regla' : 'reglas'} configuradas
                    </span>
                )}
            </div>

            {/* Table */}
            <DataTable
                columns={COLS}
                loading={loadingProducts || loadingRules}
                empty={{
                    icon: Package,
                    message: searchTerm.length >= 2
                        ? `No se encontraron productos para "${searchTerm}".`
                        : 'Sin productos en catálogo.',
                }}
                minWidth="700px"
            >
                {products.map((prod, i) => {
                    const isEditing = editingId === prod.id;
                    const rule      = rulesMap[prod.id] ?? null;
                    const hasRule   = !!rule;

                    return (
                        <React.Fragment key={prod.id}>
                            <DataRow index={i} className={isEditing ? 'bg-blue-50/50' : ''}>
                                <td className="px-4 py-2.5 text-slate-400 text-[12px] max-w-[140px]">
                                    <span className="block truncate">{prod.laboratorio_nombre ?? '—'}</span>
                                </td>
                                <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[240px]">
                                    <span className="block truncate">{prod.nombre}</span>
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
                                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200 font-medium">
                                            Sin regla
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                    {hasRule
                                        ? rule.solo_cajas
                                            ? <Check size={14} className="text-emerald-500 mx-auto" />
                                            : <X size={14} className="text-slate-300 mx-auto" />
                                        : <span className="text-slate-300">—</span>
                                    }
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-600">
                                    {hasRule ? (rule.multiplo ? `×${rule.multiplo}` : '—') : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-600">
                                    {hasRule ? (rule.blister ? `×${rule.blister}` : '—') : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-slate-400 italic text-[12px] max-w-[140px]">
                                    {hasRule ? (rule.notes || '—') : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1 justify-end">
                                        {isEditing ? (
                                            <button onClick={cancelEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Cancelar">
                                                <X size={14} />
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => startEdit(prod.id, rule)}
                                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                                                        hasRule
                                                            ? 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'
                                                            : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                                                    }`}
                                                >
                                                    {hasRule ? <Pencil size={11} /> : <Plus size={11} />}
                                                    {hasRule ? 'Editar' : 'Asignar'}
                                                </button>
                                                {hasRule && (
                                                    <button onClick={() => handleDelete(prod.id)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors" title="Eliminar regla">
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </td>
                            </DataRow>

                            {isEditing && (
                                <tr className="bg-blue-50/70">
                                    <td colSpan={9} className="px-4 py-4">
                                        <div className="flex flex-wrap items-end gap-4">
                                            <label className="flex items-center gap-2 cursor-pointer select-none min-w-[140px]">
                                                <input
                                                    type="checkbox"
                                                    checked={editVals.solo_cajas}
                                                    onChange={e => setEditVals(p => ({ ...p, solo_cajas: e.target.checked }))}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span className="text-[13px] text-slate-700 font-medium">Solo cajas completas</span>
                                            </label>
                                            <div>
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Múltiplo de N packs</p>
                                                <input
                                                    type="number" min={1} placeholder="Ej: 6"
                                                    value={editVals.multiplo}
                                                    onChange={e => setEditVals(p => ({ ...p, multiplo: e.target.value }))}
                                                    className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                />
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Múltiplo de N blísters</p>
                                                <input
                                                    type="number" min={1} placeholder="Ej: 10"
                                                    value={editVals.blister}
                                                    onChange={e => setEditVals(p => ({ ...p, blister: e.target.value }))}
                                                    className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-[160px]">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Notas</p>
                                                <input
                                                    type="text" placeholder="Observación interna…"
                                                    value={editVals.notes}
                                                    onChange={e => setEditVals(p => ({ ...p, notes: e.target.value }))}
                                                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {saveError && (
                                                    <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[180px]">
                                                        <AlertTriangle size={11} className="shrink-0" />
                                                        {saveError}
                                                    </span>
                                                )}
                                                <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-[12px] transition-colors">
                                                    Cancelar
                                                </button>
                                                <button
                                                    onClick={() => handleSave(prod.id)}
                                                    disabled={saving}
                                                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                                >
                                                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                    {hasRule ? 'Actualizar' : 'Crear regla'}
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>

            {/* Pagination */}
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
                        {/* Page number pills — show up to 5 */}
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                            const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                            const p     = start + i;
                            return (
                                <button
                                    key={p}
                                    onClick={() => setPage(p)}
                                    className={`w-8 h-8 rounded-lg text-[12px] font-medium transition-colors ${
                                        p === page
                                            ? 'bg-blue-600 text-white'
                                            : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                                >
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
        </div>
    );
}
