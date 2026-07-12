import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, X, Package, ArrowLeft, ZoomIn, ChevronRight, FlaskConical, PackageMinus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { fetchAllRows } from '../../utils/supabaseUtils';

const ERP_BRANCH_MAP = {
  1: 'Salud 1',
  2: 'Salud 2',
  3: 'Salud 3',
  4: 'Salud 4',
  5: 'La Popular',
  6: 'Bodega',
  7: 'Salud 5',
};
const BRANCH_ORDER = [5, 1, 2, 3, 4, 7, 6];

const NEUTRAL_THEME = { dot: '#64748B', pill: 'bg-slate-50 border-slate-200/70', label: 'text-slate-600' };
const VENCIDOS_THEME = { dot: '#E11D48', pill: 'bg-rose-50 border-rose-200/70', label: 'text-rose-700' };
const DEFAULT_THEME = NEUTRAL_THEME;

/* ─── SRS helpers ──────────────────────────────────────────────────────────── */
async function srsFetch(q) {
  const { data: { session } } = await supabase.auth.getSession();
  const base = import.meta.env.VITE_SUPABASE_URL;
  const url  = `${base}/functions/v1/srs-proxy?q=${encodeURIComponent(q)}&page=1&page-max=5`;
  const res  = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error(`SRS ${res.status}`);
  return res.json();
}

