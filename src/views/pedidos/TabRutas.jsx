import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { Truck, CheckCircle2, Home, Play, Plus, ChevronDown, ChevronUp, Navigation, Map, Search, Clock, PackageCheck, User, XCircle, Flag } from 'lucide-react';
import PromptModal from '../../components/common/PromptModal';
import { useSearchParams } from 'react-router-dom';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import SegmentedControl from '../../components/common/SegmentedControl';
import { clickable } from '@nucleo/utils/clickable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { dialogoDiferido } from '@nucleo/utils/dialogoDiferido';

/* Los dos diálogos llegan al abrirlos — ver `src/utils/dialogoDiferido.jsx`.
   Van acá además de en TabPedidos: si una pestaña los difiere y la otra no,
   quedan en el trozo de la que no, y la primera no ahorra nada. */
const CrearRutaModal = dialogoDiferido(() => import('./CrearRutaModal'));
const RutaMapModal   = dialogoDiferido(() => import('./RutaMapModal'));
import Badge from '../../components/common/Badge';
import { iniciarRuta, completarRuta, updateRutaPedidoEntregado } from '@nucleo/data/pedidos';
import { fetchRutasDeEntrega } from '@nucleo/data/rutasDeEntrega';
import { marcarParadaNoEntregada, cerrarRutaConMotivo, MSG_FUNCION_DE_RUTA_FALTA } from '@nucleo/data/rutas';
import { estadoDeRuta, distanciaTexto, ordenarParadas, avanceDeEntrega, filtrarRutas, separarRutas } from '@nucleo/utils/rutasDeEntrega';
import { hora12 } from '@nucleo/utils/hora';
import { escucharCambios } from '@nucleo/data/tiempoReal';

// El estado, la distancia, el orden y el avance salen del núcleo
// (`utils/rutasDeEntrega.js`): la app pinta las mismas rutas.
//
// `con_alerta` está en el CHECK de `rutas.status` pero NADA lo escribe
// (medido el 2026-10-08: cero rutas en producción con ese estado, y ninguna
// función ni pantalla lo asigna). No se ofrece en ningún filtro ni acción; el
// rótulo (`ESTADO_RUTA` del núcleo) queda sólo para que una ruta que algún día
// lo tenga no se pinte como «Pendiente», que sería mentir sobre ella.
const fmtDist = distanciaTexto;
// La hora sale del canónico: sus espacios no se cortan, así que se lee como
// una sola pieza sin juntar la abreviatura a mano.
function fmtTime(iso) {
  if (!iso) return null;
  return hora12(iso);
}

