import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import { Truck, MapPin, CheckCircle2, Clock, AlertTriangle, Home, Play, Plus, Loader2, ChevronDown, ChevronUp, Navigation, Map } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { tokenMatch } from '../../utils/searchUtils';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { notifyBranch } from '../../utils/notify';
import CrearRutaModal from './CrearRutaModal';
import RutaMapModal   from './RutaMapModal';
import Badge from '../../components/common/Badge';
import {
    updateRutaStatus, updateRutaPedidoEntregado, fetchBranchIdForSucursal,
    fetchRutasConParadas, fetchBranchNamesForSucursales, fetchPedidoNumerosByIds,
} from '../../data/pedidos';

const STATUS_BADGE = {
  pendiente:  { label: 'Pendiente',  variante: 'warning' },
  en_ruta:    { label: 'En ruta',    variante: 'chart-9' },
  completada: { label: 'Completada', variante: 'success' },
  con_alerta: { label: 'Con alerta', variante: 'danger'  },
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
    <div data-surface="card" className="overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-card transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-chart-3/10 rounded-xl border border-chart-3/30">
            <Truck size={15} className="text-chart-3-text" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-body font-black text-content">Ruta #{ruta.numero}</span>
              <Badge variant={badge.variante} size="sm" uppercase={false}>
                {badge.label}
              </Badge>
              {ruta.salida_at && (
                <span className="text-caption text-content-3">· Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-label text-content-3 font-medium">{ruta.conductor_nombre}</span>
              {total > 0 && (
                <span className="text-caption text-content-3">
                  · {entregadas}/{total} parada{total !== 1 ? 's' : ''} entregada{entregadas !== 1 ? 's' : ''}
                </span>
              )}
              {ruta.distancia_total_m > 0 && (
                <span className="text-caption text-content-3">
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
                className="h-full rounded-full bg-chart-3 transition-all"
                style={{ width: `${(entregadas / total) * 100}%` }}
              />
            </div>
          )}
          {/* Ver mapa */}
          <Button tone="chart-3" icon={Map} title="Ver mapa de ruta" iconOnly onClick={e => { e.stopPropagation(); setMapOpen(true); }} />
          {expanded ? <ChevronUp size={14} className="text-content-3" /> : <ChevronDown size={14} className="text-content-3" />}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-divider px-4 py-3 space-y-3">
          {/* Paradas */}
          <div className="space-y-2">
            {paradas.map((stop, idx) => {
              const isEntregado = !!stop.entregado_at;
              const isBusy = busyStop === stop.id;

              return (
                <div key={stop.id} data-surface={isEntregado ? undefined : 'card'} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${isEntregado ? 'bg-success/10 border-success/30' : ''}`}>
                  {/* Number */}
                  <span className={`w-5 h-5 rounded-full text-micro font-black flex items-center justify-center shrink-0 ${
                    isEntregado ? 'bg-success-solid text-white' : 'bg-chart-3/10 text-chart-3-text'
                  }`}>
                    {stop.orden_entrega}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-bold text-content">{stop.suc_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {stop.numeros?.length > 0 && (
                        <span className="text-caption text-content-3">
                          Pedido{stop.numeros.length > 1 ? 's' : ''} {stop.numeros.map(n => `#${n}`).join(', ')}
                        </span>
                      )}
                      {stop.dist_m != null && (
                        <span className="text-caption text-content-3">
                          · {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                        </span>
                      )}
                      {isEntregado && (
                        <span className="text-caption text-success-text font-semibold">
                          ✓ Entregado {fmtTime(stop.entregado_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Conductor action */}
                  {isCondcutor && !isBranch && !isEntregado && ruta.status === 'en_ruta' && (
                    <Button tone="success" disabled={isBusy} onClick={() => handleEntregarStop(stop)}>{isBusy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                      Entregué</Button>
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
                <Button tone="chart-3" disabled={busyRuta === 'iniciar'} onClick={handleIniciarRuta}>{busyRuta === 'iniciar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                  Iniciar ruta</Button>
              )}
              {ruta.status === 'en_ruta' && (isCondcutor || canEdit) && entregadas === total && total > 0 && (
                <Button tone="chart-8" disabled={busyRuta === 'vuelta'} onClick={handleVueltaBase}>{busyRuta === 'vuelta' ? <Loader2 size={12} className="animate-spin" /> : <Home size={12} />}
                  Vuelta en base</Button>
              )}
              {ruta.vuelta_base_at && (
                <span className="text-caption text-content-3 flex items-center gap-1 px-2">
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
          <Button tone="chart-3" icon={Plus} onClick={() => setCrearOpen(true)}>Nueva Ruta</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><SkeletonText lines={4} className="w-full max-w-md" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-surface-card-hover border border-divider flex items-center justify-center">
            <Navigation size={28} className="text-content-3" />
          </div>
          <div className="text-center">
            <p className="text-subtitle font-bold text-content-2">Sin rutas activas</p>
            <p className="text-body-sm text-content-3 mt-1">
              {canEdit && !isBranch ? 'Crea una ruta para gestionar las entregas.' : 'No hay rutas en curso.'}
            </p>
          </div>
          {canEdit && !isBranch && (
            <Button tone="chart-3" icon={Plus} onClick={() => setCrearOpen(true)}>Nueva Ruta</Button>
          )}
        </div>
      ) : (
        <>
          {/* Active routes */}
          {active.length > 0 && (
            <div className="space-y-3">
              <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
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
              <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
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
