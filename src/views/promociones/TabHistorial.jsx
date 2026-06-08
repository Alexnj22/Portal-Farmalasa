import React, { useState, useEffect, useCallback } from 'react';
import {
    History, ChevronDown, ChevronRight, FlaskConical, Building2, Package,
} from 'lucide-react';
import { supabase }      from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const COLS = [
    { key: 'expand',    label: '',           align: 'center', w: 'w-8'   },
    { key: 'nombre',    label: 'Promoción',  align: 'left'               },
    { key: 'fechas',    label: 'Período',    align: 'center', w: 'w-36', hideBelow: 'md' },
    { key: 'productos', label: 'Productos',  align: 'center', w: 'w-24'  },
    { key: 'vendido',   label: 'Vendido',    align: 'center', w: 'w-28', hideBelow: 'sm' },
];

export default function TabHistorial({ searchTerm }) {
    const { showToast }   = useToastStore();
    const [promos,   setPromos]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [expanded, setExpanded] = useState(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('promotions')
            .select(`
                id, nombre, estado, fecha_inicio, fecha_fin, end_condition, notas,
                laboratorios(nombre),
                promotion_branches(branch_id, branches(name)),
                promotion_products(
                    id, product_id, factor_descripcion, stock_inicial,
                    products(nombre, foto_url),
                    promotion_sales_cache(units_sold)
                )
            `)
            .eq('estado', 'closed')
            .order('updated_at', { ascending: false });

        if (error) showToast('Error', error.message, 'error');
        setPromos(data || []);
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const toggleExpand = (id) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const filtered = searchTerm
        ? promos.filter(p =>
            norm(p.nombre).includes(norm(searchTerm)) ||
            norm(p.laboratorios?.nombre).includes(norm(searchTerm)) ||
            (p.promotion_products || []).some(pp => norm(pp.products?.nombre).includes(norm(searchTerm)))
          )
        : promos;

    const pillCls = 'flex items-center gap-2 bg-white/80 border border-slate-200/70 rounded-2xl px-3 py-2 shadow-sm mb-3';

    return (
        <div>
            <div className={pillCls}>
                <History size={12} className="text-slate-400" />
                <span className="text-[11px] text-slate-500">
                    {filtered.length} {filtered.length === 1 ? 'promoción cerrada' : 'promociones cerradas'}
                </span>
            </div>

            <DataTable
                columns={COLS}
                loading={loading}
                empty={!loading && filtered.length === 0}
                emptyText={searchTerm ? 'Sin resultados' : 'Sin promociones cerradas aún'}
                emptyIcon={History}
            >
                {filtered.map((promo, idx) => {
                    const isOpen = expanded.has(promo.id);
                    const totalSold = (promo.promotion_products || []).reduce((s, pp) =>
                        s + (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0), 0);
                    const totalStock = (promo.promotion_products || []).reduce((s, pp) =>
                        s + (pp.stock_inicial || 0), 0);
                    const pct = totalStock > 0 ? Math.min(100, Math.round(totalSold / totalStock * 100)) : null;

                    return (
                        <React.Fragment key={promo.id}>
                            <DataRow index={idx} onClick={() => toggleExpand(promo.id)}>
                                <DataCell align="center">
                                    {isOpen
                                        ? <ChevronDown  size={13} className="text-slate-400" />
                                        : <ChevronRight size={13} className="text-slate-400" />}
                                </DataCell>

                                <DataCell align="left">
                                    <span className="text-[12px] font-semibold text-slate-700">{promo.nombre}</span>
                                    {promo.laboratorios?.nombre && (
                                        <span className="ml-1.5 text-[10px] text-slate-400">{promo.laboratorios.nombre}</span>
                                    )}
                                </DataCell>

                                <DataCell align="center" hideBelow="md">
                                    <span className="text-[11px] text-slate-500">
                                        {fmtDate(promo.fecha_inicio)}
                                        {promo.fecha_fin && ` → ${fmtDate(promo.fecha_fin)}`}
                                        {!promo.fecha_inicio && '—'}
                                    </span>
                                </DataCell>

                                <DataCell align="center">
                                    <span className="text-[12px] font-medium text-slate-600">
                                        {(promo.promotion_products || []).length}
                                    </span>
                                </DataCell>

                                <DataCell align="center" hideBelow="sm">
                                    {pct !== null ? (
                                        <div className="flex items-center gap-1.5 justify-center">
                                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-400' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[10px] text-slate-400">{pct}%</span>
                                        </div>
                                    ) : (
                                        <span className="text-[11px] text-slate-400">{totalSold > 0 ? `${totalSold} und` : '—'}</span>
                                    )}
                                </DataCell>
                            </DataRow>

                            {isOpen && (
                                <tr key={`exp-${promo.id}`}>
                                    <td colSpan={COLS.length} className="p-0 bg-slate-50/50">
                                        <div className="px-4 pb-3 pt-1">
                                            {(promo.promotion_branches || []).length > 0 && (
                                                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-2">
                                                    <Building2 size={9} />
                                                    {(promo.promotion_branches || []).map(pb => pb.branches?.name).filter(Boolean).join(', ')}
                                                </div>
                                            )}
                                            {promo.notas && (
                                                <p className="text-[10px] text-slate-400 italic mb-2">"{promo.notas}"</p>
                                            )}
                                            {(promo.promotion_products || []).map(pp => {
                                                const sold = (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0);
                                                const ppPct = pp.stock_inicial && pp.stock_inicial > 0
                                                    ? Math.min(100, Math.round(sold / pp.stock_inicial * 100))
                                                    : null;
                                                return (
                                                    <div key={pp.id} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0">
                                                        <div className="w-6 h-6 rounded bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
                                                            {pp.products?.foto_url
                                                                ? <img src={pp.products.foto_url} className="w-full h-full object-cover" alt="" />
                                                                : <Package size={10} className="text-slate-300" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <span className="text-[11px] font-medium text-slate-600 truncate">{pp.products?.nombre}</span>
                                                            {pp.factor_descripcion && (
                                                                <span className="ml-1.5 text-[10px] text-violet-500">{pp.factor_descripcion}</span>
                                                            )}
                                                        </div>
                                                        {pp.stock_inicial != null && (
                                                            <span className="text-[10px] text-slate-400">{sold}/{pp.stock_inicial} und</span>
                                                        )}
                                                        {ppPct !== null && (
                                                            <div className="flex items-center gap-1">
                                                                <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                    <div className={`h-full rounded-full ${ppPct >= 100 ? 'bg-emerald-400' : 'bg-slate-300'}`} style={{ width: `${ppPct}%` }} />
                                                                </div>
                                                                <span className="text-[9px] text-slate-400">{ppPct}%</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>
        </div>
    );
}
