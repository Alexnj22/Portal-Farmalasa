import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, MapPin, CheckCircle2, Clock, AlertTriangle, Home, Play, Plus, Loader2, ChevronDown, ChevronUp, Navigation, Map } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { tokenMatch } from '../../utils/searchUtils';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { notifyBranch } from '../../utils/notify';
import CrearRutaModal from './CrearRutaModal';
import RutaMapModal   from './RutaMapModal';
import {
    updateRutaStatus, updateRutaPedidoEntregado, fetchBranchIdForSucursal,
    fetchRutasConParadas, fetchBranchNamesForSucursales, fetchPedidoNumerosByIds,
} from '../../data/pedidos';

const STATUS_BADGE = {
  pendiente:    { label: 'Pendiente',     cls: 'bg-warning/10  text-amber-700  border-warning/30'  },
  en_ruta:      { label: 'En ruta',       cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  completada:   { label: 'Completada',    cls: 'bg-success/10 text-emerald-700 border-success/30' },
  con_alerta:   { label: 'Con alerta',    cls: 'bg-rose-100   text-rose-700   border-rose-200'   },
};

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
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
      const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyRuta(null); }
  };

  const handleEntregarStop = async (stop) => {
    setBusyStop(stop.id);
    try {
      const { error } = await updateRutaPedidoEntregado(stop.id, currentUserId);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_PARADA_ENTREGADA', stop.id, { sucursal_id: stop.erp_sucursal_id });

      // Llegada física = accionable → campana + push
      const { data: mapa } = await fetchBranchIdForSucursal(stop.erp_sucursal_id);
      if (mapa?.branch_id) {
        notifyBranch(mapa.branch_id, {
          type: 'PEDIDO_LLEGADA',
          title: 'Conductor llegó a tu sucursal',
          body: `${ruta.conductor_nombre} acaba de llegar. Confirma la recepción de tu pedido.`,
          link: '/pedidos',
          push: true,
        });
      }
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyStop(null); }
  };

  const handleVueltaBase = async () => {
    setBusyRuta('vuelta');
    try {
      const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyRuta(null); }
  };

  return (
    <div className="bg-surface-card backdrop-blur-md rounded-2xl border border-border-card shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-card transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
            <Truck size={15} className="text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-black text-content">Ruta #{ruta.numero}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                {badge.label}
              </span>
              {ruta.salida_at && (
                <span className="text-[10px] text-content-3">· Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-content-3 font-medium">{ruta.conductor_nombre}</span>
              {total > 0 && (
                <span className="text-[10px] text-content-3">
                  · {entregadas}/{total} parada{total !== 1 ? 's' : ''} entregada{entregadas !== 1 ? 's' : ''}
                </span>
              )}
              {ruta.distancia_total_m > 0 && (
                <span className="text-[10px] text-content-3">
                  · {fmtDist(ruta.distancia_total_m)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Progress bar */}
          {total > 0 && (
            <div className="w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(entregadas / total) * 100}%` }}
              />
            </div>
          )}
          {/* Ver mapa */}
          <button
            onClick={e => { e.stopPropagation(); setMapOpen(true); }}
            className="p-1.5 rounded-lg hover:bg-indigo-50 text-content-3 hover:text-indigo-600 transition-colors"
            title="Ver mapa de ruta"
          >
            <Map size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-content-3" /> : <ChevronDown size={14} className="text-content-3" />}
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
                  isEntregado ? 'bg-success/10 border-success/30' : 'bg-white border-slate-200'
                }`}>
                  {/* Number */}
                  <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                    isEntregado ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {stop.orden_entrega}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-content">{stop.suc_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {stop.numeros?.length > 0 && (
                        <span className="text-[10px] text-content-3">
                          Pedido{stop.numeros.length > 1 ? 's' : ''} {stop.numeros.map(n => `#${n}`).join(', ')}
                        </span>
                      )}
                      {stop.dist_m != null && (
                        <span className="text-[10px] text-content-3">
                          · {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                        </span>
                      )}
                      {isEntregado && (
                        <span className="text-[10px] text-success font-semibold">
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
                      className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm shrink-0"
                    >
                      {isBusy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                      Entregué
                    </button>
                  )}
                  {isEntregado && (
                    <CheckCircle2 size={16} className="text-success shrink-0" />
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
                  className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                >
                  {busyRuta === 'iniciar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                  Iniciar ruta
                </button>
              )}
              {ruta.status === 'en_ruta' && (isCondcutor || canEdit) && entregadas === total && total > 0 && (
                <button
                  onClick={handleVueltaBase}
                  disabled={busyRuta === 'vuelta'}
                  className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-slate-700 text-white hover:bg-slate-800 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                >
                  {busyRuta === 'vuelta' ? <Loader2 size={12} className="animate-spin" /> : <Home size={12} />}
                  Vuelta en base
                </button>
              )}
              {ruta.vuelta_base_at && (
                <span className="text-[10px] text-content-3 flex items-center gap-1 px-2">
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
    const { data, error } = await fetchRutasConParadas();

    if (error) { console.error(error); setLoading(false); return; }

    // Enrich stops with sucursal names + pedido numeros
    const sucIds = [...new Set((data ?? []).flatMap(r =>
      r.ruta_pedidos.map(rp => rp.erp_sucursal_id)
    ))];
    const pedidoIds = [...new Set((data ?? []).flatMap(r =>
      r.ruta_pedidos.map(rp => rp.pedido_id)
    ))];

    const [{ data: sucData }, { data: pedData }] = await Promise.all([
      fetchBranchNamesForSucursales(sucIds.length ? sucIds : [-1]),
      fetchPedidoNumerosByIds(pedidoIds.length ? pedidoIds : ['00000000-0000-0000-0000-000000000000']),
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

  useEffect(() => { loadRutas(); }, [loadRutas]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  // Realtime: recarga cuando cambia el estado de rutas o paradas
  useEffect(() => {
    const ch = supabase
      .channel('rutas-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas' }, () => loadRutas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ruta_pedidos' }, () => loadRutas())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadRutas]);

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
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[12px] hover:bg-indigo-700 active:scale-[0.97] transition-all shadow-sm"
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
          <div className="w-16 h-16 rounded-2xl bg-surface-card-hover border border-slate-200 flex items-center justify-center">
            <Navigation size={28} className="text-content-3" />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-bold text-content-2">Sin rutas activas</p>
            <p className="text-[12px] text-content-3 mt-1">
              {canEdit && !isBranch ? 'Crea una ruta para gestionar las entregas.' : 'No hay rutas en curso.'}
            </p>
          </div>
          {canEdit && !isBranch && (
            <button
              onClick={() => setCrearOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-[0.97] transition-all shadow-sm"
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
              <p className="text-[10px] font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
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
              <p className="text-[10px] font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
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
