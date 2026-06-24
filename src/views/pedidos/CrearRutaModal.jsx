import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Truck, ChevronUp, ChevronDown, MapPin, User, Package, Clock, ArrowRight, CheckCircle2, Loader2, Navigation } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import PedidoModal from './PedidoModal';
import { optimizeRoute, optimizeRouteGoogleMaps, totalRoute } from '../../utils/routeOptimizer';

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtMin(min) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export default function CrearRutaModal({ open, onClose, onCreated }) {
  const { user } = useAuth();

  const [step, setStep] = useState(1);

  // Data
  const [conductorNombre, setConductorNombre] = useState('');
  const [pedidosDisp,     setPedidosDisp]     = useState([]);
  const [coordsMap,       setCoordsMap]       = useState({});
  const [bodegaCoords,    setBodegaCoords]    = useState(null);
  const [loadingData,     setLoadingData]     = useState(true);

  // Step 1 selections
  const [selected, setSelected] = useState(new Set()); // "pedidoId__sucId"

  // Step 2
  const [paradas,    setParadas]    = useState([]);
  const [optimizing, setOptimizing] = useState(false);
  const [mapsMode,   setMapsMode]   = useState(false); // true = Google Maps API used

  // Submit
  const [submitting, setSubmitting] = useState(false);

  // ── Load data on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected(new Set());
    setParadas([]);
    setLoadingData(true);

    // Get conductor name from current user
    if (user?.id) {
      supabase.from('employees')
        .select('first_names, last_names')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setConductorNombre(data ? `${data.first_names} ${data.last_names}`.trim() : (user.email ?? 'Usuario'));
        });
    }

    Promise.all([
      // Pedidos confirmados (tabla principal, sin join PSS anidado)
      supabase.from('pedidos')
        .select('id, numero')
        .eq('status', 'confirmado')
        .order('numero'),

      // PSS con finalizado_at (stage 'preparado') — evitar join anidado erp_sucursal_map dentro de PSS
      supabase.from('pedido_sucursal_status')
        .select('pedido_id, erp_sucursal_id, total_cajas, cajas_electrolit, finalizado_at')
        .not('finalizado_at', 'is', null),

      // Sucursales: coordenadas + nombre (query separada)
      supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, es_bodega, branch:branches!inner(settings, name)')
        .order('erp_sucursal_id'),
    ]).then(([pedRes, pssRes, coordRes]) => {
      // Mapa de pedidos confirmados
      const pedidoMap = {};
      for (const p of (pedRes.data ?? [])) pedidoMap[p.id] = p;

      // Mapa de sucursal → nombre
      const sucNameMap = {};
      const cm = {};
      let bodega = null;
      for (const row of (coordRes.data ?? [])) {
        sucNameMap[row.erp_sucursal_id] = row.branch?.name ?? `Suc. ${row.erp_sucursal_id}`;
        const loc = row.branch?.settings?.location ?? {};
        const lat = parseFloat(loc.lat);
        const lng = parseFloat(loc.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          cm[row.erp_sucursal_id] = { lat, lng };
          if (row.es_bodega) bodega = { lat, lng };
        }
      }
      setCoordsMap(cm);
      setBodegaCoords(bodega);

      // Aplanar: PSS preparado cuyo pedido sigue confirmado
      const items = [];
      for (const pss of (pssRes.data ?? [])) {
        const p = pedidoMap[pss.pedido_id];
        if (!p) continue; // pedido ya no está confirmado
        items.push({
          key:              `${p.id}__${pss.erp_sucursal_id}`,
          pedido_id:        p.id,
          numero:           p.numero,
          erp_sucursal_id:  pss.erp_sucursal_id,
          suc_name:         sucNameMap[pss.erp_sucursal_id] ?? `Suc. ${pss.erp_sucursal_id}`,
          total_cajas:      pss.total_cajas     ?? 0,
          cajas_electrolit: pss.cajas_electrolit ?? 0,
        });
      }
      setPedidosDisp(items);
      setLoadingData(false);
    });
  }, [open, user?.id]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedItems = useMemo(() =>
    pedidosDisp.filter(p => selected.has(p.key))
  , [pedidosDisp, selected]);

  const toggleItem = useCallback((key) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === pedidosDisp.length) setSelected(new Set());
    else setSelected(new Set(pedidosDisp.map(p => p.key)));
  }, [pedidosDisp, selected.size]);

  // ── Step 1 → 2: optimize with Google Maps (once) ─────────────────────────
  const handleOptimize = useCallback(async () => {
    if (!selectedItems.length) return;
    setOptimizing(true);

    // Group by sucursal
    const sucMap = new Map();
    for (const item of selectedItems) {
      if (!sucMap.has(item.erp_sucursal_id)) {
        sucMap.set(item.erp_sucursal_id, {
          erp_sucursal_id: item.erp_sucursal_id,
          suc_name:        item.suc_name,
          lat:             coordsMap[item.erp_sucursal_id]?.lat,
          lng:             coordsMap[item.erp_sucursal_id]?.lng,
          items:           [],
        });
      }
      sucMap.get(item.erp_sucursal_id).items.push(item);
    }

    const stopsWithCoords = [...sucMap.values()].filter(s => s.lat && s.lng);
    const stopsNoCoords   = [...sucMap.values()].filter(s => !s.lat || !s.lng);
    const bodega = bodegaCoords ?? { lat: 14.041177, lng: -88.963111 };

    let optimized;
    let usedMaps = false;
    try {
      // Intenta con Google Maps Distance Matrix API (calcula distancias reales una sola vez)
      optimized = await optimizeRouteGoogleMaps(stopsWithCoords, bodega);
      usedMaps = true;
    } catch {
      // Fallback a Haversine si Maps falla
      optimized = optimizeRoute(stopsWithCoords, bodega);
    }

    const allOrdered = [
      ...optimized,
      ...stopsNoCoords.map((s, i) => ({
        ...s, orden: optimized.length + i + 1, dist_m: null, dur_min: null,
      })),
    ];

    setParadas(allOrdered);
    setMapsMode(usedMaps);
    setOptimizing(false);
    setStep(2);
  }, [selectedItems, coordsMap, bodegaCoords]);

  // ── Reorder (manual override) ──────────────────────────────────────────────
  const moveStop = useCallback((idx, dir) => {
    setParadas(prev => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next.map((s, i) => ({ ...s, orden: i + 1 }));
    });
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!paradas.length || submitting) return;
    setSubmitting(true);
    try {
      const rpcParadas = paradas.flatMap(stop =>
        stop.items.map(item => ({
          pedido_id:       item.pedido_id,
          erp_sucursal_id: item.erp_sucursal_id,
          orden_entrega:   stop.orden,
          dist_m:          stop.dist_m  ?? null,
          dur_min:         stop.dur_min ?? null,
        }))
      );

      const totals = totalRoute(paradas.filter(s => s.dist_m != null));

      const { data: rutaId, error } = await supabase.rpc('crear_ruta', {
        p_conductor_id:      user?.id ?? null,
        p_conductor_nombre:  conductorNombre,
        p_paradas:           rpcParadas,
        p_distancia_total_m: totals.dist_m  || null,
        p_duracion_min:      totals.dur_min || null,
        p_creado_por:        user?.id ?? null,
      });
      if (error) throw error;

      useStaff.getState().appendAuditLog('RUTA_CREADA', rutaId, {
        conductor: conductorNombre,
        paradas:   rpcParadas.length,
      });

      // Notificaciones a cada sucursal
      for (const stop of paradas) {
        const { data: mapa } = await supabase
          .from('erp_sucursal_map')
          .select('branch_id')
          .eq('erp_sucursal_id', stop.erp_sucursal_id)
          .maybeSingle();
        if (!mapa?.branch_id) continue;

        const numeros    = stop.items.map(i => `#${i.numero}`).join(', ');
        const totalCajas = stop.items.reduce((s, i) => s + (i.total_cajas ?? 0), 0);
        const cajasStr   = totalCajas ? ` en ${totalCajas} caja${totalCajas !== 1 ? 's' : ''}` : '';

        supabase.from('announcements').insert({
          title:        `Pedido ${numeros} en camino`,
          message:      `Tu pedido ${numeros} salió de bodega${cajasStr} con ${conductorNombre}.`,
          target_type:  'BRANCH',
          target_value: [mapa.branch_id],
          read_by:      [],
          is_archived:  false,
          created_by:   user?.id ?? null,
          priority:     'NORMAL',
        }).catch(() => {});

        supabase.functions.invoke('send-push-notification', {
          body: {
            title:        `Pedido ${numeros} en camino`,
            message:      `Tu pedido ya salió de bodega${cajasStr}. Prepárate para recibirlo.`,
            url:          '/pedidos',
            target_type:  'BRANCH',
            target_value: [mapa.branch_id],
          },
        }).catch(() => {});
      }

      onCreated?.();
      onClose();
    } catch (e) {
      console.error('crear_ruta error:', e);
    } finally {
      setSubmitting(false);
    }
  }, [conductorNombre, paradas, submitting, user, onCreated, onClose]);

  if (!open) return null;

  const totals = totalRoute(paradas.filter(s => s.dist_m != null));

  return (
    <PedidoModal open onClose={onClose} maxWidth="max-w-lg">
      <PedidoModal.Header className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <Truck size={16} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">
                {step === 1 ? 'Paso 1 de 2' : 'Paso 2 de 2'}
              </p>
              <h3 className="text-[16px] font-black text-slate-800 leading-tight">
                {step === 1 ? 'Nueva Ruta de Entrega' : 'Confirmar ruta'}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>
      </PedidoModal.Header>

      <PedidoModal.Body className="px-5 py-4 space-y-5">
        {loadingData ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : step === 1 ? (
          <>
            {/* Conductor (auto = usuario actual) */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                <User size={13} className="text-white" />
              </div>
              <div>
                <p className="text-[9px] font-semibold text-indigo-400 uppercase tracking-wider">Conductor (tú)</p>
                <p className="text-[12px] font-bold text-indigo-800">{conductorNombre || '…'}</p>
              </div>
            </div>

            {/* Pedidos disponibles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Package size={10} />Pedidos a incluir
                </label>
                {pedidosDisp.length > 0 && (
                  <button
                    onClick={toggleAll}
                    className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors"
                  >
                    {selected.size === pedidosDisp.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                )}
              </div>

              {pedidosDisp.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-[12px]">
                  No hay pedidos confirmados disponibles para despachar.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {pedidosDisp.map(item => {
                    const isSel = selected.has(item.key);
                    return (
                      <button
                        key={item.key}
                        onClick={() => toggleItem(item.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          isSel ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                        }`}>
                          {isSel && <CheckCircle2 size={10} className="text-white" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-slate-700">#{item.numero}</span>
                            <span className="text-[11px] text-slate-500 font-medium">— {item.suc_name}</span>
                          </div>
                          {item.total_cajas > 0 && (
                            <span className="text-[10px] text-slate-400">
                              {item.total_cajas} caja{item.total_cajas !== 1 ? 's' : ''}
                              {item.cajas_electrolit > 0 && ` · ${item.cajas_electrolit} Electrolit`}
                            </span>
                          )}
                        </div>
                        <MapPin size={12} className={coordsMap[item.erp_sucursal_id] ? 'text-emerald-400' : 'text-slate-300'} />
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedItems.length > 0 && (
                <p className="text-[10px] text-indigo-600 font-semibold mt-2">
                  {selectedItems.length} pedido{selectedItems.length !== 1 ? 's' : ''} seleccionado{selectedItems.length !== 1 ? 's' : ''}
                  {' · '}{selectedItems.reduce((s, i) => s + (i.total_cajas ?? 0), 0)} cajas en total
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Totales */}
            {totals.dist_m > 0 && (
              <div className="flex gap-3">
                <div className="flex-1 bg-indigo-50 rounded-xl p-3 border border-indigo-100 text-center">
                  <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wider mb-0.5">Distancia total</p>
                  <p className="text-[18px] font-black text-indigo-700">{fmtDist(totals.dist_m)}</p>
                  <p className="text-[9px] text-indigo-400 flex items-center justify-center gap-1">
                    {mapsMode ? <><Navigation size={8} />Google Maps</> : 'línea recta estimada'}
                  </p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Tiempo estimado</p>
                  <p className="text-[18px] font-black text-slate-700">{fmtMin(totals.dur_min)}</p>
                  <p className="text-[9px] text-slate-400">por carretera</p>
                </div>
              </div>
            )}

            {/* Conductor chip */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200">
              <User size={13} className="text-indigo-500 shrink-0" />
              <span className="text-[12px] text-slate-600 font-medium">Conductor:</span>
              <span className="text-[12px] font-bold text-slate-800">{conductorNombre}</span>
            </div>

            {/* Paradas */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Orden de entrega</p>
              <div className="space-y-1.5">
                {paradas.map((stop, idx) => (
                  <div key={stop.erp_sucursal_id} className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => moveStop(idx, -1)} disabled={idx === 0}
                        className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors">
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => moveStop(idx, 1)} disabled={idx === paradas.length - 1}
                        className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors">
                        <ChevronDown size={13} />
                      </button>
                    </div>

                    <div className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                            {stop.orden}
                          </span>
                          <div>
                            <p className="text-[12px] font-bold text-slate-800">{stop.suc_name}</p>
                            <p className="text-[10px] text-slate-400">
                              {stop.items.map(i => `#${i.numero}`).join(', ')}
                              {' · '}{stop.items.reduce((s, i) => s + (i.total_cajas ?? 0), 0)} cajas
                            </p>
                          </div>
                        </div>
                        {stop.dist_m != null && (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-bold text-slate-600">{fmtDist(stop.dist_m)}</p>
                            <p className="text-[9px] text-slate-400 flex items-center gap-0.5 justify-end">
                              <Clock size={8} />{fmtMin(stop.dur_min)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-400 mt-2 ml-7">
                Reordena con las flechas si necesitas cambiar el orden.
              </p>
            </div>
          </>
        )}
      </PedidoModal.Body>

      <PedidoModal.Footer className="flex justify-between gap-2">
        {step === 1 ? (
          <>
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleOptimize}
              disabled={selectedItems.length === 0 || optimizing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {optimizing
                ? <><Loader2 size={14} className="animate-spin" />Calculando ruta…</>
                : <><ArrowRight size={14} />Ver ruta optimizada</>
              }
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setStep(1)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors">
              ← Atrás
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              Crear Ruta
            </button>
          </>
        )}
      </PedidoModal.Footer>
    </PedidoModal>
  );
}
