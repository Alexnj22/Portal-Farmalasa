import React, { useState, useRef, useCallback } from 'react';
import { Search, Loader2, X, FlaskConical, Building2, Pill, CheckCircle2, Package } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { fetchInventoryStockFlags } from '../../data/inventory';

async function srsFetch(q, page = 1) {
  const { data: { session } } = await supabase.auth.getSession();
  const token  = session?.access_token;
  const base   = import.meta.env.VITE_SUPABASE_URL;
  const url    = `${base}/functions/v1/srs-proxy?q=${encodeURIComponent(q)}&page=${page}&page-max=12`;
  const res    = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

function sanitize(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? String(v.nombre ?? v.name ?? '') : String(v);
  return s
    // eslint-disable-next-line no-control-regex -- intencional: limpia basura binaria/PUA de lectores de código de barras
    .replace(new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

export default function WidgetSrsInventory() {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [inStock, setInStock]       = useState(new Set()); // erp_product_ids in our inventory
  const debounceRef                 = useRef(null);

  // Cross-reference with inventory by erp_product_id
  const checkInventory = useCallback(async (erpIds) => {
    if (!erpIds.length) return;
    const { data } = await fetchInventoryStockFlags(erpIds);
    setInStock(new Set((data || []).map(r => r.erp_product_id)));
  }, []);

  const search = useCallback(async (q, pg = 1) => {
    if (!q.trim()) { setResults(null); setInStock(new Set()); return; }
    setLoading(true); setError(null);
    try {
      const json = await srsFetch(q, pg);
      const items = json.data || [];
      setResults(items);
      const ids = items.map(p => p.erp_product_id ?? p.id_producto ?? p.id).filter(Boolean).map(Number);
      if (ids.length) checkInventory(ids);
    } catch (e) {
      setError(e.message); setResults(null);
    } finally {
      setLoading(false);
    }
  }, [checkInventory]);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults(null); setInStock(new Set()); return; }
    debounceRef.current = setTimeout(() => search(val, 1), 450);
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search */}
      <div className="relative shrink-0">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading
            ? <Loader2 size={14} className="text-violet-500 animate-spin" />
            : <Search size={14} className="text-content-3" />}
        </div>
        <input
          type="text" value={query} onChange={e => handleInput(e.target.value)}
          placeholder="Buscar en Registro SRS..."
          className="w-full pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-white text-[16px] font-medium text-content-2 placeholder-slate-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/10 transition-all"
          spellCheck={false} autoComplete="off"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults(null); setInStock(new Set()); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-content-3 hover:text-content-2 hover:bg-surface-card-hover transition-colors">
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-2xl bg-danger/10 border border-danger/30 text-[11px] text-danger font-medium shrink-0">{error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {results === null && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3">
            <FlaskConical size={32} strokeWidth={1.5} />
            <p className="text-[12px] font-semibold text-content-3">Busca un medicamento en el registro SRS</p>
          </div>
        )}

        {results !== null && results.length === 0 && (
          <div className="py-8 text-center text-[12px] text-content-3 font-medium">Sin resultados para "{query}"</div>
        )}

        {(results || []).map((p) => {
          const erpId      = p.erp_product_id ?? p.id_producto ?? p.id;
          const hasStock   = erpId && inStock.has(Number(erpId));
          const activo     = sanitize(p.estatus ?? p.Activo ?? '') === 'A';
          const nombre     = sanitize(p.nombre_comercial ?? p.nombreComercial ?? '');
          const lab        = sanitize(p.laboratorio ?? '');
          const forma      = sanitize(p.NOMBRE_FORMA_FARMACEUTICA ?? '');
          const principio  = sanitize(p.principio_activo ?? p.formula ?? '');
          const conc       = sanitize(p.concentracion ?? '');
          const noregistro = sanitize(p.noregistro ?? '');

          return (
            <div key={p.id ?? noregistro}
              className={`rounded-2xl border bg-white p-3.5 flex flex-col gap-2 transition-all ${
                hasStock ? 'border-emerald-300 shadow-sm shadow-emerald-50' : 'border-slate-200'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-black text-content leading-tight flex-1">
                  {nombre || <span className="text-content-3 font-normal italic">Sin nombre</span>}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasStock && (
                    <span className="flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full bg-success/10 text-emerald-700">
                      <CheckCircle2 size={9} strokeWidth={3} /> En stock
                    </span>
                  )}
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
                    activo ? 'bg-success/10 text-emerald-700' : 'bg-surface-card-hover text-content-3'
                  }`}>
                    {activo ? 'ACTIVO' : 'INACTIVO'}
                  </span>
                </div>
              </div>

              {(lab || forma) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {lab && <span className="flex items-center gap-1 text-[11px] text-content-3"><Building2 size={10} className="text-content-3 shrink-0" />{lab}</span>}
                  {forma && <span className="flex items-center gap-1 text-[11px] text-content-3"><Pill size={10} className="text-content-3 shrink-0" />{forma}</span>}
                </div>
              )}

              {principio && (
                <div className="flex items-start gap-1.5 bg-violet-50 rounded-xl px-3 py-2">
                  <FlaskConical size={11} className="text-violet-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-violet-700 font-medium leading-snug">
                    {principio}{conc && <span className="ml-1.5 text-violet-500 font-bold">{conc}</span>}
                  </div>
                </div>
              )}

              {noregistro && (
                <span className="text-[10px] text-content-3 font-mono">{noregistro}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
