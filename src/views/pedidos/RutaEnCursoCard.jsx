import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, Map, CheckCircle2, ChevronDown, ChevronUp,
  Play, Home, Loader2, Radio,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { notifyBranch } from '../../utils/notify';
import RutaMapModal from './RutaMapModal';
import { updateRutaStatus, updateRutaPedidoEntregado, fetchBranchIdForSucursal } from '../../data/pedidos';

const STATUS_BADGE = {
  pendiente:  { label: 'Pendiente',  cls: 'bg-warning/10  text-amber-700  border-warning/30'  },
  en_ruta:    { label: 'En ruta',    cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  completada: { label: 'Completada', cls: 'bg-success/10 text-emerald-700 border-success/30' },
};

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function RutaEnCursoCard({ ruta, currentUserId, canEdit, isBranch, onRefresh, driverOnline, filterSucId }) {
  const [expanded, setExpanded] = useState(true);
  const [busyStop, setBusyStop] = useState(null);
  const [busyRuta, setBusyRuta] = useState(null);
  const [mapOpen,  setMapOpen]  = useState(false);

  const allParadas   = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
  // branch: solo ve su parada; mapa siempre muestra la ruta completa
  const paradas      = filterSucId ? allParadas.filter(p => p.erp_sucursal_id === filterSucId) : allParadas;
  const isConductor  = !!(currentUserId && ruta.conductor_id && currentUserId === ruta.conductor_id);
  const entregadas   = allParadas.filter(p => p.entregado_at).length;
  const total        = allParadas.length;
  const badge        = STATUS_BADGE[ruta.status] ?? STATUS_BADGE.pendiente;
  const pct          = total > 0 ? Math.round((entregadas / total) * 100) : 0;

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

      const { data: mapa } = await fetchBranchIdForSucursal(stop.erp_sucursal_id);
      if (mapa?.branch_id) {
        // Llegada física = accionable → campana + push
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
    <div className="bg-surface-card backdrop-blur-md rounded-2xl border border-border-card shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden">

      {/* ── Header (siempre visible) ─────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-card transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <Truck size={15} className="text-indigo-600" />
            </div>
            {/* GPS en vivo dot */}
            {driverOnline && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-black text-content">Ruta #{ruta.numero}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
              {ruta.salida_at && (
                <span className="text-[10px] text-content-3">· Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-content-3 font-medium">{ruta.conductor_nombre}</span>
              <span className="text-[10px] text-content-3">· {entregadas}/{total} entregadas</span>
              {driverOnline && (
                <span className="flex items-center gap-1 text-[10px] text-success font-semibold">
                  <Radio size={8} className="animate-pulse" /> En vivo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Barra de progreso */}
          {total > 0 && (
            <div className="w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          {/* Botón mapa */}
          <button
            onClick={e => { e.stopPropagation(); setMapOpen(true); }}
            className="p-1.5 rounded-lg hover:bg-indigo-50 text-content-3 hover:text-indigo-600 transition-colors"
            title="Ver mapa"
          >
            <Map size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-content-3" /> : <ChevronDown size={14} className="text-content-3" />}
        </div>
      </div>

      {/* ── Body expandible ──────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100 px-4 py-3 space-y-2">

              {/* Paradas */}
              {paradas.map((stop, idx) => {
                const done  = !!stop.entregado_at;
                const busy  = busyStop === stop.id;
                return (
                  <div key={stop.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                    done ? 'bg-success/10 border-success/30' : 'bg-white border-slate-200'
                  }`}>
                    <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                      done ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                    }`}>{stop.orden_entrega}</span>

                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-content truncate">{stop.suc_name}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {stop.numeros?.length > 0 && (
                          <span className="text-[10px] text-content-3">
                            Pedido{stop.numeros.length > 1 ? 's' : ''} {stop.numeros.map(n => `#${n}`).join(', ')}
                          </span>
                        )}
                        {stop.distancia_desde_anterior_m > 0 && (
                          <span className="text-[10px] text-content-3">
                            · {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                          </span>
                        )}
                        {done && (
                          <span className="text-[10px] text-success font-semibold">✓ {fmtTime(stop.entregado_at)}</span>
                        )}
                      </div>
                    </div>

                    {isConductor && !isBranch && !done && ruta.status === 'en_ruta' && (
                      <button
                        onClick={() => handleEntregarStop(stop)}
                        disabled={busy}
                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm shrink-0"
                      >
                        {busy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                        Entregué
                      </button>
                    )}
                    {done && <CheckCircle2 size={15} className="text-success shrink-0" />}
                  </div>
                );
              })}

              {/* Acciones */}
              {!isBranch && (
                <div className="flex gap-2 pt-1">
                  {ruta.status === 'pendiente' && isConductor && (
                    <button
                      onClick={handleIniciarRuta}
                      disabled={busyRuta === 'iniciar'}
                      className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                    >
                      {busyRuta === 'iniciar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                      Iniciar ruta
                    </button>
                  )}
                  {ruta.status === 'en_ruta' && (isConductor || canEdit) && entregadas === total && total > 0 && (
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
          </motion.div>
        )}
      </AnimatePresence>

      <RutaMapModal
        ruta={ruta}
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        currentUserId={currentUserId}
      />
    </div>
  );
}
