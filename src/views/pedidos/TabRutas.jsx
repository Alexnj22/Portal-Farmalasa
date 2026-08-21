import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { Truck, CheckCircle2, Home, Play, Plus, ChevronDown, ChevronUp, Navigation, Map, Search } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { tokenMatch } from '../../utils/searchUtils';
import { clickable } from '../../utils/clickable';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { notifyBranch } from '../../utils/notify';
import { dialogoDiferido } from '../../utils/dialogoDiferido';

/* Los dos diálogos llegan al abrirlos — ver `src/utils/dialogoDiferido.jsx`.
   Van acá además de en TabPedidos: si una pestaña los difiere y la otra no,
   quedan en el trozo de la que no, y la primera no ahorra nada. */
const CrearRutaModal = dialogoDiferido(() => import('./CrearRutaModal'));
const RutaMapModal   = dialogoDiferido(() => import('./RutaMapModal'));
import Badge from '../../components/common/Badge';
import {
    updateRutaStatus, updateRutaPedidoEntregado, fetchBranchIdForSucursal,
    fetchRutasConParadas, fetchBranchNamesForSucursales, fetchPedidoNumerosByIds,
} from '../../data/pedidos';
import { avisarSalidaALasSalas } from '../../utils/avisoSalidaPedido';

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
// `es-SV` separa la abreviatura («03:08 p. m.»). Se junta, igual que en la
// línea de tiempo del pedido, para que la hora se lea como una sola pieza.
function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso)
    .toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true })
    .replace(/\s*([ap])\.\s*m\./i, ' $1.m.');
}

