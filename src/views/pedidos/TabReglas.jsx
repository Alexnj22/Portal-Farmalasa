import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Search, Check, X, Plus, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const EMPTY_VALS = { solo_cajas: false, multiplo: '', blister: '', notes: '' };

export default function TabReglas() {
    // ── Rules (loaded once, kept in a map for O(1) lookup) ───────────────────
    const [rulesMap, setRulesMap]         = useState({});  // product_id → rule row
    const [loadingRules, setLoadingRules] = useState(true);

    // ── Product search ────────────────────────────────────────────────────────
    const [search, setSearch]             = useState('');
    const [searching, setSearching]       = useState(false);
    const [searchResults, setSearchResults] = useState(null); // null = not searched

    // ── Inline edit ───────────────────────────────────────────────────────────
    const [editingId, setEditingId]   = useState(null);   // erp_product_id
    const [editVals, setEditVals]     = useState(EMPTY_VALS);
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState(null);

    const searchTimer = useRef(null);

    // Load all existing rules → build rulesMap
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        const { data } = await supabase
            .from('dispatch_rules')
            .select('id, erp_product_id, solo_cajas, multiplo, blister, notes, products(nombre)')
            .range(0, 9999);
        const map = {};
        for (const r of (data || [])) map[r.erp_product_id] = r;
        setRulesMap(map);
        setLoadingRules(false);
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);

    // Debounced product search (≥ 2 chars)
    const handleSearchChange = useCallback((q) => {
        setSearch(q);
        clearTimeout(searchTimer.current);
        if (q.length < 2) {
            setSearchResults(null);
            return;
        }
        searchTimer.current = setTimeout(async () => {
            setSearching(true);
            const { data } = await supabase
                .from('products')
                .select('id, nombre')
                .ilike('nombre', `%${q}%`)
                .order('nombre')
                .range(0, 49);
            setSearchResults(data || []);
            setSearching(false);
        }, 280);
    }, []);

    // Rows to render
    // • No search → products that already have rules (fast, sorted)
    // • Search active → products from query merged with rulesMap
    const displayRows = useMemo(() => {
        if (searchResults !== null) {
            return searchResults.map(p => ({
                product_id:   p.id,
                product_name: p.nombre,
                rule:         rulesMap[p.id] ?? null,
            }));
        }
        return Object.values(rulesMap)
            .map(r => ({
                product_id:   r.erp_product_id,
                product_name: r.products?.nombre ?? `Producto ${r.erp_product_id}`,
                rule:         r,
            }))
            .sort((a, b) => a.product_name.localeCompare(b.product_name));
    }, [searchResults, rulesMap]);

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

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setSaveError(null);
    }, []);

    const handleSave = useCallback(async (productId) => {
        setSaving(true);
        setSaveError(null);
        const existing = rulesMap[productId];
        const payload = {
            erp_product_id: productId,
            solo_cajas:     editVals.solo_cajas,
            multiplo:       editVals.multiplo ? parseInt(editVals.multiplo) : null,
            blister:        editVals.blister  ? parseInt(editVals.blister)  : null,
            notes:          editVals.notes    || null,
            updated_at:     new Date().toISOString(),
        };
        try {
            if (existing) {
                const { error } = await supabase
                    .from('dispatch_rules').update(payload).eq('id', existing.id);
                if (error) throw error;
                useStaff.getState().appendAuditLog('EDITAR_REGLA_DESPACHO', String(existing.id), payload);
            } else {
                const { error } = await supabase
                    .from('dispatch_rules').insert(payload);
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

    const handleDelete = useCallback(async (rule) => {
        if (!window.confirm(`¿Eliminar la regla de "${rule.products?.nombre ?? 'este producto'}"?`)) return;
        const { error } = await supabase.from('dispatch_rules').delete().eq('id', rule.id);
        if (!error) {
            useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(rule.id), {});
            setEditingId(null);
            loadRules();
        }
    }, [loadRules]);

    const rulesCount = Object.keys(rulesMap).length;

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4 p-4">

            {/* Search bar */}
            <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Busca cualquier producto para ver o asignar su regla de despacho…"
                            value={search}
                            onChange={e => handleSearchChange(e.target.value)}
                            className="w-full pl-8 pr-10 py-2.5 border border-slate-200 rounded-xl text-[13px] bg-white/80 focus:outline-none focus:border-blue-400"
                        />
                        {searching && (
                            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
                        )}
                        {search && !searching && (
                            <button
                                onClick={() => { setSearch(''); setSearchResults(null); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    {!loadingRules && (
                        <span className="shrink-0 text-[12px] text-slate-400">
                            {rulesCount} {rulesCount === 1 ? 'regla' : 'reglas'} configuradas
                        </span>
                    )}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                    {search.length === 0
                        ? 'Mostrando productos con reglas. Escribe para buscar cualquier producto del catálogo.'
                        : search.length === 1
                        ? 'Escribe al menos 2 caracteres para buscar…'
                        : searchResults !== null
                        ? `${searchResults.length} resultado${searchResults.length !== 1 ? 's' : ''} para "${search}"`
                        : ''
                    }
                </p>
            </div>

            {/* Table */}
            {loadingRules ? (
                <div className="flex items-center justify-center py-14 gap-2 text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-[14px]">Cargando reglas…</span>
                </div>
            ) : displayRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm p-12 text-center text-slate-400">
                    {search.length >= 2
                        ? <p className="text-[14px]">No se encontraron productos para "<strong>{search}</strong>".</p>
                        : <>
                            <p className="text-[14px] font-medium mb-1">Sin reglas configuradas todavía.</p>
                            <p className="text-[12px]">Busca un producto arriba para asignarle su primera regla.</p>
                          </>
                    }
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] overflow-hidden">
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="text-[11px] text-slate-400 uppercase tracking-wide bg-slate-50/70 border-b border-slate-100">
                                <th className="text-left px-4 py-2.5 font-medium">Producto</th>
                                <th className="text-center px-3 py-2.5 font-medium">Estado</th>
                                <th className="text-center px-3 py-2.5 font-medium">Solo cajas</th>
                                <th className="text-center px-3 py-2.5 font-medium">Múltiplo</th>
                                <th className="text-center px-3 py-2.5 font-medium">Blíster</th>
                                <th className="text-left px-3 py-2.5 font-medium">Notas</th>
                                <th className="w-28 px-3 py-2.5" />
                            </tr>
                        </thead>
                        <tbody>
                            {displayRows.map(row => {
                                const isEditing = editingId === row.product_id;
                                const hasRule   = !!row.rule;

                                return (
                                    <React.Fragment key={row.product_id}>
                                        {/* ── Read row ── */}
                                        <tr className={`border-t border-slate-50 transition-colors ${
                                            isEditing
                                                ? 'bg-blue-50/50'
                                                : hasRule
                                                ? 'hover:bg-blue-50/20'
                                                : 'hover:bg-slate-50/60 opacity-70 hover:opacity-100'
                                        }`}>
                                            <td className="px-4 py-3 font-medium text-slate-700 max-w-[220px]">
                                                <span className="block truncate">{row.product_name}</span>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                {hasRule ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium">
                                                        <Check size={9} /> Con regla
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-medium">
                                                        Sin regla
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                {hasRule
                                                    ? row.rule.solo_cajas
                                                        ? <Check size={14} className="text-emerald-500 mx-auto" />
                                                        : <X size={14} className="text-slate-300 mx-auto" />
                                                    : <span className="text-slate-300 text-[12px]">—</span>
                                                }
                                            </td>
                                            <td className="px-3 py-3 text-center text-slate-600">
                                                {hasRule
                                                    ? (row.rule.multiplo ? `×${row.rule.multiplo}` : '—')
                                                    : <span className="text-slate-300 text-[12px]">—</span>
                                                }
                                            </td>
                                            <td className="px-3 py-3 text-center text-slate-600">
                                                {hasRule
                                                    ? (row.rule.blister ? `×${row.rule.blister}` : '—')
                                                    : <span className="text-slate-300 text-[12px]">—</span>
                                                }
                                            </td>
                                            <td className="px-3 py-3 text-slate-400 italic text-[12px] max-w-[140px]">
                                                {hasRule
                                                    ? (row.rule.notes || '—')
                                                    : <span className="text-slate-300">—</span>
                                                }
                                            </td>
                                            <td className="px-3 py-3">
                                                <div className="flex items-center gap-1 justify-end">
                                                    {isEditing ? (
                                                        <button
                                                            onClick={cancelEdit}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                                            title="Cancelar"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => startEdit(row.product_id, row.rule)}
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
                                                                <button
                                                                    onClick={() => handleDelete(row.rule)}
                                                                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                                    title="Eliminar regla"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* ── Inline edit form row ── */}
                                        {isEditing && (
                                            <tr className="bg-blue-50/70 border-t border-blue-100">
                                                <td colSpan={7} className="px-4 py-4">
                                                    <div className="flex flex-wrap items-end gap-4">

                                                        {/* Solo cajas */}
                                                        <label className="flex items-center gap-2 cursor-pointer select-none min-w-[130px]">
                                                            <input
                                                                type="checkbox"
                                                                checked={editVals.solo_cajas}
                                                                onChange={e => setEditVals(p => ({ ...p, solo_cajas: e.target.checked }))}
                                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                            />
                                                            <span className="text-[13px] text-slate-700 font-medium">Solo cajas completas</span>
                                                        </label>

                                                        {/* Múltiplo */}
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Múltiplo de N packs</p>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                placeholder="Ej: 6"
                                                                value={editVals.multiplo}
                                                                onChange={e => setEditVals(p => ({ ...p, multiplo: e.target.value }))}
                                                                className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                            />
                                                        </div>

                                                        {/* Blíster */}
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Múltiplo de N blísters</p>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                placeholder="Ej: 10"
                                                                value={editVals.blister}
                                                                onChange={e => setEditVals(p => ({ ...p, blister: e.target.value }))}
                                                                className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                            />
                                                        </div>

                                                        {/* Notas */}
                                                        <div className="flex-1 min-w-[160px]">
                                                            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Notas</p>
                                                            <input
                                                                type="text"
                                                                placeholder="Observación interna…"
                                                                value={editVals.notes}
                                                                onChange={e => setEditVals(p => ({ ...p, notes: e.target.value }))}
                                                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400 bg-white"
                                                            />
                                                        </div>

                                                        {/* Actions */}
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {saveError && (
                                                                <span className="text-[11px] text-red-600 flex items-center gap-1 max-w-[180px]">
                                                                    <AlertTriangle size={11} className="shrink-0" />
                                                                    {saveError}
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={cancelEdit}
                                                                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-[12px] transition-colors"
                                                            >
                                                                Cancelar
                                                            </button>
                                                            <button
                                                                onClick={() => handleSave(row.product_id)}
                                                                disabled={saving}
                                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                                            >
                                                                {saving
                                                                    ? <Loader2 size={12} className="animate-spin" />
                                                                    : <Check size={12} />
                                                                }
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
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
