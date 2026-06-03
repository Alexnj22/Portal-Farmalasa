import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Search, Loader2, X, Package, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../supabaseClient';

// erp_sucursal_id → branch name (matches erp_sucursal_map, excluding bodega)
const ERP_BRANCH_MAP = {
  1: 'Salud 1',
  2: 'Salud 2',
  3: 'Salud 3',
  4: 'Salud 4',
  5: 'La Popular',
  7: 'Salud 5',
};
const BRANCH_ORDER = [5, 1, 2, 3, 4, 7];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = (new Date(dateStr + 'T12:00:00') - new Date()) / 86400000;
  return Math.ceil(diff);
}

export default function WidgetInventorySearch() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState({});
  const debounceRef             = useRef(null);

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('inventory')
        .select('erp_product_id, erp_sucursal_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad, is_vencidos')
        .ilike('descripcion', `%${q}%`)
        .gt('cantidad', 0)
        .order('descripcion');
      if (err) throw err;

      // Group by product (descripcion + presentacion), then by branch
      const byProduct = {};
      for (const row of data || []) {
        const key = `${row.descripcion}||${row.presentacion || ''}`;
        if (!byProduct[key]) byProduct[key] = { descripcion: row.descripcion, presentacion: row.presentacion, branches: {} };
        const branchName = ERP_BRANCH_MAP[row.erp_sucursal_id];
        if (!branchName) continue; // skip bodega
        if (!byProduct[key].branches[branchName]) byProduct[key].branches[branchName] = [];
        byProduct[key].branches[branchName].push(row);
      }
      setResults(Object.values(byProduct));
    } catch (e) {
      setError('Error al consultar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => search(val), 400);
  };

  const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search */}
      <div className="relative shrink-0">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading
            ? <Loader2 size={14} className="text-[#0052CC] animate-spin" />
            : <Search size={14} className="text-slate-400" />}
        </div>
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          placeholder="Buscar producto en inventario..."
          className="w-full pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
          spellCheck={false} autoComplete="off"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults(null); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-2xl bg-red-50 border border-red-100 text-[11px] text-red-500 font-medium shrink-0">{error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {results === null && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300">
            <Package size={32} strokeWidth={1.5} />
            <p className="text-[12px] font-semibold text-slate-400">Escribe un producto para consultar</p>
          </div>
        )}

        {results !== null && results.length === 0 && (
          <div className="py-8 text-center text-[12px] text-slate-400 font-medium">
            Sin resultados para "{query}"
          </div>
        )}

        {(results || []).map((prod) => {
          const key = `${prod.descripcion}||${prod.presentacion}`;
          const isOpen = expanded[key];
          const branchKeys = BRANCH_ORDER.map(id => ERP_BRANCH_MAP[id]).filter(b => prod.branches[b]);
          const totalUnits = branchKeys.reduce((s, b) =>
            s + prod.branches[b].reduce((ss, r) => ss + r.cantidad, 0), 0);

          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {/* Product header */}
              <button
                onClick={() => toggleExpand(key)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black text-slate-800 truncate">{prod.descripcion}</p>
                  {prod.presentacion && (
                    <p className="text-[10px] text-slate-400 font-medium">{prod.presentacion}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-black text-[#0052CC] bg-blue-50 px-2 py-0.5 rounded-full">
                    {totalUnits} uds
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {branchKeys.length} suc.
                  </span>
                  {isOpen ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
                </div>
              </button>

              {/* Branch breakdown */}
              {isOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {branchKeys.map(branchName => {
                    const rows = prod.branches[branchName];
                    const branchTotal = rows.reduce((s, r) => s + r.cantidad, 0);
                    return (
                      <div key={branchName} className="px-3.5 py-2.5 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-slate-700">{branchName}</span>
                          <span className="text-[11px] font-black text-slate-600">{branchTotal} uds</span>
                        </div>
                        {rows.map((row, i) => {
                          const days = daysUntil(row.fecha_vencimiento);
                          const isExpired = days !== null && days <= 0;
                          const isNear = days !== null && days > 0 && days <= 60;
                          return (
                            <div key={i} className="flex items-center gap-2 pl-2">
                              <div className="flex-1 flex items-center gap-2 min-w-0">
                                {row.lote && (
                                  <span className="text-[10px] font-mono text-slate-400 truncate">Lote: {row.lote}</span>
                                )}
                                {row.fecha_vencimiento && (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg shrink-0 ${
                                    isExpired ? 'bg-red-100 text-red-600' :
                                    isNear    ? 'bg-amber-100 text-amber-600' :
                                               'bg-slate-100 text-slate-500'
                                  }`}>
                                    {isExpired ? '⚠ Vencido' : `Vence ${new Date(row.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}`}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-bold text-slate-500 shrink-0">{row.cantidad}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
