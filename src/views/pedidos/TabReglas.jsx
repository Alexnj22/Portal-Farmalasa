import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Search, Check, X, Plus, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

export default function TabReglas() {
    const [rules, setRules]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [search, setSearch]     = useState('');
    const [editing, setEditing]   = useState(null);  // {id?, erp_product_id, solo_cajas, multiplo, blister, notes, product_name}
    const [saving, setSaving]     = useState(false);
    const [error, setError]       = useState(null);

    // Product search for adding new rule
    const [productSearch, setProductSearch] = useState('');
    const [productResults, setProductResults] = useState([]);
    const [searchingProduct, setSearchingProduct] = useState(false);
    const [showAddPanel, setShowAddPanel] = useState(false);

    const loadRules = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('dispatch_rules')
            .select('id, erp_product_id, solo_cajas, multiplo, blister, notes, products(nombre)')
            .order('id', { ascending: false })
            .range(0, 9999);
        setRules(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return rules;
        return rules.filter(r => r.products?.nombre?.toLowerCase().includes(q));
    }, [rules, search]);

    const handleSearchProduct = useCallback(async (q) => {
        setProductSearch(q);
        if (q.length < 2) { setProductResults([]); return; }
        setSearchingProduct(true);
        const { data } = await supabase
            .from('products')
            .select('id, nombre')
            .ilike('nombre', `%${q}%`)
            .range(0, 19);
        setProductResults(data || []);
        setSearchingProduct(false);
    }, []);

    const startAdd = useCallback((product) => {
        setEditing({
            id:             null,
            erp_product_id: product.id,
            product_name:   product.nombre,
            solo_cajas:     false,
            multiplo:       '',
            blister:        '',
            notes:          '',
        });
        setProductSearch('');
        setProductResults([]);
        setShowAddPanel(false);
    }, []);

    const startEdit = useCallback((rule) => {
        setEditing({
            id:             rule.id,
            erp_product_id: rule.erp_product_id,
            product_name:   rule.products?.nombre ?? '',
            solo_cajas:     rule.solo_cajas,
            multiplo:       rule.multiplo ?? '',
            blister:        rule.blister ?? '',
            notes:          rule.notes ?? '',
        });
    }, []);

    const handleSave = useCallback(async () => {
        if (!editing) return;
        setSaving(true);
        setError(null);

        const payload = {
            erp_product_id: editing.erp_product_id,
            solo_cajas:     editing.solo_cajas,
            multiplo:       editing.multiplo ? parseInt(editing.multiplo) : null,
            blister:        editing.blister  ? parseInt(editing.blister)  : null,
            notes:          editing.notes || null,
            updated_at:     new Date().toISOString(),
        };

        try {
            if (editing.id) {
                const { error: upErr } = await supabase
                    .from('dispatch_rules')
                    .update(payload)
                    .eq('id', editing.id);
                if (upErr) throw upErr;
                useStaff.getState().appendAuditLog('EDITAR_REGLA_DESPACHO', String(editing.id), payload);
            } else {
                const { error: insErr } = await supabase
                    .from('dispatch_rules')
                    .insert(payload);
                if (insErr) throw insErr;
                useStaff.getState().appendAuditLog('CREAR_REGLA_DESPACHO', String(editing.erp_product_id), payload);
            }
            setEditing(null);
            loadRules();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }, [editing, loadRules]);

    const handleDelete = useCallback(async (id) => {
        if (!window.confirm('¿Eliminar esta regla de despacho?')) return;
        const { error: delErr } = await supabase.from('dispatch_rules').delete().eq('id', id);
        if (!delErr) {
            useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(id), {});
            loadRules();
        }
    }, [loadRules]);

    return (
        <div className="space-y-4 p-4">
            {/* Toolbar */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar producto…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-[13px] bg-white/80 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <button
                    onClick={() => setShowAddPanel(p => !p)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 transition-colors"
                >
                    <Plus size={14} /> Agregar regla
                </button>
            </div>

            {/* Add new rule — product search panel */}
            {showAddPanel && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                    <p className="text-[13px] font-medium text-slate-700 mb-2">Buscar producto para agregar regla:</p>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Nombre del producto…"
                            value={productSearch}
                            onChange={e => handleSearchProduct(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[13px] bg-white focus:outline-none focus:border-blue-400"
                        />
                        {searchingProduct && (
                            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
                        )}
                    </div>
                    {productResults.length > 0 && (
                        <ul className="mt-2 border border-slate-200 rounded-xl bg-white overflow-hidden max-h-48 overflow-y-auto">
                            {productResults.map(p => (
                                <li key={p.id}>
                                    <button
                                        onClick={() => startAdd(p)}
                                        className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
                                    >
                                        {p.nombre}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Edit form */}
            {editing && (
                <div className="rounded-2xl border border-blue-200 bg-white/80 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] p-4 space-y-3">
                    <h4 className="font-semibold text-slate-700 text-[14px]">
                        {editing.id ? 'Editar regla' : 'Nueva regla'} — {editing.product_name}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="flex items-center gap-2">
                            <input
                                id="solo_cajas"
                                type="checkbox"
                                checked={editing.solo_cajas}
                                onChange={e => setEditing(prev => ({ ...prev, solo_cajas: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="solo_cajas" className="text-[13px] text-slate-700">Solo cajas completas</label>
                        </div>

                        <div>
                            <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Múltiplo de N packs</label>
                            <input
                                type="number"
                                min={1}
                                placeholder="Ej: 6"
                                value={editing.multiplo}
                                onChange={e => setEditing(prev => ({ ...prev, multiplo: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Múltiplo de N blísters</label>
                            <input
                                type="number"
                                min={1}
                                placeholder="Ej: 10"
                                value={editing.blister}
                                onChange={e => setEditing(prev => ({ ...prev, blister: e.target.value }))}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Notas</label>
                        <input
                            type="text"
                            placeholder="Observación interna…"
                            value={editing.notes}
                            onChange={e => setEditing(prev => ({ ...prev, notes: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
                        />
                    </div>

                    {error && (
                        <p className="text-[12px] text-red-600 flex items-center gap-1">
                            <AlertTriangle size={13} /> {error}
                        </p>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={() => setEditing(null)}
                            className="px-4 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            Guardar
                        </button>
                    </div>
                </div>
            )}

            {/* Rules table */}
            {loading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-[14px]">Cargando reglas…</span>
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm p-10 text-center text-slate-400">
                    <p className="text-[14px]">{search ? 'Sin coincidencias.' : 'No hay reglas de despacho configuradas.'}</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)] overflow-hidden">
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="text-[11px] text-slate-400 uppercase tracking-wide bg-slate-50/60">
                                <th className="text-left px-4 py-2 font-medium">Producto</th>
                                <th className="text-center px-3 py-2 font-medium">Solo cajas</th>
                                <th className="text-center px-3 py-2 font-medium">Múltiplo</th>
                                <th className="text-center px-3 py-2 font-medium">Blíster</th>
                                <th className="text-left px-3 py-2 font-medium">Notas</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(rule => (
                                <tr key={rule.id} className="border-t border-slate-50 hover:bg-blue-50/30 transition-colors">
                                    <td className="px-4 py-2.5 font-medium text-slate-700">
                                        {rule.products?.nombre ?? `Producto ${rule.erp_product_id}`}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        {rule.solo_cajas
                                            ? <Check size={14} className="text-emerald-500 mx-auto" />
                                            : <X size={14} className="text-slate-300 mx-auto" />
                                        }
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-slate-600">
                                        {rule.multiplo ? `×${rule.multiplo}` : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-slate-600">
                                        {rule.blister ? `×${rule.blister}` : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-slate-400 italic text-[12px]">
                                        {rule.notes || '—'}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button
                                                onClick={() => startEdit(rule)}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                            >
                                                <Pencil size={13} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