function sanitizeSrs(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? String(v.nombre ?? v.name ?? v.value ?? '') : String(v);
  return s
    // Limpia control chars y caracteres invisibles (Private Use Area, Specials)
    // que vienen pegados en los datos del SRS gubernamental \u2014 intencional.
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp('[\x00-\x08\x0B\x0C\x0E-\x1F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

// Extracts the base molecule name, stripping concentration (e.g. "IBUPROFENO 400MG" → "IBUPROFENO")
function extractMolecule(principio) {
  if (!principio) return null;
  const m = principio.trim().match(/^([A-ZÁÉÍÓÚÑÜ\s+\-/]+)/i);
  return m ? m[1].trim() : principio.trim();
}

/* ─── Utilities ────────────────────────────────────────────────────────────── */
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T12:00:00') - new Date()) / 86400000);
}

function groupInventory(rows, paMap, photoMap) {
  const map = {};
  for (const row of rows || []) {
    if (row.is_vencidos) continue; // vencidos handled separately
    const bName = ERP_BRANCH_MAP[row.erp_sucursal_id];
    if (!bName) continue;
    const key = `${row.descripcion}||${row.presentacion || ''}`;
    if (!map[bName])      map[bName]      = {};
    if (!map[bName][key]) map[bName][key] = {
      descripcion:     row.descripcion,
      presentacion:    row.presentacion,
      principioActivo: paMap?.get(row.erp_product_id) ?? null,
      fotoUrl:         photoMap[row.descripcion.toUpperCase().trim()] ?? null,
      lots:            [],
    };
    map[bName][key].lots.push(row);
  }
  return BRANCH_ORDER
    .map(id => ({ name: ERP_BRANCH_MAP[id], products: Object.values(map[ERP_BRANCH_MAP[id]] || {}) }))
    .filter(b => b.products.length > 0);
}

function groupVencidos(rows, paMap, photoMap) {
  const map = {};
  for (const row of rows || []) {
    if (!row.is_vencidos) continue;
    const key = `${row.descripcion}||${row.presentacion || ''}`;
    if (!map[key]) map[key] = {
      descripcion:     row.descripcion,
      presentacion:    row.presentacion,
      principioActivo: paMap?.get(row.erp_product_id) ?? null,
      fotoUrl:         photoMap[row.descripcion.toUpperCase().trim()] ?? null,
      lots:            [],
    };
    map[key].lots.push(row);
  }
  return Object.values(map);
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */
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

function Lightbox({ url, onClose }) {
  if (!url) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <img
        src={url} alt=""
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

/* ─── Compact SRS card with inline report button ───────────────────────────── */
function SrsCompactCard({ product: p, searchQuery, user }) {
  const [formOpen, setFormOpen] = useState(false);
  const [qty,      setQty]      = useState('1');
  const [rState,   setRState]   = useState('idle'); // idle | saving | done

  const nombre    = sanitizeSrs(p.nombre_comercial ?? p.nombreComercial ?? '');
  const principio = sanitizeSrs(p.principio_activo ?? p.formula ?? '');
  const conc      = sanitizeSrs(p.concentracion ?? '');
  const lab       = sanitizeSrs(p.laboratorio ?? '');
  const estatus   = sanitizeSrs(p.estatus ?? p.Activo ?? '');
  const activo    = estatus === 'A';

  const submit = async () => {
    const cantidad = parseInt(qty, 10);
    if (!cantidad || cantidad < 1) return;
    setRState('saving');
    await supabase.from('ventas_perdidas').insert({
      producto_buscado: searchQuery,
      descripcion:      nombre   || null,
      principio_activo: principio ? `${principio}${conc ? ` ${conc}` : ''}` : null,
      laboratorio:      lab      || null,
      cantidad,
      branch_id:     user?.branchId ?? null,
      reportado_por: user?.id       ?? null,
      status:        'pendiente',
    });
    setRState('done');
    setTimeout(() => { setFormOpen(false); setRState('idle'); setQty('1'); }, 2500);
  };

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/70 backdrop-blur-sm px-3 py-2.5 flex flex-col gap-1.5">
      {/* Header row: nombre + estatus + reportar */}
      <div className="flex items-start gap-1.5">
        <p className="text-[11px] font-black text-slate-800 leading-tight flex-1">{nombre || '—'}</p>
        <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded-full ${
          activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
        }`}>
          {activo ? 'ACTIVO' : 'INACTIVO'}
        </span>
        {rState === 'done' ? (
          <span className="shrink-0 flex items-center gap-1 text-[8px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200/70 px-1.5 py-0.5 rounded-full">
            <CheckCircle2 size={8} strokeWidth={2.5} />OK
          </span>
        ) : formOpen ? (
          <div className="shrink-0 flex items-center gap-1">
            <input
              type="number" min="1"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-10 px-1.5 py-0.5 rounded-lg border border-slate-200 text-[16px] font-black text-slate-700 text-center outline-none focus:border-rose-400"
            />
            <button
              onClick={submit}
              disabled={rState === 'saving'}
              className="px-1.5 py-0.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-[8px] font-black transition-colors disabled:opacity-50"
            >
              {rState === 'saving' ? '…' : 'OK'}
            </button>
            <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setFormOpen(true)}
            className="shrink-0 flex items-center gap-0.5 text-[8px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 px-1.5 py-0.5 rounded-full transition-colors"
          >
            <PackageMinus size={8} strokeWidth={2.5} />
            Reportar
          </button>
        )}
      </div>
      {principio && (
        <div className="flex items-center gap-1.5 bg-violet-50 rounded-lg px-2 py-1">
          <FlaskConical size={9} className="text-violet-400 shrink-0" />
          <p className="text-[10px] text-violet-700 font-semibold leading-tight">
            {principio}{conc ? ` ${conc}` : ''}
          </p>
        </div>
      )}
      {lab && <p className="text-[9px] text-slate-400 font-medium truncate">{lab}</p>}
    </div>
  );
}

/* ─── Branch sections (shared between results and alternatives) ────────────── */
function BranchSections({ branches, onDrill, onZoom, animOffset = 0 }) {
  return branches.map((branch, bi) => {
    const theme       = NEUTRAL_THEME;
    const branchTotal = branch.products.reduce((s, p) => s + p.lots.reduce((ss, r) => ss + r.cantidad, 0), 0);

    return (
      <div
        key={branch.name}
        className="mb-4"
        style={{ animation: `inv-fade-up 0.28s ease both`, animationDelay: `${(animOffset + bi) * 55}ms` }}
      >
        <div className="flex items-center gap-2 mb-1.5 sticky top-0 z-10 py-0.5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200/80" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} backdrop-blur-sm shadow-sm`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />
            <span className={`text-[10px] font-black uppercase tracking-wider ${theme.label}`}>{branch.name}</span>
            <span className="w-px h-3 bg-slate-200 mx-1" />
            <span className={`text-[12px] font-black tabular-nums ${theme.label}`}>{branchTotal}</span>
            <span className="text-[9px] font-semibold text-slate-400 ml-0.5">uds</span>
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200/80" />
        </div>

        <div className="space-y-2">
          {branch.products.map((prod, pi) => {
            const lotTotal = prod.lots.reduce((s, r) => s + r.cantidad, 0);
            const multiLot = prod.lots.length > 1;

            return (
              <div
                key={`${prod.descripcion}||${prod.presentacion}`}
                className="rounded-xl overflow-hidden"
                style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${(animOffset + bi) * 55 + pi * 25}ms` }}
              >
                {multiLot ? (
                  <div
                    className="rounded-xl overflow-hidden cursor-pointer group backdrop-blur-sm"
                    style={{ background: 'rgba(255,255,255,0.38)', border: '1px solid rgba(255,255,255,0.72)', boxShadow: '0 2px 10px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                    onClick={() => onDrill({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo })}
                  >
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 group-hover:bg-white/30 transition-colors">
                      {prod.fotoUrl && <PhotoThumb url={prod.fotoUrl} onZoom={onZoom} />}
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
                  <button
                    className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl backdrop-blur-sm hover:bg-white/50 transition-colors group text-left"
                    style={{ background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(255,255,255,0.68)', boxShadow: '0 2px 10px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                    onClick={() => onDrill({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo })}
                  >
                    {prod.fotoUrl && <PhotoThumb url={prod.fotoUrl} onZoom={onZoom} />}
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
  });
}

/* ─── Section label ────────────────────────────────────────────────────────── */
function SectionLabel({ icon: Icon, label, color = 'text-slate-400', bg = 'bg-slate-100' }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${bg}`}>
        <Icon size={10} className={color} strokeWidth={2.5} />
        <span className={`text-[9px] font-black uppercase tracking-wider ${color}`}>{label}</span>
      </div>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────────── */
export default function WidgetInventorySearch() {
  const { user }       = useAuth();
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [drillProduct,   setDrillProduct]   = useState(null);
  const [lightboxUrl,    setLightboxUrl]    = useState(null);
  const [vencidosProds,  setVencidosProds]  = useState([]);
  const [srsResults,     setSrsResults]     = useState(null);
  const [srsLoading,   setSrsLoading]   = useState(false);
  const [alternatives, setAlternatives] = useState([]);
  const debounceRef                     = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    setDrillProduct(null);
    setSrsResults(null);
    setAlternatives([]);
    setVencidosProds([]);

    try {
      // 1. Parallel: photos + products matching by principio_activo
      // fetchAllRows evita el cap silencioso de 1000 filas de PostgREST — si
      // más de 1000 productos tienen foto, el mapa quedaba incompleto en silencio.
      const [photoData, { data: paData }] = await Promise.all([
        fetchAllRows(() => supabase.from('products').select('nombre, foto_url').not('foto_url', 'is', null)),
        supabase.from('products').select('id, principio_activo')
          .ilike('principio_activo', `%${q}%`)
          .not('principio_activo', 'is', null),
      ]);

      const paIds = (paData || []).map(p => p.id);
      const paMap = new Map((paData || []).map(p => [p.id, p.principio_activo]));

      const photoMap = {};
      for (const p of photoData || []) {
        photoMap[p.nombre.toUpperCase().trim()] = p.foto_url;
      }

      // 2. Query inventory by name OR principio_activo product IDs (include vencidos)
      let invQuery = supabase
        .from('inventory')
        .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad, is_vencidos')
        .gt('cantidad', 0)
        .order('descripcion')
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false });

      invQuery = paIds.length > 0
        ? invQuery.or(`descripcion.ilike.%${q}%,erp_product_id.in.(${paIds.join(',')})`)
        : invQuery.ilike('descripcion', `%${q}%`);

      const { data, error: err } = await invQuery;
      if (err) throw err;

      const grouped  = groupInventory(data, paMap, photoMap);
      const vencidos = groupVencidos(data, paMap, photoMap);
      setResults(grouped);
      setVencidosProds(vencidos);

      // 3. No inventory results → auto-search SRS + find alternatives
      if (grouped.length === 0) {
        setSrsLoading(true);
        try {
          const srsJson = await srsFetch(q);
          const srsData = srsJson.data || [];
          setSrsResults(srsData);

          // Extract unique base molecules from SRS results
          const molecules = [...new Set(
            srsData
              .map(p => extractMolecule(sanitizeSrs(p.principio_activo ?? p.formula ?? '')))
              .filter(Boolean)
          )];

          if (molecules.length > 0) {
            // Find our products matching any of these molecules
            const { data: altProds } = await supabase
              .from('products')
              .select('id, principio_activo')
              .or(molecules.map(m => `principio_activo.ilike.%${m}%`).join(','));

            const altIds   = (altProds || []).map(p => p.id);
            const altPaMap = new Map((altProds || []).map(p => [p.id, p.principio_activo]));

            if (altIds.length > 0) {
              const { data: altInv } = await supabase
                .from('inventory')
                .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad')
                .gt('cantidad', 0)
                .in('erp_product_id', altIds)
                .order('descripcion')
                .order('fecha_vencimiento', { ascending: true, nullsFirst: false });

              setAlternatives(groupInventory(altInv, altPaMap, photoMap));
            }
          }
        } catch {
          // SRS failure is non-fatal
        } finally {
          setSrsLoading(false);
        }
      }
    } catch {
      setError('Error al consultar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults(null); setDrillProduct(null); setSrsResults(null); setAlternatives([]); setVencidosProds([]); return; }
    debounceRef.current = setTimeout(() => doSearch(val), 380);
  };

  /* ── DRILL-DOWN VIEW ────────────────────────────────────────────────────── */
  if (drillProduct) {
    const drillBranches = (results || []).concat(alternatives).reduce((acc, branch) => {
      const matching = branch.products.filter(p =>
        p.descripcion === drillProduct.descripcion &&
        (p.presentacion || '') === (drillProduct.presentacion || '')
      );
      if (!matching.length) return acc;
      const existing = acc.find(b => b.name === branch.name);
      if (existing) existing.products = matching;
      else acc.push({ ...branch, products: matching });
      return acc;
    }, []);

    // Add bodega vencidos if this product has any
    const drillVencidos = vencidosProds.filter(p =>
      p.descripcion === drillProduct.descripcion &&
      (p.presentacion || '') === (drillProduct.presentacion || '')
    );
    if (drillVencidos.length > 0) {
      drillBranches.push({ name: 'Bodega · Vencidos', products: drillVencidos, isVencidos: true });
    }

    const grandTotal = drillBranches.reduce(
      (s, b) => s + b.products[0].lots.reduce((ss, r) => ss + r.cantidad, 0), 0
    );

    return (
      <div className="flex flex-col gap-2.5 h-full">
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

        <div className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {drillBranches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Package size={24} strokeWidth={1.5} className="text-slate-200" />
              <p className="text-[11px] text-slate-400 font-semibold">Sin stock en ninguna sucursal</p>
            </div>
          ) : (
            drillBranches.map((branch, bi) => {
              const theme = branch.isVencidos ? VENCIDOS_THEME : NEUTRAL_THEME;
              const prod  = branch.products[0];
              const total = prod.lots.reduce((s, r) => s + r.cantidad, 0);
              return (
                <div
                  key={branch.name}
                  className="mb-3"
                  style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${bi * 45}ms` }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${branch.isVencidos ? 'to-rose-200/80' : 'to-slate-200/80'}`} />
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} backdrop-blur-sm shadow-sm`}>
                      {branch.isVencidos
                        ? <AlertTriangle size={9} className="text-rose-500 shrink-0" strokeWidth={2.5} />
                        : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />}
                      <span className={`text-[10px] font-black uppercase tracking-wider ${theme.label}`}>{branch.name}</span>
                      <span className="w-px h-3 bg-slate-200 mx-1" />
                      <span className={`text-[12px] font-black tabular-nums ${theme.label}`}>{total}</span>
                      <span className="text-[9px] font-semibold text-slate-400 ml-0.5">uds</span>
                    </div>
                    <div className={`h-px flex-1 bg-gradient-to-l from-transparent ${branch.isVencidos ? 'to-rose-200/80' : 'to-slate-200/80'}`} />
                  </div>
                  <div
                    className="rounded-xl overflow-hidden backdrop-blur-sm shadow-sm"
                    style={{
                      background: branch.isVencidos ? 'rgba(255,241,242,0.60)' : 'rgba(255,255,255,0.30)',
                      border: branch.isVencidos ? '1px solid rgba(253,164,175,0.40)' : '1px solid rgba(255,255,255,0.60)',
                    }}
                  >
                    {prod.lots.length === 1 ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-[9px] font-mono text-slate-400 flex-1 truncate">{prod.lots[0].lote || '—'}</span>
                        <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                        <span className={`text-[10px] font-black shrink-0 tabular-nums w-14 text-right ${branch.isVencidos ? 'text-rose-600' : 'text-slate-700'}`}>{prod.lots[0].cantidad} uds</span>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/40">
                        {prod.lots.map((row, li) => (
                          <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-[9px] font-mono text-slate-400 flex-1 truncate min-w-0">{row.lote || '—'}</span>
                            <ExpiryBadge date={row.fecha_vencimiento} />
                            <span className={`text-[10px] font-black shrink-0 tabular-nums w-14 text-right ${branch.isVencidos ? 'text-rose-600' : 'text-slate-600'}`}>{row.cantidad} uds</span>
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

  /* ── SEARCH VIEW ─────────────────────────────────────────────────────────── */
  const hasResults   = results !== null && results.length > 0;
  const emptyResults = results !== null && results.length === 0;

  return (
    <div className="flex flex-col gap-2.5 h-full">

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
          placeholder="Buscar por nombre o principio activo..."
          className="w-full pl-8 pr-7 py-2 rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-sm text-[16px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 transition-all"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults(null); setDrillProduct(null); setSrsResults(null); setAlternatives([]); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {error && <p className="shrink-0 px-1 text-[11px] text-red-500 font-medium">{error}</p>}

      {/* Results area */}
      <div className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Skeleton */}
        {loading && <><SkeletonSection rows={3} /><SkeletonSection rows={2} /></>}

        {/* Initial state */}
        {!loading && results === null && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={28} strokeWidth={1.5} className="text-slate-200" />
            <p className="text-[11px] font-semibold text-slate-400 text-center leading-snug">
              Busca un producto para ver<br />su stock por sucursal
            </p>
          </div>
        )}

        {/* Normal results */}
        {!loading && hasResults && (
          <BranchSections
            branches={results}
            onDrill={setDrillProduct}
            onZoom={setLightboxUrl}
          />
        )}

        {/* Vencidos in bodega */}
        {!loading && results !== null && vencidosProds.length > 0 && (
          <div className="mt-1">
            <div className="flex items-center gap-2 mb-2 mt-1">
              <div className="h-px flex-1 bg-rose-200/60" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200/70 backdrop-blur-sm shadow-sm">
                <AlertTriangle size={9} className="text-rose-500 shrink-0" strokeWidth={2.5} />
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">Bodega · Área de Vencidos</span>
                <span className="w-px h-3 bg-rose-200 mx-1" />
                <span className="text-[12px] font-black tabular-nums text-rose-700">
                  {vencidosProds.reduce((s, p) => s + p.lots.reduce((ss, r) => ss + r.cantidad, 0), 0)}
                </span>
                <span className="text-[9px] font-semibold text-rose-400 ml-0.5">uds</span>
              </div>
              <div className="h-px flex-1 bg-rose-200/60" />
            </div>
            <div className="space-y-2">
              {vencidosProds.map((prod, pi) => {
                const lotTotal = prod.lots.reduce((s, r) => s + r.cantidad, 0);
                return (
                  <div
                    key={`${prod.descripcion}||${prod.presentacion}`}
                    className="flex items-center gap-2 px-2.5 py-2.5 rounded-xl text-left"
                    style={{ background: 'rgba(255,241,242,0.60)', border: '1px solid rgba(253,164,175,0.40)', boxShadow: '0 2px 8px rgba(225,29,72,0.05)', animationDelay: `${pi * 25}ms` }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-700 truncate leading-tight">{prod.descripcion}</p>
                      {prod.presentacion && <p className="text-[9px] text-slate-400">{prod.presentacion}</p>}
                      {prod.lots.length > 1 && (
                        <div className="mt-1 space-y-0.5">
                          {prod.lots.map((r, li) => (
                            <div key={li} className="flex items-center gap-1.5">
                              <span className="text-[8px] font-mono text-slate-400 truncate">{r.lote || '—'}</span>
                              <ExpiryBadge date={r.fecha_vencimiento} />
                              <span className="text-[9px] font-black text-rose-600 tabular-nums ml-auto">{r.cantidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {prod.lots.length === 1 && (
                      <>
                        <span className="text-[9px] font-mono text-slate-400 shrink-0 max-w-[55px] truncate">{prod.lots[0].lote || '—'}</span>
                        <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                      </>
                    )}
                    <span className="text-[10px] font-black text-rose-600 shrink-0 tabular-nums w-14 text-right">{lotTotal} uds</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No inventory results → SRS + alternatives */}
        {!loading && emptyResults && (
          <div className="flex flex-col gap-3">

            {/* No stock banner */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200/60">
              <Package size={13} className="text-amber-500 shrink-0" strokeWidth={2} />
              <p className="text-[11px] text-amber-700 font-semibold flex-1">
                Sin stock para <span className="font-black">"{query}"</span>
              </p>
            </div>

            {/* SRS loading */}
            {srsLoading && (
              <div className="flex items-center gap-2 px-1">
                <Loader2 size={11} className="text-violet-400 animate-spin shrink-0" />
                <p className="text-[10px] text-slate-400 font-medium">Consultando Registro SRS...</p>
              </div>
            )}

            {/* SRS results — each card has its own report button */}
            {!srsLoading && srsResults !== null && srsResults.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel icon={FlaskConical} label="Registro SRS" color="text-violet-600" bg="bg-violet-50" />
                {srsResults.map((p, i) => (
                  <SrsCompactCard key={p.id ?? i} product={p} searchQuery={query} user={user} />
                ))}
              </div>
            )}

            {/* Alternatives in inventory */}
            {!srsLoading && alternatives.length > 0 && (
              <div className="flex flex-col gap-1">
                <SectionLabel icon={Package} label="Alternativas en inventario" color="text-emerald-600" bg="bg-emerald-50" />
                <BranchSections
                  branches={alternatives}
                  onDrill={setDrillProduct}
                  onZoom={setLightboxUrl}
                  animOffset={4}
                />
              </div>
            )}

            {/* Nothing anywhere */}
            {!srsLoading && srsResults !== null && srsResults.length === 0 && alternatives.length === 0 && (
              <p className="text-center text-[11px] text-slate-400 font-medium py-4">
                Sin resultados en SRS ni alternativas en inventario
              </p>
            )}
          </div>
        )}
      </div>

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <style>{`@keyframes inv-fade-up{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
