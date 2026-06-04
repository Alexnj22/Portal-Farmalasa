import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, X, Package, ArrowLeft, ZoomIn, ChevronRight } from 'lucide-react';
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

const BRANCH_THEME = {
  'La Popular': { dot: '#7C3AED', pill: 'bg-violet-50  border-violet-200/70', label: 'text-violet-700' },
  'Salud 1':    { dot: '#0052CC', pill: 'bg-blue-50    border-blue-200/70',   label: 'text-blue-700'   },
  'Salud 2':    { dot: '#059669', pill: 'bg-emerald-50 border-emerald-200/70',label: 'text-emerald-700'},
  'Salud 3':    { dot: '#D97706', pill: 'bg-amber-50   border-amber-200/70', label: 'text-amber-700'  },
  'Salud 4':    { dot: '#E11D48', pill: 'bg-rose-50    border-rose-200/70',   label: 'text-rose-700'   },
  'Salud 5':    { dot: '#0891B2', pill: 'bg-cyan-50    border-cyan-200/70',   label: 'text-cyan-700'   },
};
const DEFAULT_THEME = BRANCH_THEME['Salud 1'];

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T12:00:00') - new Date()) / 86400000);
}

function ExpiryBadge({ date }) {
  if (!date) return null;
  const days      = daysUntil(date);
  const isExpired = days <= 0;
  const isNear    = days > 0 && days <= 60;
  return (
    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap ${
      isExpired ? 'bg-red-100 text-red-600' :
      isNear    ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-500'
    }`}>
      {isExpired
        ? '⚠ Vencido'
        : new Date(date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
    </span>
  );
}

/* ─── Skeletons ─────────────────────────────────────────────────────────── */
function SkeletonSection({ rows }) {
  return (
    <div className="mb-4 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-slate-200/70 rounded" />
        <div className="h-5 w-24 bg-slate-200 rounded-full" />
        <div className="h-px flex-1 bg-slate-200/70 rounded" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 bg-slate-200 rounded-md" style={{ width: `${48 + (i * 19) % 36}%` }} />
              <div className="h-1.5 bg-slate-100 rounded-md w-1/3" />
            </div>
            <div className="h-2 w-8 bg-slate-100 rounded shrink-0" />
            <div className="h-4 w-20 bg-slate-100 rounded-md shrink-0" />
            <div className="h-2.5 w-12 bg-slate-200 rounded shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Photo thumb ───────────────────────────────────────────────────────── */
function PhotoThumb({ url, onZoom }) {
  if (!url) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); onZoom(url); }}
      className="relative w-8 h-8 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shrink-0 group"
    >
      <img src={url} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <ZoomIn size={10} className="text-white" strokeWidth={2.5} />
      </div>
    </button>
  );
}

/* ─── Lightbox ──────────────────────────────────────────────────────────── */
function Lightbox({ url, onClose }) {
  if (!url) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <img
        src={url}
        alt=""
        className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
        style={{ maxWidth: '85vw', maxHeight: '80vh' }}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/35 flex items-center justify-center transition-colors"
      >
        <X size={14} className="text-white" strokeWidth={2.5} />
      </button>
    </div>,
    document.body
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */
export default function WidgetInventorySearch() {
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [drillProduct, setDrillProduct] = useState(null); // { descripcion, presentacion, fotoUrl }
  const [lightboxUrl,  setLightboxUrl]  = useState(null);
  const debounceRef                     = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    setDrillProduct(null);
    try {
      // 1. Parallel: photos + products matching by principio_activo
      const [{ data: photoData }, { data: paData }] = await Promise.all([
        supabase.from('products').select('nombre, foto_url').not('foto_url', 'is', null),
        supabase.from('products').select('id, principio_activo')
          .ilike('principio_activo', `%${q}%`)
          .not('principio_activo', 'is', null),
      ]);

      const paIds = (paData || []).map(p => p.id);
      const paMap = new Map((paData || []).map(p => [p.id, p.principio_activo]));

      // 2. Inventory query — match by description OR principio_activo product IDs
      let invQuery = supabase
        .from('inventory')
        .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad')
        .gt('cantidad', 0)
        .order('descripcion')
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false });

      invQuery = paIds.length > 0
        ? invQuery.or(`descripcion.ilike.%${q}%,erp_product_id.in.(${paIds.join(',')})`)
        : invQuery.ilike('descripcion', `%${q}%`);

      const { data, error: err } = await invQuery;
      if (err) throw err;

      const photoMap = {};
      for (const p of photoData || []) {
        photoMap[p.nombre.toUpperCase().trim()] = p.foto_url;
      }

      // Group: branch → product key → lots
      const map = {};
      for (const row of data || []) {
        const bName = ERP_BRANCH_MAP[row.erp_sucursal_id];
        if (!bName) continue;
        const key = `${row.descripcion}||${row.presentacion || ''}`;
        if (!map[bName])      map[bName]      = {};
        if (!map[bName][key]) map[bName][key] = {
          descripcion:     row.descripcion,
          presentacion:    row.presentacion,
          principioActivo: paMap.get(row.erp_product_id) ?? null,
          fotoUrl:         photoMap[row.descripcion.toUpperCase().trim()] ?? null,
          lots:            [],
        };
        map[bName][key].lots.push(row);
      }

      setResults(
        BRANCH_ORDER
          .map(id => ({ name: ERP_BRANCH_MAP[id], products: Object.values(map[ERP_BRANCH_MAP[id]] || {}) }))
          .filter(b => b.products.length > 0)
      );
    } catch {
      setError('Error al consultar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults(null); setDrillProduct(null); return; }
    debounceRef.current = setTimeout(() => doSearch(val), 380);
  };

  /* ── DRILL-DOWN VIEW ──────────────────────────────────────────────────── */
  if (drillProduct) {
    const drillBranches = (results || [])
      .map(branch => ({
        ...branch,
        products: branch.products.filter(p =>
          p.descripcion === drillProduct.descripcion &&
          (p.presentacion || '') === (drillProduct.presentacion || '')
        ),
      }))
      .filter(b => b.products.length > 0);

    const grandTotal = drillBranches.reduce(
      (s, b) => s + b.products[0].lots.reduce((ss, r) => ss + r.cantidad, 0), 0
    );

    return (
      <div className="flex flex-col gap-2.5 h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setDrillProduct(null)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors shrink-0"
          >
            <ArrowLeft size={13} strokeWidth={2.5} />
          </button>

          {drillProduct.fotoUrl ? (
            <button
              onClick={() => setLightboxUrl(drillProduct.fotoUrl)}
              className="relative w-11 h-11 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 group"
            >
              <img src={drillProduct.fotoUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ZoomIn size={12} className="text-white" strokeWidth={2.5} />
              </div>
            </button>
          ) : (
            <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <Package size={18} strokeWidth={1.5} className="text-slate-300" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-black text-slate-800 leading-tight truncate">{drillProduct.descripcion}</p>
            {drillProduct.principioActivo && (
              <p className="text-[9px] text-violet-500 font-semibold truncate">{drillProduct.principioActivo}</p>
            )}
            {drillProduct.presentacion && (
              <p className="text-[10px] text-slate-400 font-medium">{drillProduct.presentacion}</p>
            )}
            <p className="text-[9px] text-slate-400 font-bold mt-0.5">{grandTotal} uds · {drillBranches.length} sucursal{drillBranches.length !== 1 ? 'es' : ''}</p>
          </div>
        </div>

        {/* Branch sections */}
        <div className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {drillBranches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Package size={24} strokeWidth={1.5} className="text-slate-200" />
              <p className="text-[11px] text-slate-400 font-semibold">Sin stock en ninguna sucursal</p>
            </div>
          ) : (
            drillBranches.map((branch, bi) => {
              const theme = BRANCH_THEME[branch.name] || DEFAULT_THEME;
              const prod  = branch.products[0];
              const total = prod.lots.reduce((s, r) => s + r.cantidad, 0);
              return (
                <div
                  key={branch.name}
                  className="mb-3"
                  style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${bi * 45}ms` }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200/80" />
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} backdrop-blur-sm shadow-sm`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />
                      <span className={`text-[10px] font-black uppercase tracking-wider ${theme.label}`}>{branch.name}</span>
                      <span className="w-px h-3 bg-slate-200 mx-1" />
                      <span className={`text-[12px] font-black tabular-nums ${theme.label}`}>{total}</span>
                      <span className="text-[9px] font-semibold text-slate-400 ml-0.5">uds</span>
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200/80" />
                  </div>
                  <div
                    className="rounded-xl border border-white/60 overflow-hidden backdrop-blur-sm shadow-sm"
                    style={{ background: 'rgba(255,255,255,0.30)' }}
                  >
                    {prod.lots.length === 1 ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-[9px] font-mono text-slate-400 flex-1 truncate">{prod.lots[0].lote || '—'}</span>
                        <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                        <span className="text-[10px] font-black text-slate-700 shrink-0 tabular-nums w-14 text-right">{prod.lots[0].cantidad} uds</span>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/40">
                        {prod.lots.map((row, li) => (
                          <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-[9px] font-mono text-slate-400 flex-1 truncate min-w-0">{row.lote || '—'}</span>
                            <ExpiryBadge date={row.fecha_vencimiento} />
                            <span className="text-[10px] font-black text-slate-600 shrink-0 tabular-nums w-14 text-right">{row.cantidad} uds</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        <style>{`@keyframes inv-fade-up{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </div>
    );
  }

  /* ── SEARCH VIEW ─────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-2.5 h-full">

      {/* ── Search input ─────────────────────────────────────────────── */}
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
          placeholder="Buscar por nombre o principio activo..."
          className="w-full pl-8 pr-7 py-2 rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-sm text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults(null); setDrillProduct(null); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {error && <p className="shrink-0 px-1 text-[11px] text-red-500 font-medium">{error}</p>}

      {/* ── Results ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {loading && <><SkeletonSection rows={3} /><SkeletonSection rows={2} /></>}

        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={28} strokeWidth={1.5} className="text-slate-200" />
            <p className="text-[11px] font-semibold text-slate-400 text-center leading-snug">
              Busca un producto para ver<br />su stock por sucursal
            </p>
          </div>
        )}

        {!loading && results !== null && results.length === 0 && (
          <div className="py-10 text-center text-[12px] text-slate-400 font-medium">
            Sin resultados para "{query}"
          </div>
        )}

        {/* Branch sections */}
        {!loading && (results || []).map((branch, bi) => {
          const theme = BRANCH_THEME[branch.name] || DEFAULT_THEME;
          const branchTotal = branch.products.reduce(
            (s, p) => s + p.lots.reduce((ss, r) => ss + r.cantidad, 0), 0
          );

          return (
            <div
              key={branch.name}
              className="mb-4"
              style={{ animation: `inv-fade-up 0.28s ease both`, animationDelay: `${bi * 55}ms` }}
            >
              {/* Branch header */}
              <div className="flex items-center gap-2 mb-1.5 sticky top-0 z-10 py-0.5">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200/80" />
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} backdrop-blur-sm shadow-sm`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />
                  <span className={`text-[10px] font-black uppercase tracking-wider ${theme.label}`}>
                    {branch.name}
                  </span>
                  <span className="w-px h-3 bg-slate-200 mx-1" />
                  <span className={`text-[12px] font-black tabular-nums ${theme.label}`}>{branchTotal}</span>
                  <span className="text-[9px] font-semibold text-slate-400 ml-0.5">uds</span>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200/80" />
              </div>

              {/* Products */}
              <div className="space-y-2">
                {branch.products.map((prod, pi) => {
                  const lotTotal = prod.lots.reduce((s, r) => s + r.cantidad, 0);
                  const multiLot = prod.lots.length > 1;

                  return (
                    <div
                      key={`${prod.descripcion}||${prod.presentacion}`}
                      className="rounded-xl overflow-hidden"
                      style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${bi * 55 + pi * 25}ms` }}
                    >
                      {multiLot ? (
                        /* Multiple lots */
                        <div
                          className="rounded-xl overflow-hidden cursor-pointer group backdrop-blur-sm"
                          style={{ background: 'rgba(255,255,255,0.38)', border: '1px solid rgba(255,255,255,0.72)', boxShadow: '0 2px 10px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                          onClick={() => setDrillProduct({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo })}
                        >
                          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 group-hover:bg-white/30 transition-colors">
                            {prod.fotoUrl && (
                              <PhotoThumb url={prod.fotoUrl} onZoom={setLightboxUrl} />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-black text-slate-800 leading-tight">{prod.descripcion}</p>
                              {prod.principioActivo && (
                                <p className="text-[9px] text-violet-500 font-semibold mt-0.5 truncate">{prod.principioActivo}</p>
                              )}
                              {prod.presentacion && (
                                <p className="text-[9px] text-slate-400 font-medium mt-0.5">{prod.presentacion}</p>
                              )}
                            </div>
                            <span className="text-[10px] font-black text-slate-500 shrink-0 tabular-nums">{lotTotal} uds</span>
                            <ChevronRight size={11} className="text-slate-300 group-hover:text-[#0052CC] transition-colors shrink-0" strokeWidth={2.5} />
                          </div>
                          <div className="divide-y divide-white/40" style={{ background: 'rgba(255,255,255,0.18)' }}>
                            {prod.lots.map((row, li) => (
                              <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                                <span className="text-[9px] font-mono text-slate-400 flex-1 truncate min-w-0">{row.lote || '—'}</span>
                                <ExpiryBadge date={row.fecha_vencimiento} />
                                <span className="text-[10px] font-black text-slate-600 shrink-0 tabular-nums w-14 text-right">{row.cantidad} uds</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* Single lot */
                        <button
                          className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl backdrop-blur-sm hover:bg-white/50 transition-colors group text-left"
                          style={{ background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(255,255,255,0.68)', boxShadow: '0 2px 10px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                          onClick={() => setDrillProduct({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo })}
                        >
                          {prod.fotoUrl && (
                            <PhotoThumb url={prod.fotoUrl} onZoom={setLightboxUrl} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-slate-800 truncate leading-tight">{prod.descripcion}</p>
                            {prod.principioActivo && (
                              <p className="text-[9px] text-violet-500 font-semibold truncate">{prod.principioActivo}</p>
                            )}
                            {prod.presentacion && (
                              <p className="text-[9px] text-slate-400">{prod.presentacion}</p>
                            )}
                          </div>
                          <span className="text-[9px] font-mono text-slate-400 shrink-0 max-w-[60px] truncate">
                            {prod.lots[0].lote || '—'}
                          </span>
                          <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                          <span className="text-[10px] font-black text-slate-700 shrink-0 tabular-nums w-14 text-right">
                            {prod.lots[0].cantidad} uds
                          </span>
                          <ChevronRight size={11} className="text-slate-300 group-hover:text-[#0052CC] transition-colors shrink-0" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <style>{`@keyframes inv-fade-up{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
