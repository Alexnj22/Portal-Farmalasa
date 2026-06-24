import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Truck, ChevronUp, ChevronDown, MapPin, User, Package, Clock, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import PedidoModal from './PedidoModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import { optimizeRoute, totalRoute, BODEGA_SUC_ID } from '../../utils/routeOptimizer';

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtMin(min) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export default function CrearRutaModal({ open, onClose, onCreated }) {
  const { user } = useAuth();

  const [step, setStep] = useState(1);

  // Step 1 data
  const [empleados,       setEmpleados]       = useState([]);
  const [pedidosDisp,     setPedidosDisp]     = useState([]);
  const [coordsMap,       setCoordsMap]       = useState({});   // erp_sucursal_id → {lat, lng}
  const [bodegaCoords,    setBodegaCoords]    = useState(null);
  const [loadingData,     setLoadingData]     = useState(true);

  // Step 1 selections
  const [conductorId,     setConductorId]     = useState('');
  const [selected,        setSelected]        = useState(new Set()); // "pedidoId__sucId"

  // Step 2
  const [paradas,         setParadas]         = useState([]); // ordered stops
  const [optimizing,      setOptimizing]      = useState(false);

  // Submit
  const [submitting,      setSubmitting]      = useState(false);

  // ── Load data on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected(new Set());
    setConductorId('');
    setParadas([]);
    setLoadingData(true);

    Promise.all([
      // Empleados activos con acceso al sistema
      supabase.from('employees')
        .select('id, first_names, last_names, system_role')
        .not('system_role', 'is', null)
        .eq('status', 'ACTIVO')
        .order('first_names'),

      // Pedidos confirmados disponibles (no enviados ni en ruta)
      supabase.from('pedidos')
        .select(`
          id, numero,
          pedido_sucursal_status (
            erp_sucursal_id, total_cajas, cajas_electrolit,
            erp_sucursal_map!inner ( branch:branches!inner ( name ) )
          )
        `)
        .eq('status', 'confirmado')
        .order('numero'),

      // Coordenadas de todas las sucursales
      supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, es_bodega, branch:branches!inner(settings)')
        .order('erp_sucursal_id'),
    ]).then(([empRes, pedRes, coordRes]) => {
      // Empleados
      const emps = (empRes.data ?? []);
      setEmpleados(emps);

      // Pedidos disponibles — aplanar a items individuales (pedido × sucursal)
      const items = [];
      for (const p of (pedRes.data ?? [])) {
        for (const pss of (p.pedido_sucursal_status ?? [])) {
          const sucName = pss.erp_sucursal_map?.branch?.name ?? `Suc. ${pss.erp_sucursal_id}`;
          items.push({
            key: `${p.id}__${pss.erp_sucursal_id}`,
            pedido_id:       p.id,
            numero:          p.numero,
            erp_sucursal_id: pss.erp_sucursal_id,
            suc_name:        sucName,
            total_cajas:     pss.total_cajas   ?? 0,
            cajas_electrolit: pss.cajas_electrolit ?? 0,
          });
        }
      }
      setPedidosDisp(items);

      // Coordenadas
      const cm = {};
      let bodega = null;
      for (const row of (coordRes.data ?? [])) {
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
      setLoadingData(false);
    });
  }, [open]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const conductorOpts = useMemo(() =>
    empleados.map(e => ({
      value: e.id,
      label: `${e.first_names} ${e.last_names}`.trim(),
    }))
  , [empleados]);

  const conductorNombre = useMemo(() => {
    const emp = empleados.find(e => e.id === conductorId);
    return emp ? `${emp.first_names} ${emp.last_names}`.trim() : '';
  }, [empleados, conductorId]);

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

  // ── Step 1 → 2: optimize ──────────────────────────────────────────────────
  const handleOptimize = useCallback(() => {
    if (!selectedItems.length || !conductorId) return;
    setOptimizing(true);

    // Unique sucursales in selected
    const sucMap = new Map();
    for (const item of selectedItems) {
      if (!sucMap.has(item.erp_sucursal_id)) {
        sucMap.set(item.erp_sucursal_id, {
          erp_sucursal_id: item.erp_sucursal_id,
          suc_name:        item.suc_name,
          lat: coordsMap[item.erp_sucursal_id]?.lat,
          lng: coordsMap[item.erp_sucursal_id]?.lng,
          items: [],
        });
      }
      sucMap.get(item.erp_sucursal_id).items.push(item);
    }

    const uniqueStops = [...sucMap.values()];
    const bodega = bodegaCoords ?? { lat: 14.041177, lng: -88.963111 };

    const stopsWithCoords = uniqueStops.filter(s => s.lat && s.lng);
    const stopsNoCoords   = uniqueStops.filter(s => !s.lat || !s.lng);

    const optimized = optimizeRoute(stopsWithCoords, bodega);

    // Append stops without coords at the end
    const allOrdered = [
      ...optimized,
      ...stopsNoCoords.map((s, i) => ({
        ...s,
        orden: optimized.length + i + 1,
        dist_m: null,
        dur_min: null,
      })),
    ];

    setParadas(allOrdered);
    setOptimizing(false);
    setStep(2);
  }, [selectedItems, conductorId, coordsMap, bodegaCoords]);

  // ── Reorder stops ──────────────────────────────────────────────────────────
  const moveStop = useCallback((idx, dir) => {
    setParadas(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((s, i) => ({ ...s, orden: i + 1 }));
    });
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!conductorId || !paradas.length || submitting) return;
    setSubmitting(true);
    try {
      // Build paradas array for RPC (flatten sucursales → individual pedidos)
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
        p_conductor_id:      conductorId,
        p_conductor_nombre:  conductorNombre,
        p_paradas:           rpcParadas,
        p_distancia_total_m: totals.dist_m || null,
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
        const branchQuery = await supabase
          .from('erp_sucursal_map')
          .select('branch_id')
          .eq('erp_sucursal_id', stop.erp_sucursal_id)
          .maybeSingle();
        const branchId = branchQuery.data?.branch_id;
        if (!branchId) continue;

        const numeros = stop.items.map(i => `#${i.numero}`).join(', ');
        const totalCajas = stop.items.reduce((s, i) => s + (i.total_cajas ?? 0), 0);
        const cajasStr = totalCajas ? ` en ${totalCajas} caja${totalCajas !== 1 ? 's' : ''}` : '';

        supabase.from('announcements').insert({
          title:        `Pedido ${numeros} en camino`,
          message:      `Tu${stop.items.length > 1 ? 's pedidos' : ' pedido'} ${numeros} sal${stop.items.length > 1 ? 'ieron' : 'ió'} de bodega${cajasStr} con ${conductorNombre}. Prepárate para recibirlo.`,
          target_type:  'BRANCH',
          target_value: [branchId],
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
            target_value: [branchId],
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
  }, [conductorId, conductorNombre, paradas, submitting, user, onCreated, onClose]);

  if (!open) return null;

  const totals = totalRoute(paradas.filter(s => s.dist_m != null));
  const canOptimize = !!conductorId && selectedItems.length > 0;

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
                {step === 1 ? 'Nueva Ruta de Entrega' : 'Revisar y confirmar ruta'}
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
            {/* Conductor */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1.5">
                <User size={10} />Conductor
              </label>
              <LiquidSelect
                options={conductorOpts}
                value={conductorId}
                onChange={setConductorId}
                placeholder="Seleccionar conductor…"
                compact
                clearable={false}
              />
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
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {pedidosDisp.map(item => {
                    const isSelected = selected.has(item.key);
                    return (
                      <button
                        key={item.key}
                        onClick={() => toggleItem(item.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                        }`}>
                          {isSelected && <CheckCircle2 size={10} className="text-white" strokeWidth={3} />}
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
            {/* Resumen totales */}
            {totals.dist_m > 0 && (
              <div className="flex gap-3">
                <div className="flex-1 bg-indigo-50 rounded-xl p-3 border border-indigo-100 text-center">
                  <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wider mb-0.5">Distancia total</p>
                  <p className="text-[18px] font-black text-indigo-700">{fmtDist(totals.dist_m)}</p>
                  <p className="text-[9px] text-indigo-400">linea recta estimada</p>
                </div>
                <div className="flex-1 bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Tiempo estimado</p>
                  <p className="text-[18px] font-black text-slate-700">{fmtMin(totals.dur_min)}</p>
                  <p className="text-[9px] text-slate-400">promedio 40 km/h</p>
                </div>
              </div>
            )}

            {/* Conductor */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200">
              <User size={13} className="text-indigo-500 shrink-0" />
              <span className="text-[12px] text-slate-600 font-medium">Conductor:</span>
              <span className="text-[12px] font-bold text-slate-800">{conductorNombre}</span>
            </div>

            {/* Paradas ordenadas */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Orden de entrega</p>
              <div className="space-y-1.5">
                {paradas.map((stop, idx) => (
                  <div key={stop.erp_sucursal_id} className="flex items-center gap-2">
                    {/* Reorder arrows */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveStop(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => moveStop(idx, 1)}
                        disabled={idx === paradas.length - 1}
                        className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-colors"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>

                    {/* Stop card */}
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
                Usa las flechas para cambiar el orden manualmente. Las distancias son aproximadas (línea recta).
              </p>
            </div>
          </>
        )}
      </PedidoModal.Body>

      <PedidoModal.Footer className="flex justify-between gap-2">
        {step === 1 ? (
          <>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleOptimize}
              disabled={!canOptimize || optimizing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {optimizing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Ver ruta optimizada
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors"
            >
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
