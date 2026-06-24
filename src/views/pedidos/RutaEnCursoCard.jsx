import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, Map, CheckCircle2, ChevronDown, ChevronUp,
  Play, Home, Loader2, Radio,
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import RutaMapModal from './RutaMapModal';

const STATUS_BADGE = {
  pendiente:  { label: 'Pendiente',  cls: 'bg-amber-100  text-amber-700  border-amber-200'  },
  en_ruta:    { label: 'En ruta',    cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  completada: { label: 'Completada', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

export default function RutaEnCursoCard({ ruta, currentUserId, canEdit, isBranch, onRefresh, driverOnline }) {
  const [expanded, setExpanded] = useState(true);
  const [busyStop, setBusyStop] = useState(null);
  const [busyRuta, setBusyRuta] = useState(null);
  const [mapOpen,  setMapOpen]  = useState(false);

  const paradas      = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
  const isConductor  = !!(currentUserId && ruta.conductor_id && currentUserId === ruta.conductor_id);
  const entregadas   = paradas.filter(p => p.entregado_at).length;
  const total        = paradas.length;
  const badge        = STATUS_BADGE[ruta.status] ?? STATUS_BADGE.pendiente;
  const pct          = total > 0 ? Math.round((entregadas / total) * 100) : 0;

  const handleIniciarRuta = async () => {
    setBusyRuta('iniciar');
    try {
      const { error } = await supabase.from('rutas')
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
      const { error } = await supabase.from('ruta_pedidos')
        .update({ entregado_at: new Date().toISOString(), entregado_por: currentUserId })
        .eq('id', stop.id);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_PARADA_ENTREGADA', stop.id, { sucursal_id: stop.erp_sucursal_id });

      const { data: mapa } = await supabase.from('erp_sucursal_map')
        .select('branch_id').eq('erp_sucursal_id', stop.erp_sucursal_id).maybeSingle();
      if (mapa?.branch_id) {
        supabase.from('announcements').insert({
          title:       'Conductor llegó a tu sucursal',
          message:     `${ruta.conductor_nombre} acaba de llegar. Confirma la recepción de tu pedido.`,
          target_type: 'BRANCH', target_value: [mapa.branch_id],
          read_by: [], is_archived: false, created_by: currentUserId, priority: 'HIGH',
        }).then(() => {}, () => {});
        supabase.functions.invoke('send-push-notification', {
          body: { title: 'El conductor llegó', message: `${ruta.conductor_nombre} está en tu sucursal. Recibe el pedido.`, url: '/pedidos', target_type: 'BRANCH', target_value: [mapa.branch_id] },
        }).catch(() => {});
      }
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyStop(null); }
  };

  const handleVueltaBase = async () => {
    setBusyRuta('vuelta');
    try {
      const { error } = await supabase.from('rutas')
        .update({ status: 'completada', vuelta_base_at: new Date().toISOString() })
        .eq('id', ruta.id);
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setBusyRuta(null); }
  };

  return (
    <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/90 shadow-[0_4px_20px_rgba(0,0,0,0.06)] overflow-hidden">

      {/* ── Header (siempre visible) ─────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/80 transition-colors"
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
              <span className="text-[13px] font-black text-slate-800">Ruta #{ruta.numero}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
              {ruta.salida_at && (
                <span className="text-[10px] text-slate-400">· Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-slate-500 font-medium">{ruta.conductor_nombre}</span>
              <span className="text-[10px] text-slate-400">· {entregadas}/{total} entregadas</span>
              {driverOnline && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                  <Radio size={8} className="animate-pulse" /> En vivo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Barra de progreso */}
          {total > 0 && (
            <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          {/* Botón mapa */}
          <button
            onClick={e => { e.stopPropagation(); setMapOpen(true); }}
            className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
            title="Ver mapa"
          >
            <Map size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
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
                    done ? 'bg-emerald-50/70 border-emerald-200' : 'bg-white border-slate-200'
                  }`}>
                    <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                      done ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                    }`}>{stop.orden_entrega}</span>

                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-slate-800 truncate">{stop.suc_name}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {stop.numeros?.length > 0 && (
                          <span className="text-[10px] text-slate-500">
                            Pedido{stop.numeros.length > 1 ? 's' : ''} {stop.numeros.map(n => `#${n}`).join(', ')}
                          </span>
                        )}
                        {stop.distancia_desde_anterior_m > 0 && (
                          <span className="text-[10px] text-slate-400">
                            · {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                          </span>
                        )}
                        {done && (
                          <span className="text-[10px] text-emerald-600 font-semibold">✓ {fmtTime(stop.entregado_at)}</span>
                        )}
                      </div>
                    </div>

                    {isConductor && !isBranch && !done && ruta.status === 'en_ruta' && (
                      <button
                        onClick={() => handleEntregarStop(stop)}
                        disabled={busy}
                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm shrink-0"
                      >
                        {busy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                        Entregué
                      </button>
                    )}
                    {done && <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
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
                      className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {busyRuta === 'iniciar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                      Iniciar ruta
                    </button>
                  )}
                  {ruta.status === 'en_ruta' && (isConductor || canEdit) && entregadas === total && total > 0 && (
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
