import React, { useState, useEffect, useRef } from 'react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import { Loader2, ArrowLeft, CheckCircle2, Package, TrendingUp, Building2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import SearchInput from '../../components/common/SearchInput';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { smartFilter } from '../../utils/searchUtils';
import { notifyEmployees } from '../../utils/notify';
import {
    fetchProductPreciosForMinMax, fetchCurrentStockParams, insertMinMaxChangeRequest,
    fetchActiveProductsCount, fetchActiveProductsChunk,
} from '../../data/minmaxRequests';
import { ERP_NAMES } from '../productos/tabminmax/constants';
import { effectiveMinMax } from '../../data/stockParams';

// Presentación dominante (la "caja" más grande, factor>1) para mostrar equivalentes.
function dominantPres(pres) {
  const uniq = [...new Map((pres || []).map(p => [p.factor, p])).values()];
  return uniq.filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor)[0] || null;
}
// "≈ N CAJA" para un valor en unidades (ceil: la caja es indivisible).
function fmtEquiv(units, pres) {
  const d = dominantPres(pres);
  const n = Number(units);
  if (!d || !n) return null;
  return `≈ ${Math.ceil(n / d.factor)} ${(d.tipo || 'caja').trim()}`;
}

/* ── Form: propone min/max para un producto+sucursal ── */
function RequestForm({ product, erp, user, appendAuditLog, onBack, onSuccess }) {
  const [current, setCurrent]   = useState(null);   // { min, max } actuales
  const [loadingCur, setLoadingCur] = useState(false);
  const [mn, setMn]             = useState('');
  const [mx, setMx]             = useState('');
  const [reason, setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]           = useState('');
  const [pres, setPres]         = useState([]);   // presentaciones del producto (factor/tipo)

  // Presentaciones del producto (para mostrar el factor y el equivalente en cajas)
  useEffect(() => {
    let cancelled = false;
    fetchProductPreciosForMinMax(product.id)
      .then(({ data }) => {
        if (cancelled) return;
        setPres((data || [])
          .map(r => ({ tipo: r.presentaciones?.tipo, factor: r.factor, descripcion: r.descripcion }))
          .filter(p => p.factor));
      });
    return () => { cancelled = true; };
  }, [product.id]);
  const domPres = dominantPres(pres);

  // Carga el min/max efectivo actual (manual ?? calculado) al elegir sucursal
  useEffect(() => {
    if (!erp) { setCurrent(null); return; }
    let cancelled = false;
    setLoadingCur(true);
    fetchCurrentStockParams(product.id, erp)
      .then(({ data }) => {
        if (cancelled) return;
        setCurrent({
          min: effectiveMinMax(data?.min_units, data?.manual_min),
          max: effectiveMinMax(data?.max_units, data?.manual_max),
          sales6m: data?.units_sold_6m ?? null,
        });
        setLoadingCur(false);
      });
    return () => { cancelled = true; };
  }, [erp, product.id]);

  const submit = async () => {
    setErr('');
    if (!erp) { setErr('Elegí una sucursal'); return; }
    const newMin = mn === '' ? null : parseInt(mn, 10);
    const newMax = mx === '' ? null : parseInt(mx, 10);
    if (newMin === null || newMax === null) { setErr('Completá MIN y MAX'); return; }
    if (newMin < 0 || newMax < 0) { setErr('Los valores no pueden ser negativos'); return; }
    if (newMax <= newMin) { setErr('MAX debe ser mayor al MIN'); return; }

    setSubmitting(true);
    try {
      const { error } = await insertMinMaxChangeRequest({
        erp_product_id:    product.id,
        erp_sucursal_id:   Number(erp),
        product_name:      product.nombre,
        current_min:       current?.min ?? null,
        current_max:       current?.max ?? null,
        current_sales_6m:  current?.sales6m ?? null,
        requested_min:     newMin,
        requested_max:     newMax,
        reason:            reason.trim() || null,
        requested_by:      user?.email ?? '',
        requested_by_id:   user?.id ?? null,
        requested_by_name: user?.name ?? null,
      });
      if (error) throw error;

      await appendAuditLog('MINMAX_REQUEST_CREATED', String(product.id), {
        product: product.nombre, sucursal_id: Number(erp),
        requested_min: newMin, requested_max: newMax, reason: reason.trim() || null,
      });

      // Notificar al Supervisor de Ventas (o su jefe si está de vacaciones). No-fatal.
      try {
        const { data: ids } = await supabase.rpc('get_minmax_approver_ids');
        if (ids && ids.length) {
          await notifyEmployees(ids, {
            type: 'MINMAX_PENDING',
            title: '📊 Solicitud de ajuste Min/Max',
            body: `${user?.name || 'Un empleado'} propone MIN ${newMin} · MAX ${newMax} para ${product.nombre} (${ERP_NAMES[Number(erp)] || erp})`,
            link: '/minmax?tab=solicitudes',
            push: true,
          });
        }
      } catch { /* no-fatal */ }

      onSuccess();
    } catch (e) {
      setErr(e.message?.includes('row-level security')
        ? 'No tenés permiso para crear solicitudes (widget Ajuste de Min/Max).'
        : (e.message || 'Error al enviar'));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={onBack} />
        <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-surface-card-hover border border-divider flex items-center justify-center">
          {product.foto_url
            ? <img src={product.foto_url} alt="" className="w-full h-full object-contain" />
            : <Package size={16} className="text-content-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-black text-content truncate">{product.nombre}</p>
          {product.principio_activo && <p className="text-caption text-success-text font-semibold truncate">{product.principio_activo}</p>}
          <p className="text-caption text-content-3 truncate">
            {ERP_NAMES[Number(erp)] || 'Sucursal'}{product.laboratorio_nombre ? ` · ${product.laboratorio_nombre}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Actual + contexto de ventas */}
        {erp && (
          <div className="rounded-2xl border border-divider bg-surface-card-hover/60 px-3.5 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption font-black text-content-2 uppercase tracking-wider">En uso ahora</span>
              {loadingCur ? <Loader2 size={13} className="animate-spin text-content-3" /> : (
                <div className="text-right">
                  <span className="text-label font-bold text-content-2">
                    MIN <span className="text-chart-4-text">{current?.min ?? '—'}</span> · MAX <span className="text-chart-1-text">{current?.max ?? '—'}</span> <span className="text-content-3 font-medium">und</span>
                  </span>
                  {(fmtEquiv(current?.min, pres) || fmtEquiv(current?.max, pres)) && (
                    <div className="text-micro text-content-3 font-semibold">
                      {fmtEquiv(current?.min, pres) || '—'} · {fmtEquiv(current?.max, pres) || '—'}
                    </div>
                  )}
                </div>
              )}
            </div>
            {!loadingCur && (
              <div className="flex items-center justify-between border-t border-divider pt-1.5">
                <span className="text-caption font-black text-content-2 uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp size={11} className="text-success" /> Ventas 6 meses
                </span>
                <span className="text-label font-bold text-content-2 tabular-nums">
                  {current?.sales6m != null ? `${Number(current.sales6m).toLocaleString()} und` : 'Sin ventas'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Aviso: valores en unidades + factor de presentación */}
        <div className="flex items-start gap-2 rounded-xl bg-chart-1/10 border border-chart-1/30 px-3 py-2">
          <Package size={13} className="text-chart-1-text mt-0.5 shrink-0" />
          <div className="text-caption text-chart-1-text font-medium leading-snug">
            MIN y MAX se ingresan en <b>unidades</b>.
            {domPres && <> <b>{domPres.factor} und = 1 {domPres.tipo?.trim() || 'caja'}</b>.</>}
            {domPres?.descripcion && <div className="text-micro text-chart-1-text/80 mt-0.5">Factor calculado: {domPres.descripcion}</div>}
          </div>
        </div>

        {/* Nuevos valores */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-caption font-black text-chart-4-text uppercase tracking-widest px-1">Nuevo MIN (und) *</label>
            <input type="number" min="0" value={mn} onChange={e => { setMn(e.target.value); setErr(''); }}
 className="w-full text-right text-body-xl font-bold text-chart-4-text bg-chart-4/10 border border-chart-4/30 rounded-xl px-3 py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption font-black text-chart-1-text uppercase tracking-widest px-1">Nuevo MAX (und) *</label>
            <input type="number" min="0" value={mx} onChange={e => { setMx(e.target.value); setErr(''); }}
 className="w-full text-right text-body-xl font-bold text-chart-1-text bg-chart-1/10 border border-chart-1/30 rounded-xl px-3 py-2" />
          </div>
        </div>

        {/* Motivo */}
        <div className="flex flex-col gap-1.5">
          <label className="text-caption font-black text-content-3 uppercase tracking-widest px-1">Motivo</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="¿Por qué este ajuste? (opcional)"
 className="w-full px-3.5 py-2.5 rounded-2xl border border-divider bg-surface-card text-body-xl font-medium text-content-2 placeholder-content-3 focus:border-brand resize-none" />
        </div>

        {err && <p className="text-label text-danger-text font-semibold px-1">{err}</p>}

        <Button disabled={submitting} onClick={submit}>{submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando…' : 'Enviar a aprobación'}</Button>
      </div>
    </div>
  );
}

/* ── Main: busca producto → formulario ── */
export default function WidgetMinMaxRequest({ selectedErp = null }) {
  const { user }       = useAuth();
  const appendAuditLog = useStaffStore(s => s.appendAuditLog);

  const [view, setView]       = useState('search'); // search | form | success
  const [search, setSearch]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked]   = useState(null);
  const allProdsRef = useRef([]);
  // Estado (no ref) — B-9: si el catálogo terminaba de cargar DESPUÉS de que el
  // usuario ya había tipeado, el efecto de abajo (dependiente solo de [search])
  // no se volvía a disparar y los resultados quedaban vacíos hasta la próxima tecla.
  const [catalogReady, setCatalogReady] = useState(false);

  // Preload full product catalog on mount (paginated — products > 1000)
  useEffect(() => {
    async function loadCatalog() {
      setLoading(true);
      const CHUNK = 1000;
      const { count } = await fetchActiveProductsCount();
      const numChunks = Math.max(1, Math.ceil((count || 0) / CHUNK));
      const chunks = await Promise.all(
        Array.from({ length: numChunks }, (_, i) =>
          fetchActiveProductsChunk(i * CHUNK, (i + 1) * CHUNK - 1)
        )
      );
      allProdsRef.current = chunks
        .flatMap(r => r.data || [])
        .map(p => ({ ...p, laboratorio_nombre: p.laboratorios?.nombre ?? null }));
      setCatalogReady(true);
      setLoading(false);
    }
    loadCatalog();
  }, []);

  useEffect(() => {
    if (!catalogReady) return;
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia resultados cuando la búsqueda es muy corta
    const { results: matched } = smartFilter(q, allProdsRef.current, p => [
      p.nombre,
      p.principio_activo ?? '',
      p.laboratorio_nombre ?? '',
    ]);
    setResults(matched.slice(0, 20));
  }, [search, catalogReady]);

  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-success" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-body-lg font-black text-content">Solicitud enviada</p>
          <p className="text-body-sm text-content-3 mt-1">El supervisor fue notificado para aprobarla.</p>
        </div>
      </div>
    );
  }

  if (view === 'form' && picked) {
    return (
      <RequestForm
        product={picked} erp={selectedErp} user={user} appendAuditLog={appendAuditLog}
        onBack={() => { setView('search'); setPicked(null); }}
        onSuccess={() => { setView('success'); setTimeout(() => { setView('search'); setPicked(null); setSearch(''); setResults([]); }, 2600); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-end gap-1.5 shrink-0">
        <SearchInput expandable accentColor="var(--warning)" value={search} onChange={setSearch} placeholder="Buscar producto para ajustar Min/Max…" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

        {!loading && search.trim().length >= 2 && results.length === 0 && (
          <div className="py-8 text-center text-body-sm text-content-3 font-medium">Sin resultados para "{search}"</div>
        )}

        {!loading && search.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3">
            <TrendingUp size={28} strokeWidth={1.5} />
            <p className="text-body-sm font-semibold text-content-3 text-center px-4">Buscá un producto para proponer un ajuste de mínimo/máximo</p>
          </div>
        )}

        {!loading && results.map(p => (
          <ListRow
            key={p.id}
            onClick={() => { setPicked(p); setView('form'); }}
            leading={p.foto_url
              ? <img src={p.foto_url} alt="" className="w-full h-full object-contain" />
              : <Package size={14} className="text-content-3" strokeWidth={2} />}
            iconBoxClass="bg-surface-card-hover border-border-card overflow-hidden"
            className="border-divider bg-surface-card hover:border-brand/40"
            title={p.nombre}
            trailing={<Building2 size={12} className="text-content-3" />}
          >
            {p.principio_activo && <span className="block text-micro text-success-text font-semibold truncate">{p.principio_activo}</span>}
            {p.laboratorio_nombre && <span className="block text-micro text-content-3 truncate">{p.laboratorio_nombre}</span>}
          </ListRow>
        ))}
      </div>
    </div>
  );
}
