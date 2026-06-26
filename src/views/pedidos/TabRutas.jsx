import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, MapPin, CheckCircle2, Clock, AlertTriangle, Home, Play, Plus, Loader2, ChevronDown, ChevronUp, Navigation, Map } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { tokenMatch } from '../../utils/searchUtils';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import CrearRutaModal from './CrearRutaModal';
import RutaMapModal   from './RutaMapModal';

const STATUS_BADGE = {
  pendiente:    { label: 'Pendiente',     cls: 'bg-amber-100  text-amber-700  border-amber-200'  },
  en_ruta:      { label: 'En ruta',       cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  completada:   { label: 'Completada',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  con_alerta:   { label: 'Con alerta',    cls: 'bg-rose-100   text-rose-700   border-rose-200'   },
};

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtMin(min) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}
function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
}

// ── Individual ruta card ────────────────────────────────────────────────────
function RutaCard({ ruta, currentUserId, canEdit, isBranch, onRefresh }) {
  const [expanded,  setExpanded]  = useState(true);
  const [busyStop,  setBusyStop]  = useState(null);
  const [busyRuta,  setBusyRuta]  = useState(null);
  const [mapOpen,   setMapOpen]   = useState(false);

  const paradas = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
  const isCondcutor = ruta.conductor_id === currentUserId;
  const entregadas  = paradas.filter(p => p.entregado_at).length;
  const total       = paradas.length;
  const badge       = STATUS_BADGE[ruta.status] ?? STATUS_BADGE.pendiente;

  const handleIniciarRuta = async () => {
    setBusyRuta('iniciar');
    try {
      const { error } = await supabase
        .from('rutas')
        .update({ status: 'en_ruta', salida_at: new Date().toISOString() })
        .eq('id', ruta.id);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyRuta(null); }
  };

  const handleEntregarStop = async (stop) => {
    setBusyStop(stop.id);
    try {
      const { error } = await supabase
        .from('ruta_pedidos')
        .update({ entregado_at: new Date().toISOString(), entregado_por: currentUserId })
        .eq('id', stop.id);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_PARADA_ENTREGADA', stop.id, { sucursal_id: stop.erp_sucursal_id });

      // Notificación push a la sucursal
      const { data: mapa } = await supabase
        .from('erp_sucursal_map')
        .select('branch_id')
        .eq('erp_sucursal_id', stop.erp_sucursal_id)
        .maybeSingle();
      if (mapa?.branch_id) {
        supabase.from('announcements').insert({
          title:        'Conductor llegó a tu sucursal',
          message:      `${ruta.conductor_nombre} acaba de llegar. Confirma la recepción de tu pedido.`,
          target_type:  'BRANCH',
          target_value: [mapa.branch_id],
          read_by:      [],
          is_archived:  false,
          created_by:   currentUserId,
          priority:     'HIGH',
        }).then(() => {}, () => {});
        supabase.functions.invoke('send-push-notification', {
          body: {
            title:        'El conductor llegó',
            message:      `${ruta.conductor_nombre} está en tu sucursal. Recibe el pedido.`,
            url:          '/pedidos',
            target_type:  'BRANCH',
            target_value: [mapa.branch_id],
          },
        }).catch(() => {});
      }
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyStop(null); }
  };

  const handleVueltaBase = async () => {
    setBusyRuta('vuelta');
    try {
      const { error } = await supabase
        .from('rutas')
        .update({ status: 'completada', vuelta_base_at: new Date().toISOString() })
        .eq('id', ruta.id);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyRuta(null); }
  };

  return (
    <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/90 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/80 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
            <Truck size={15} className="text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-black text-slate-800">Ruta #{ruta.numero}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                {badge.label}
              </span>
              {ruta.salida_at && (
                <span className="text-[10px] text-slate-400">· Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-slate-500 font-medium">{ruta.conductor_nombre}</span>
              {total > 0 && (
                <span className="text-[10px] text-slate-400">
                  · {entregadas}/{total} parada{total !== 1 ? 's' : ''} entregada{entregadas !== 1 ? 's' : ''}
                </span>
              )}
              {ruta.distancia_total_m > 0 && (
                <span className="text-[10px] text-slate-400">
                  · {fmtDist(ruta.distancia_total_m)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Progress bar */}
          {total > 0 && (
            <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(entregadas / total) * 100}%` }}
              />
            </div>
          )}
          {/* Ver mapa */}
          <button
            onClick={e => { e.stopPropagation(); setMapOpen(true); }}
            className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
            title="Ver mapa de ruta"
          >
            <Map size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {/* Paradas */}
          <div className="space-y-2">
            {paradas.map((stop, idx) => {
              const isEntregado = !!stop.entregado_at;
              const isBusy = busyStop === stop.id;

              return (
                <div key={stop.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                  isEntregado ? 'bg-emerald-50/70 border-emerald-200' : 'bg-white border-slate-200'
                }`}>
                  {/* Number */}
                  <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                    isEntregado ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {stop.orden_entrega}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-800">{stop.suc_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {stop.numeros?.length > 0 && (
                        <span className="text-[10px] text-slate-500">
                          Pedido{stop.numeros.length > 1 ? 's' : ''} {stop.numeros.map(n => `#${n}`).join(', ')}
                        </span>
                      )}
                      {stop.dist_m != null && (
                        <span className="text-[10px] text-slate-400">
                          · {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                        </span>
                      )}
                      {isEntregado && (
                        <span className="text-[10px] text-emerald-600 font-semibold">
                          ✓ Entregado {fmtTime(stop.entregado_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Conductor action */}
                  {isCondcutor && !isBranch && !isEntregado && ruta.status === 'en_ruta' && (
                    <button
                      onClick={() => handleEntregarStop(stop)}
                      disabled={isBusy}
                      className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm shrink-0"
                    >
                      {isBusy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                      Entregué
                    </button>
                  )}
                  {isEntregado && (
                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Conductor actions */}
          {!isBranch && (
            <div className="flex gap-2 pt-1">
              {ruta.status === 'pendiente' && isCondcutor && (
                <button
                  onClick={handleIniciarRuta}
                  disabled={busyRuta === 'iniciar'}
                  className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                >
                  {busyRuta === 'iniciar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                  Iniciar ruta
                </button>
              )}
              {ruta.status === 'en_ruta' && (isCondcutor || canEdit) && entregadas === total && total > 0 && (
                <button
                  onClick={handleVueltaBase}
                  disabled={busyRuta === 'vuelta'}
                  className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-slate-700 text-white hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                >
                  {busyRuta === 'vuelta' ? <Loader2 size={12} className="animate-spin" /> : <Home size={12} />}
                  Vuelta en base
                </button>
              )}
              {ruta.vuelta_base_at && (
                <span className="text-[10px] text-slate-500 flex items-center gap-1 px-2">
                  <Home size={10} /> Llegó {fmtTime(ruta.vuelta_base_at)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <RutaMapModal ruta={ruta} open={mapOpen} onClose={() => setMapOpen(false)} currentUserId={currentUserId} />
    </div>
  );
}

// ── Main TabRutas ───────────────────────────────────────────────────────────
export default function TabRutas({ searchTerm = '' }) {
  const { user, hasPermission } = useAuth();
  const canEdit  = hasPermission('pedidos_tab_rutas', 'can_edit');
  const isBranch = user?.scope === 'sucursal';

  const [rutas,         setRutas]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [crearOpen,     setCrearOpen]     = useState(false);

  const loadRutas = useCallback(async () => {
    const { data, error } = await supabase
      .from('rutas')
      .select(`
        id, numero, conductor_id, conductor_nombre, status,
        salida_at, vuelta_base_at, distancia_total_m, duracion_estimada_min, created_at,
        ruta_pedidos (
          id, pedido_id, erp_sucursal_id, orden_entrega,
          distancia_desde_anterior_m, duracion_desde_anterior_min,
          entregado_at, entregado_por, confirmado_suc_at, discrepancia
        )
      `)
      .in('status', ['completada'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) { console.error(error); setLoading(false); return; }

    // Enrich stops with sucursal names + pedido numeros
    const sucIds = [...new Set((data ?? []).flatMap(r =>
      r.ruta_pedidos.map(rp => rp.erp_sucursal_id)
    ))];
    const pedidoIds = [...new Set((data ?? []).flatMap(r =>
      r.ruta_pedidos.map(rp => rp.pedido_id)
    ))];

    const [{ data: sucData }, { data: pedData }] = await Promise.all([
      supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, branch:branches!inner(name)')
        .in('erp_sucursal_id', sucIds.length ? sucIds : [-1]),
      supabase.from('pedidos')
        .select('id, numero')
        .in('id', pedidoIds.length ? pedidoIds : ['00000000-0000-0000-0000-000000000000']),
    ]);

    const sucNameMap = Object.fromEntries((sucData ?? []).map(s => [s.erp_sucursal_id, s.branch?.name]));
    const pedNumMap  = Object.fromEntries((pedData ?? []).map(p => [p.id, p.numero]));

    const enriched = (data ?? []).map(ruta => ({
      ...ruta,
      ruta_pedidos: ruta.ruta_pedidos.map(rp => ({
        ...rp,
        suc_name: sucNameMap[rp.erp_sucursal_id] ?? `Suc. ${rp.erp_sucursal_id}`,
        numeros:  [pedNumMap[rp.pedido_id]].filter(Boolean),
      })),
    }));

    setRutas(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { loadRutas(); }, [loadRutas]);

  // Search filter
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return rutas;
    return rutas.filter(r =>
        String(r.numero).includes(searchTerm.trim()) ||
        tokenMatch(searchTerm, r.conductor_nombre)
    );
  }, [rutas, searchTerm]);

  const active    = filtered.filter(r => r.status !== 'completada');
  const completed = filtered.filter(r => r.status === 'completada');

  return (
    <div className="space-y-5">
      {/* Header actions */}
      {canEdit && !isBranch && (
        <div className="flex justify-end">
          <button
            onClick={() => setCrearOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[12px] hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
          >
            <Plus size={14} /> Nueva Ruta
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-indigo-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <Navigation size={28} className="text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-bold text-slate-700">Sin rutas activas</p>
            <p className="text-[12px] text-slate-400 mt-1">
              {canEdit && !isBranch ? 'Crea una ruta para gestionar las entregas.' : 'No hay rutas en curso.'}
            </p>
          </div>
          {canEdit && !isBranch && (
            <button
              onClick={() => setCrearOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={14} /> Nueva Ruta
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Active routes */}
          {active.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <Truck size={10} /> Rutas activas
              </p>
              {active.map(ruta => (
                <RutaCard
                  key={ruta.id}
                  ruta={ruta}
                  currentUserId={user?.id}
                  canEdit={canEdit}
                  isBranch={isBranch}
                  onRefresh={loadRutas}
                />
              ))}
            </div>
          )}

          {/* Completed routes */}
          {completed.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 size={10} /> Completadas hoy
              </p>
              {completed.map(ruta => (
                <RutaCard
                  key={ruta.id}
                  ruta={ruta}
                  currentUserId={user?.id}
                  canEdit={canEdit}
                  isBranch={isBranch}
                  onRefresh={loadRutas}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Crear Ruta modal */}
      <CrearRutaModal
        open={crearOpen}
        onClose={() => setCrearOpen(false)}
        onCreated={() => { loadRutas(); }}
      />
    </div>
  );
}