// ── Individual ruta card ────────────────────────────────────────────────────
function RutaCard({ ruta, currentUserId, canEdit, isBranch, onRefresh }) {
  const [expanded,  setExpanded]  = useState(true);
  const [busyStop,  setBusyStop]  = useState(null);
  const [busyRuta,  setBusyRuta]  = useState(null);
  const [mapOpen,   setMapOpen]   = useState(false);
  const showToast = useToastStore(s => s.showToast);

  const paradas = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
  const isConductor = ruta.conductor_id === currentUserId;
  const entregadas  = paradas.filter(p => p.entregado_at).length;
  const total       = paradas.length;
  const badge       = STATUS_BADGE[ruta.status] ?? STATUS_BADGE.pendiente;

  const handleIniciarRuta = async () => {
    setBusyRuta('iniciar');
    try {
      const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
      await avisarSalidaALasSalas(paradas, ruta.conductor_nombre);
      onRefresh();
    } catch (e) {
      // `mensajeAmigable` ya manda el error crudo a la consola.
      showToast('No se pudo iniciar la ruta', mensajeAmigable(e), 'error');
    }
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
    } catch (e) {
      showToast('No se pudo marcar la entrega', mensajeAmigable(e), 'error');
    }
    finally { setBusyStop(null); }
  };

  const handleVueltaBase = async () => {
    setBusyRuta('vuelta');
    try {
      const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
      if (error) throw error;
      useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
      onRefresh();
    } catch (e) {
      showToast('No se pudo cerrar la ruta', mensajeAmigable(e), 'error');
    }
    finally { setBusyRuta(null); }
  };

  return (
    <div data-surface="card" className="overflow-hidden">
      {/* Header — plegar la ruta es la acción de esta franja, así que va por
          `clickable()` y no por un `onClick` suelto en un div: era una
          superficie que sólo respondía al puntero, sin foco ni teclado, y sin
          decirle a nadie que despliega algo (DESIGN.md §25.8). */}
      <div
        {...clickable(() => setExpanded(e => !e), { label: `Ruta ${ruta.numero}` })}
        aria-expanded={expanded}
        className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-card transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-chart-3/10 rounded-xl border border-chart-3/30 shrink-0">
            <Truck size={15} className="text-chart-3-text" />
          </div>
          {/* `min-w-0` + `flex-wrap`: a 390px el número, el estado y la hora de
              salida no entran en un renglón, y sin poder envolver empujaban el
              mapa y el chevrón fuera de la tarjeta. */}
          <div className="min-w-0">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
              <span className="text-body font-black text-content">Ruta #{ruta.numero}</span>
              <Badge variant={badge.variante} size="sm" uppercase={false}>
                {badge.label}
              </Badge>
              {ruta.salida_at && (
                <span className="text-caption text-content-3">Salida {fmtTime(ruta.salida_at)}</span>
              )}
            </div>
            <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 flex-wrap">
              <span className="text-label text-content-3 font-medium">{ruta.conductor_nombre}</span>
              {total > 0 && (
                <span className="text-caption text-content-3">
                  {entregadas}/{total} parada{total !== 1 ? 's' : ''} entregada{entregadas !== 1 ? 's' : ''}
                </span>
              )}
              {ruta.distancia_total_m > 0 && (
                <span className="text-caption text-content-3">
                  {fmtDist(ruta.distancia_total_m)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* La barra de avance repite lo que el renglón ya dice en números y es
              lo primero que sobra cuando el ancho aprieta. */}
          {total > 0 && (
            <div className="hidden sm:block w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-chart-3 transition-all duration-[var(--dur-base)]"
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
                      {/* La guarda miraba `stop.dist_m`, un campo que
                          `fetchRutasConParadas` no trae: el select devuelve
                          `distancia_desde_anterior_m`, que es lo que la línea
                          pinta. O sea que la condición era falsa siempre y la
                          distancia entre paradas no se mostró nunca. */}
                      {stop.distancia_desde_anterior_m != null && (
                        <span className="text-caption text-content-3">
                          {fmtDist(stop.distancia_desde_anterior_m)} desde {idx === 0 ? 'bodega' : `parada ${idx}`}
                        </span>
                      )}
                      {isEntregado && (
                        <span className="inline-flex items-center gap-1 text-caption text-success-text font-semibold">
                          <CheckCircle2 size={11} aria-hidden="true" />
                          Entregado {fmtTime(stop.entregado_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Conductor action */}
                  {isConductor && !isBranch && !isEntregado && ruta.status === 'en_ruta' && (
                    <Button tone="success" icon={CheckCircle2} loading={isBusy} onClick={() => handleEntregarStop(stop)}>Entregué</Button>
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
              {ruta.status === 'pendiente' && isConductor && (
                <Button tone="chart-3" icon={Play} loading={busyRuta === 'iniciar'} onClick={handleIniciarRuta}>Iniciar ruta</Button>
              )}
              {ruta.status === 'en_ruta' && (isConductor || canEdit) && entregadas === total && total > 0 && (
                <Button tone="chart-8" icon={Home} loading={busyRuta === 'vuelta'} onClick={handleVueltaBase}>Volver a base</Button>
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
  const { user, hasPermission, getScope } = useAuth();
  const canEdit  = hasPermission('pedidos_tab_rutas', 'can_edit');
  // `user.scope === 'sucursal'` era una guarda muerta: el objeto `user` no tiene
  // campo `scope` —los scopes viven por módulo, dentro de `rolePerms`— y su
  // vocabulario es `ALL`/`BRANCH`/`MINE` (lo fija el CHECK de
  // `role_permissions.scope`), así que 'sucursal' no existe en ninguna parte.
  // O sea que `isBranch` era `false` siempre y las tres ramas que dependen de él
  // —las acciones del conductor y el botón de crear— nunca escondieron nada.
  // Hoy no cambia lo que ve nadie: las 6 filas del módulo están en `ALL`. Lo que
  // cambia es que ahora la guarda funciona el día que alguien ponga `BRANCH`.
  const isBranch = getScope('pedidos_tab_rutas') !== 'ALL';

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
    /* El resto de las pestañas de la vista envuelve su contenido en `p-4`;
       ésta no lo hacía, así que sus tarjetas quedaban pegadas al borde de la
       pantalla en el teléfono —el cuerpo de `GlassViewLayout` va sin relleno
       lateral bajo `md`— y desalineadas respecto de las otras cuatro. */
    <div className="space-y-4 p-4">
      {/* Header actions */}
      {canEdit && !isBranch && rutas.length > 0 && (
        <div className="flex justify-end">
          <Button tone="chart-3" icon={Plus} onClick={() => setCrearOpen(true)}>Crear ruta</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><SkeletonText lines={4} className="w-full max-w-md" /></div>
      ) : filtered.length === 0 ? (
        /* §18.1 · §26.2 — el canónico, y los dos vacíos separados. Estaba
           escrito a mano y decía «Sin rutas activas» también cuando el
           buscador no encontraba nada: dos estados que se arreglan de forma
           distinta contados como uno solo. */
        searchTerm.trim() ? (
          <EmptyState
            icon={Search}
            title="Sin resultados"
            subtitle={`Ninguna ruta coincide con "${searchTerm}".`}
          />
        ) : (
          <EmptyState
            icon={Navigation}
            title="Sin rutas"
            subtitle={canEdit && !isBranch
              ? 'Crea una ruta para agrupar las entregas del día.'
              : 'Acá aparecen las entregas cuando bodega arma una ruta.'}
            action={canEdit && !isBranch
              ? <Button tone="chart-3" icon={Plus} onClick={() => setCrearOpen(true)}>Crear ruta</Button>
              : undefined}
          />
        )
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
              {/* «Completadas hoy» era falso: `fetchRutasConParadas` trae las
                  últimas 50 por fecha de creación, sin recortar por día. */}
              <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <CheckCircle2 size={10} /> Completadas
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
