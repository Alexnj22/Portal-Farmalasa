import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Loader2, X, ArrowLeft, CheckCircle2, Package, TrendingUp, Building2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

// ERP sucursal ids ↔ nombre (igual que TabMinMax). product_stock_params usa erp_sucursal_id.
const ERP_NAMES = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

/* ── Form: propone min/max para un producto+sucursal ── */
function RequestForm({ product, erp, user, appendAuditLog, onBack, onSuccess }) {
  const [current, setCurrent]   = useState(null);   // { min, max } actuales
  const [loadingCur, setLoadingCur] = useState(false);
  const [mn, setMn]             = useState('');
  const [mx, setMx]             = useState('');
  const [reason, setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]           = useState('');

  // Carga el min/max efectivo actual (manual ?? calculado) al elegir sucursal
  useEffect(() => {
    if (!erp) { setCurrent(null); return; }
    let cancelled = false;
    setLoadingCur(true);
    supabase.from('product_stock_params')
      .select('manual_min, manual_max, min_units, max_units, units_sold_6m')
      .eq('erp_product_id', product.id)
      .eq('erp_sucursal_id', Number(erp))
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCurrent({
          min: data?.manual_min ?? data?.min_units ?? null,
          max: data?.manual_max ?? data?.max_units ?? null,
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
      const { error } = await supabase.from('minmax_change_requests').insert({
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

      // Notificar a los aprobadores (can_approve en minmax). No-fatal.
      try {
        const { data: roles } = await supabase.from('role_permissions')
          .select('role_id').eq('module_key', 'minmax').eq('can_approve', true);
        const roleIds = (roles || []).map(r => r.role_id).filter(Boolean);
        if (roleIds.length) {
          const { data: emps } = await supabase.from('employees')
            .select('id').in('role_id', roleIds).eq('status', 'ACTIVO');
          const ids = (emps || []).map(e => e.id);
          if (ids.length) {
            await supabase.functions.invoke('send-push-notification', {
              body: {
                title: '📊 Solicitud de ajuste Min/Max',
                message: `${user?.name || 'Un colaborador'} propone MIN ${newMin} · MAX ${newMax} para ${product.nombre} (${ERP_NAMES[Number(erp)] || erp})`,
                url: '/minmax',
                target_type: 'EMPLOYEE',
                target_value: ids,
              },
            });
          }
        }
      } catch { /* push no-fatal */ }

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
        <button onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors shrink-0">
          <ArrowLeft size={13} strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-slate-800 truncate">{product.nombre}</p>
          <p className="text-[10px] text-slate-400 truncate">
            {ERP_NAMES[Number(erp)] || 'Sucursal'}{product.laboratorio_nombre ? ` · ${product.laboratorio_nombre}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Actual + contexto de ventas */}
        {erp && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">En uso ahora</span>
              {loadingCur ? <Loader2 size={13} className="animate-spin text-slate-300" /> : (
                <span className="text-[11px] font-bold text-slate-600">
                  MIN <span className="text-orange-500">{current?.min ?? '—'}</span> · MAX <span className="text-blue-500">{current?.max ?? '—'}</span>
                </span>
              )}
            </div>
            {!loadingCur && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp size={11} className="text-emerald-500" /> Ventas 6 meses
                </span>
                <span className="text-[11px] font-bold text-slate-700 tabular-nums">
                  {current?.sales6m != null ? `${Number(current.sales6m).toLocaleString()} und` : 'Sin ventas'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Nuevos valores */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-orange-500 uppercase tracking-widest px-1">Nuevo MIN *</label>
            <input type="number" min="0" value={mn} onChange={e => { setMn(e.target.value); setErr(''); }}
              className="w-full text-right text-[13px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-300" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest px-1">Nuevo MAX *</label>
            <input type="number" min="0" value={mx} onChange={e => { setMx(e.target.value); setErr(''); }}
              className="w-full text-right text-[13px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
        </div>

        {/* Motivo */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Motivo</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="¿Por qué este ajuste? (opcional)"
            className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10 resize-none" />
        </div>

        {err && <p className="text-[11px] text-red-500 font-semibold px-1">{err}</p>}

        <button onClick={submit} disabled={submitting}
          className="w-full py-2.5 rounded-2xl bg-[#0052CC] text-white text-[12px] font-black uppercase tracking-widest hover:bg-[#003d99] disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando…' : 'Enviar a aprobación'}
        </button>
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
  const debRef = useRef();

  const runSearch = useCallback((q) => {
    if (!q || q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    supabase.from('products')
      .select('id, nombre, laboratorio_id, laboratorios(nombre)')
      .eq('activo', true)
      .ilike('nombre', `%${q.trim()}%`)
      .order('nombre')
      .limit(20)
      .then(({ data }) => {
        setResults((data || []).map(p => ({ ...p, laboratorio_nombre: p.laboratorios?.nombre ?? null })));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => runSearch(search), 300);
    return () => clearTimeout(debRef.current);
  }, [search, runSearch]);

  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-emerald-500" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-[14px] font-black text-slate-800">Solicitud enviada</p>
          <p className="text-[12px] text-slate-500 mt-1">El supervisor fue notificado para aprobarla.</p>
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
      <div className="relative shrink-0">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto para ajustar Min/Max…"
          className="w-full pl-9 pr-8 py-2 rounded-2xl border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#0052CC] focus:ring-2 focus:ring-[#0052CC]/10"
          spellCheck={false} />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>}

        {!loading && search.trim().length >= 2 && results.length === 0 && (
          <div className="py-8 text-center text-[12px] text-slate-400 font-medium">Sin resultados para "{search}"</div>
        )}

        {!loading && search.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300">
            <TrendingUp size={28} strokeWidth={1.5} />
            <p className="text-[12px] font-semibold text-slate-400 text-center px-4">Buscá un producto para proponer un ajuste de mínimo/máximo</p>
          </div>
        )}

        {!loading && results.map(p => (
          <button key={p.id} onClick={() => { setPicked(p); setView('form'); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl border border-slate-100 bg-white hover:border-[#0052CC]/40 transition-colors text-left">
            <Package size={14} className="text-slate-300 shrink-0" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-slate-800 truncate leading-tight">{p.nombre}</p>
              {p.laboratorio_nombre && <p className="text-[9px] text-slate-400 truncate">{p.laboratorio_nombre}</p>}
            </div>
            <Building2 size={12} className="text-slate-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
