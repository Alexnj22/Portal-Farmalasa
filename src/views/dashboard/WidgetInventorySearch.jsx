import React, { useState, useRef, useCallback } from 'react';
import { Search, Loader2, X, Package } from 'lucide-react';
import { supabase } from '../../supabaseClient';

const ERP_BRANCH_MAP = {
  1: 'Salud 1',
  2: 'Salud 2',
  3: 'Salud 3',
  4: 'Salud 4',
  5: 'La Popular',
  7: 'Salud 5',
};
const BRANCH_ORDER = [5, 1, 2, 3, 4, 7];
const BRANCHES = BRANCH_ORDER.map(id => ({ id, name: ERP_BRANCH_MAP[id] }));

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T12:00:00') - new Date()) / 86400000);
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-SV', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
}

function LotRow({ row }) {
  const days = daysUntil(row.fecha_vencimiento);
  const isExpired = days !== null && days <= 0;
  const isNear    = days !== null && days > 0 && days <= 60;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {row.lote
          ? <span className="text-[10px] font-mono text-slate-400 truncate">{row.lote}</span>
          : <span className="text-[10px] text-slate-300 italic">Sin lote</span>
        }
        {row.fecha_vencimiento && (
          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
            isExpired ? 'bg-red-100 text-red-600' :
            isNear    ? 'bg-amber-100 text-amber-600' :
                        'bg-slate-100 text-slate-500'
          }`}>
            {isExpired ? '⚠ Vencido' : `Vence ${fmtDate(row.fecha_vencimiento)}`}
          </span>
        )}
      </div>
      <span className="text-[11px] font-black text-slate-700 shrink-0 tabular-nums">
        {row.cantidad} uds
      </span>
    </div>
  );
}

function SkeletonCard({ lots = 2 }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden animate-pulse shrink-0">
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-slate-200 rounded-lg w-3/4" />
          <div className="h-2 bg-slate-100 rounded-lg w-1/2" />
        </div>
        <div className="h-5 w-14 bg-blue-100 rounded-full shrink-0" />
      </div>
      <div className="border-t border-slate-100 px-3.5 py-2 space-y-2">
        {Array.from({ length: lots }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 bg-slate-100 rounded flex-1" style={{ maxWidth: `${60 + i * 15}%` }} />
            <div className="h-2 bg-slate-200 rounded w-12 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WidgetInventorySearch() {
  const [query,    setQuery]    = useState('');
  const [branch,   setBranch]   = useState(''); // '' = all, or erp_sucursal_id as string
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q, branchId) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      let qb = supabase
        .from('inventory')
        .select('erp_sucursal_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad')
        .ilike('descripcion', `%${q}%`)
        .gt('cantidad', 0)
        .order('descripcion')
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false });

      if (branchId) qb = qb.eq('erp_sucursal_id', Number(branchId));

      const { data, error: err } = await qb;
      if (err) throw err;

      const byProduct = {};
      for (const row of data || []) {
        const key   = `${row.descripcion}||${row.presentacion || ''}`;
        const bName = ERP_BRANCH_MAP[row.erp_sucursal_id];
        if (!bName) continue;
        if (!byProduct[key]) byProduct[key] = {
          descripcion: row.descripcion,
          presentacion: row.presentacion,
          branches: {},
        };
        if (!byProduct[key].branches[bName]) byProduct[key].branches[bName] = [];
        byProduct[key].branches[bName].push(row);
      }
      setResults(Object.values(byProduct));
    } catch {
      setError('Error al consultar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  const trigger = (q, b) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(q, b), 350);
  };

  const handleInput  = (val) => { setQuery(val); trigger(val, branch); };
  const handleBranch = (id)  => {
    const next = branch === id ? '' : id;
    setBranch(next);
    trigger(query, next);
  };

  const singleBranch = !!branch;

  return (
    <div className="flex flex-col gap-2.5 h-full">

      {/* Branch filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto shrink-0 pb-0.5
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <button
          onClick={() => handleBranch('')}
          className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black transition-all active:scale-[0.97] ${
            !branch
              ? 'bg-[#0052CC] text-white shadow-sm'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          Todas
        </button>
        {BRANCHES.map(b => (
          <button
            key={b.id}
            onClick={() => handleBranch(String(b.id))}
            className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black transition-all active:scale-[0.97] ${
              branch === String(b.id)
                ? 'bg-[#0052CC] text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="relative shrink-0">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading
            ? <Loader2 size={13} className="text-[#0052CC] animate-spin" />
            : <Search size={13} className="text-slate-400" />}
        </div>
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full pl-8 pr-7 py-2 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults(null); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-red-500 font-medium shrink-0 px-1">{error}</p>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Loading skeletons */}
        {loading && [2, 1, 3].map((lots, i) => <SkeletonCard key={i} lots={lots} />)}

        {/* Empty states */}
        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={28} strokeWidth={1.5} className="text-slate-200" />
            <p className="text-[11px] font-semibold text-slate-400">
              {branch
                ? `Selecciona una sucursal y busca un producto`
                : 'Escribe un producto para consultar'}
            </p>
          </div>
        )}
        {!loading && results !== null && results.length === 0 && (
          <div className="py-8 text-center text-[12px] text-slate-400 font-medium">
            Sin resultados para "{query}"
          </div>
        )}

        {/* Product cards — always expanded */}
        {!loading && (results || []).map(prod => {
          const key        = `${prod.descripcion}||${prod.presentacion}`;
          const branchKeys = BRANCH_ORDER.map(id => ERP_BRANCH_MAP[id]).filter(b => prod.branches[b]);
          const totalUnits = branchKeys.reduce((s, b) =>
            s + prod.branches[b].reduce((ss, r) => ss + r.cantidad, 0), 0);

          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shrink-0">

              {/* Product header */}
              <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black text-slate-800 leading-tight">{prod.descripcion}</p>
                  {prod.presentacion && (
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{prod.presentacion}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] font-black text-[#0052CC] bg-blue-50 px-2.5 py-0.5 rounded-full">
                  {totalUnits} uds
                </span>
              </div>

              {/* Lots / branches */}
              <div className="border-t border-slate-100">
                {singleBranch ? (
                  /* Single branch selected: show lots directly without branch header */
                  <div className="px-3.5 py-1 divide-y divide-slate-50">
                    {branchKeys.flatMap(b => prod.branches[b]).map((row, i) => (
                      <LotRow key={i} row={row} />
                    ))}
                  </div>
                ) : (
                  /* All branches: group lots by branch */
                  <div className="divide-y divide-slate-100">
                    {branchKeys.map(bName => {
                      const rows   = prod.branches[bName];
                      const bTotal = rows.reduce((s, r) => s + r.cantidad, 0);
                      return (
                        <div key={bName} className="px-3.5 py-2">
                          {/* Branch row header */}
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                              {bName}
                            </span>
                            <span className="text-[10px] font-black text-slate-600">
                              {bTotal} uds
                            </span>
                          </div>
                          {/* Lots */}
                          <div className="divide-y divide-slate-50 pl-1">
                            {rows.map((row, i) => <LotRow key={i} row={row} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