// ── Individual ruta card ────────────────────────────────────────────────────
function RutaCard({ ruta, currentUserId, canEdit, isBranch, onRefresh, abierta = true }) {
  // Las completadas entran CERRADAS: son historial, y abiertas eran la mayor
  // parte del alto de la pestaña.
  const [expanded,  setExpanded]  = useState(abierta);
  const [busyStop,  setBusyStop]  = useState(null);
  const [busyRuta,  setBusyRuta]  = useState(null);
  const [mapOpen,   setMapOpen]   = useState(false);
  // Las dos salidas que piden motivo: una parada que no se pudo entregar y
  // cerrar la ruta con paradas pendientes. `null` = diálogo cerrado.
  const [noEntregada, setNoEntregada] = useState(null);   // la parada
  const [cerrarAbierto, setCerrarAbierto] = useState(false);
  const showToast = useToastStore(s => s.showToast);

  const paradas = ordenarParadas(ruta);
  const isConductor = ruta.conductor_id === currentUserId;
  const { entregadas, total } = avanceDeEntrega(paradas);
  // `no_entregado_at` lo escribe `ruta_parada_no_entregada` (si la parada se
  // queda en la ruta marcada; si la función la quita, simplemente no está).
  const pendientes  = paradas.filter(p => !p.entregado_at && !p.no_entregado_at).length;
  const gestiona    = canEdit && !isBranch;
  const badge       = estadoDeRuta(ruta.status);

  const handleIniciarRuta = async () => {
    setBusyRuta('iniciar');
    try {
      const { error } = await iniciarRuta(ruta.id);
      if (error) throw error;
      // «En camino» a cada sala lo escribe la base (`avisar_salida_de_ruta`).
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
      const { error } = await updateRutaPedidoEntregado(stop.id, currentUserId, { sucursal_id: stop.erp_sucursal_id });
      if (error) throw error;

      // «El conductor llegó» lo escribe la base (`avisar_llegada_del_conductor`).
      onRefresh();
    } catch (e) {
      showToast('No se pudo marcar la entrega', mensajeAmigable(e), 'error');
    }
    finally { setBusyStop(null); }
  };

  const handleNoEntregada = async (motivo) => {
    const stop = noEntregada;
    if (!stop) return;
    setBusyStop(stop.id);
    try {
      const { error } = await marcarParadaNoEntregada({
        rutaId: ruta.id, pedidoId: stop.pedido_id, sucursalId: stop.erp_sucursal_id, motivo,
      });
      if (error) throw error;
      setNoEntregada(null);
      showToast('Parada devuelta', `${stop.suc_name} queda disponible para otra ruta.`, 'success');
      onRefresh();
    } catch (e) {
      showToast('No se pudo marcar la parada', e?.falta ? MSG_FUNCION_DE_RUTA_FALTA : mensajeAmigable(e), 'error');
    }
    finally { setBusyStop(null); }
  };

  const handleCerrarConPendientes = async (motivo) => {
    setBusyRuta('cerrar');
    try {
      const { error } = await cerrarRutaConMotivo({ rutaId: ruta.id, motivo });
      if (error) throw error;
      setCerrarAbierto(false);
      onRefresh();
    } catch (e) {
      showToast('No se pudo cerrar la ruta', e?.falta ? MSG_FUNCION_DE_RUTA_FALTA : mensajeAmigable(e), 'error');
    }
    finally { setBusyRuta(null); }
  };

  const handleVueltaBase = async () => {
    setBusyRuta('vuelta');
    try {
      const { error } = await completarRuta(ruta.id);
      if (error) throw error;
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
            {total === 0 && (
              <p className="text-caption text-content-3 px-1">Sin paradas: las que tenía se devolvieron para otra ruta.</p>
            )}
            {paradas.map((stop, idx) => {
              const isEntregado = !!stop.entregado_at;
              const isBusy = busyStop === stop.id;

              return (
                <div key={stop.id} data-surface={isEntregado ? undefined : 'card'} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${isEntregado ? 'bg-success/10 border-success/30' : ''}`}>
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
                      {!isEntregado && stop.no_entregado_at && (
                        <Badge variant="danger" size="sm" uppercase={false}>No entregada</Badge>
                      )}
                    </div>
                  </div>

                  {/* Acciones de la parada. «Entregué» era sólo del conductor:
                      si él no podía marcar (sin señal, sin teléfono), nadie
                      podía. Quien gestiona rutas también la marca, y además
                      puede devolverla cuando no se pudo entregar. */}
                  {!isEntregado && !stop.no_entregado_at && ruta.status === 'en_ruta' && !isBranch && (isConductor || canEdit) && (
                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      {gestiona && (
                        <Button variant="secondary" icon={XCircle} disabled={isBusy} onClick={() => setNoEntregada(stop)}>No se pudo entregar</Button>
                      )}
                      <Button tone="success" icon={CheckCircle2} loading={isBusy} onClick={() => handleEntregarStop(stop)}>
                        {isConductor ? 'Entregué' : 'Marcar entregada'}
                      </Button>
                    </div>
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
              {/* Una ruta armada «para después» la arranca su conductor o
                  quien gestiona rutas (puede haberla armado para otro). */}
              {ruta.status === 'pendiente' && (isConductor || canEdit) && (
                <Button tone="chart-3" icon={Play} loading={busyRuta === 'iniciar'} onClick={handleIniciarRuta}>Iniciar ruta</Button>
              )}
              {/* Sin `total > 0`: si todas las paradas se devolvieron («No se
                  pudo entregar» las saca de la ruta), la ruta queda vacía en la
                  calle y necesita volver igual — antes no tenía salida. */}
              {ruta.status === 'en_ruta' && (isConductor || canEdit) && pendientes === 0 && (
                <Button tone="chart-8" icon={Home} loading={busyRuta === 'vuelta'} onClick={handleVueltaBase}>Volver a base</Button>
              )}
              {ruta.status === 'en_ruta' && gestiona && pendientes > 0 && (
                <Button variant="secondary" icon={Flag} loading={busyRuta === 'cerrar'} onClick={() => setCerrarAbierto(true)}>
                  Cerrar ruta
                </Button>
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
      <PromptModal
        isOpen={!!noEntregada}
        onClose={() => setNoEntregada(null)}
        onConfirm={handleNoEntregada}
        title="No se pudo entregar"
        message={noEntregada ? `${noEntregada.suc_name} vuelve a quedar disponible para otra ruta. ¿Qué pasó?` : undefined}
        placeholder="Ej.: la sala estaba cerrada"
        confirmText="Devolver la parada"
        isProcessing={!!noEntregada && busyStop === noEntregada.id}
        required
      />
      <PromptModal
        isOpen={cerrarAbierto}
        onClose={() => setCerrarAbierto(false)}
        onConfirm={handleCerrarConPendientes}
        title="Cerrar ruta"
        message={`Quedan ${pendientes} parada${pendientes !== 1 ? 's' : ''} sin entregar. La ruta se cierra igual y queda anotado el motivo.`}
        placeholder="Ej.: el camión se averió"
        confirmText="Cerrar ruta"
        isProcessing={busyRuta === 'cerrar'}
        required
      />
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
    try { setRutas(await fetchRutasDeEntrega()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRutas(); }, [loadRutas]);

  // Realtime: recarga cuando cambia el estado de rutas o paradas
  useEffect(() => {
    return escucharCambios('rutas-realtime', [{ tabla: 'rutas' }, { tabla: 'ruta_pedidos' }], () => loadRutas());
  }, [loadRutas]);

  // ── Filtros (2026-10-07) ─────────────────────────────────────────────
  // Antes la pestaña pintaba TODAS las rutas —las activas y las últimas 50
  // completadas, cada una abierta con todas sus paradas— y lo que importa
  // ahora (lo que va en la calle) quedaba perdido entre historial. Por
  // defecto: sólo las activas. Las completadas se piden, por período y por
  // conductor, y entran cerradas. Los tres filtros viven en la dirección.
  const [params, setParams] = useSearchParams();
  const ESTADOS  = ['activas', 'completadas', 'todas'];
  const PERIODOS = { hoy: 0, '7d': 7, '30d': 30 };
  const estado    = ESTADOS.includes(params.get('estado')) ? params.get('estado') : 'activas';
  const periodo   = Object.hasOwn(PERIODOS, params.get('periodo') ?? '') ? params.get('periodo') : '7d';
  const conductor = params.get('conductor') ?? '';
  const ponerParam = useCallback((clave, valor, porDefecto) => setParams(p => {
    if (!valor || valor === porDefecto) p.delete(clave); else p.set(clave, valor);
    return p;
  }, { replace: true }), [setParams]);

  const conductores = useMemo(() =>
    [...new Set(rutas.map(r => r.conductor_nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
      .map(n => ({ value: n, label: n })), [rutas]);

  const desde = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - PERIODOS[periodo]);
    return d.getTime();
  }, [periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  // La búsqueda (número o conductor) es la del núcleo, `filtrarRutas`; el
  // conductor elegido en el filtro se aplica encima.
  const filtered = useMemo(() => filtrarRutas(rutas, searchTerm)
    .filter(r => !conductor || r.conductor_nombre === conductor), [rutas, searchTerm, conductor]);

  const { activas: active, completadas: completadasTodas } = separarRutas(filtered);
  const completed = completadasTodas.filter(r =>
    new Date(r.vuelta_base_at ?? r.salida_at ?? r.created_at).getTime() >= desde);
  const verActivas     = estado !== 'completadas';
  const verCompletadas = estado !== 'activas';

  // Las cifras de arriba: lo que pasa HOY, sin importar el filtro.
  const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
  const enCalle      = rutas.filter(r => r.status === 'en_ruta' || r.status === 'con_alerta');
  const pendientes   = rutas.filter(r => r.status === 'pendiente');
  const cerradasHoy  = rutas.filter(r => r.status === 'completada'
    && new Date(r.vuelta_base_at ?? r.salida_at ?? r.created_at) >= inicioHoy);
  const paradasVivas = [...enCalle, ...pendientes].flatMap(r => r.ruta_pedidos ?? []);
  const entregadasVivas = paradasVivas.filter(p => p.entregado_at).length;

  const activosFiltro = (estado !== 'activas' ? 1 : 0) + (conductor ? 1 : 0) + (verCompletadas && periodo !== '7d' ? 1 : 0);

  return (
    /* El resto de las pestañas de la vista envuelve su contenido en `p-4`;
       ésta no lo hacía, así que sus tarjetas quedaban pegadas al borde de la
       pantalla en el teléfono —el cuerpo de `GlassViewLayout` va sin relleno
       lateral bajo `md`— y desalineadas respecto de las otras cuatro. */
    <div className="space-y-4 p-4">
      {/* ── Cifras y filtros — una fila (§17.0) ── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <CarrilCards className="flex-1" ariaLabel="Rutas de hoy">
          <StatCard icon={Truck} label="En la calle" value={enCalle.length} loading={loading}
            iconBg="bg-chart-3/10" iconCls="text-chart-3-text" sub={`${entregadasVivas}/${paradasVivas.length} paradas entregadas`}
            active={estado === 'activas'} onClick={() => ponerParam('estado', 'activas', 'activas')} />
          <StatCard icon={Clock} label="Por salir" value={pendientes.length} loading={loading}
            sub="rutas armadas, sin salir" />
          <StatCard icon={PackageCheck} label="Completadas hoy" value={cerradasHoy.length} loading={loading}
            active={estado === 'completadas'} onClick={() => ponerParam('estado', 'completadas', 'activas')} />
        </CarrilCards>
        <div className="flex justify-end min-w-0">
          <FilterBar
            onClear={() => setParams(p => { p.delete('estado'); p.delete('periodo'); p.delete('conductor'); return p; }, { replace: true })}
            activeCount={activosFiltro}
            acciones={canEdit && !isBranch ? [{ key: 'crear', icon: Plus, label: 'Crear ruta', variant: 'primary', onClick: () => setCrearOpen(true) }] : []}
          >
            <FilterBar.Section active={estado !== 'activas'} onClear={() => ponerParam('estado', '', 'activas')} label="estado">
              <SegmentedControl size="sm" tone="brand" label="Estado" value={estado}
                onChange={v => ponerParam('estado', v, 'activas')}
                options={[{ value: 'activas', label: 'Activas' }, { value: 'completadas', label: 'Completadas' }, { value: 'todas', label: 'Todas' }]} />
            </FilterBar.Section>
            {verCompletadas && (
              <FilterBar.Section active={periodo !== '7d'} onClear={() => ponerParam('periodo', '', '7d')} label="período">
                <SegmentedControl size="sm" tone="brand" label="Período" value={periodo}
                  onChange={v => ponerParam('periodo', v, '7d')}
                  options={[{ value: 'hoy', label: 'Hoy' }, { value: '7d', label: '7 días' }, { value: '30d', label: '30 días' }]} />
              </FilterBar.Section>
            )}
            {conductores.length > 1 && (
              <FilterBar.Section active={!!conductor} onClear={() => ponerParam('conductor', '', '')} label="conductor">
                <FilterBar.Opciones label="Conductor" icon={User} value={conductor} onChange={v => ponerParam('conductor', v, '')}
                  umbral={1} ancho="170px" placeholder="Conductores" options={conductores} />
              </FilterBar.Section>
            )}
          </FilterBar>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><SkeletonText lines={4} className="w-full max-w-md" /></div>
      ) : (verActivas ? active.length : 0) + (verCompletadas ? completed.length : 0) === 0 ? (
        /* §18.1 · §26.2 — el canónico, y los dos vacíos separados. Estaba
           escrito a mano y decía «Sin rutas activas» también cuando el
           buscador no encontraba nada: dos estados que se arreglan de forma
           distinta contados como uno solo. */
        searchTerm.trim() || conductor ? (
          <EmptyState
            icon={Search}
            title="Sin resultados"
            subtitle={searchTerm.trim() ? `Ninguna ruta coincide con "${searchTerm}".` : 'Ninguna ruta de ese conductor en lo que estás viendo.'}
          />
        ) : estado === 'activas' && rutas.length > 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Sin rutas en la calle"
            subtitle="Todas las rutas volvieron a base. Las completadas están en el filtro de estado."
            action={canEdit && !isBranch ? <Button variant="primary" icon={Plus} onClick={() => setCrearOpen(true)}>Crear ruta</Button> : undefined}
          />
        ) : (
          <EmptyState
            icon={Navigation}
            title="Sin rutas"
            subtitle={canEdit && !isBranch
              ? 'Crea una ruta para agrupar las entregas del día.'
              : 'Aquí aparecen las entregas cuando bodega arma una ruta.'}
            action={canEdit && !isBranch
              ? <Button variant="primary" icon={Plus} onClick={() => setCrearOpen(true)}>Crear ruta</Button>
              : undefined}
          />
        )
      ) : (
        <>
          {/* Active routes */}
          {verActivas && active.length > 0 && (
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
          {verCompletadas && completed.length > 0 && (
            <div className="space-y-3">
              {/* «Completadas hoy» era falso: `fetchRutasConParadas` trae las
                  últimas 50 por fecha de creación, sin recortar por día. */}
              <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <CheckCircle2 size={10} /> Completadas · {completed.length}
              </p>
              {completed.map(ruta => (
                <RutaCard
                  key={ruta.id}
                  abierta={false}
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
