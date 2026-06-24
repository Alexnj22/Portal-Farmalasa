import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Truck, ChevronUp, ChevronDown, MapPin, User, Package, Clock, ArrowRight, CheckCircle2, Loader2, Navigation, Warehouse } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import PedidoModal from './PedidoModal';
import { optimizeRoute, optimizeRouteGoogleMaps, totalRoute, haversineMeters, loadGoogleMaps, loadLeaflet } from '../../utils/routeOptimizer';

function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtMin(min) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// Tiempo fijo de descarga por parada — se recalibrará con datos reales
function svcMin() { return 10; }

export default function CrearRutaModal({ open, onClose, onCreated }) {
  const { user } = useAuth();

  const [step, setStep] = useState(1);

  // Data
  const [conductorNombre, setConductorNombre] = useState('');
  const [conductorPhoto,  setConductorPhoto]  = useState(null);
  const [pedidosDisp,     setPedidosDisp]     = useState([]);
  const [coordsMap,       setCoordsMap]       = useState({});
  const [bodegaCoords,    setBodegaCoords]    = useState(null);
  const [loadingData,     setLoadingData]     = useState(true);

  // Step 1
  const [selected, setSelected] = useState(new Set());

  // Step 2
  const [paradas,    setParadas]    = useState([]);
  const [optimizing, setOptimizing] = useState(false);
  const [mapsMode,   setMapsMode]   = useState(false);
  const [returnLeg,  setReturnLeg]  = useState(null); // tramo de vuelta a bodega
  const mapRef = useRef(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [mapError,   setMapError]   = useState(false);

  // ── Load data on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected(new Set());
    setParadas([]);
    setReturnLeg(null);
    setMapError(false);
    setLoadingData(true);

    if (user?.id) {
      supabase.from('employees')
        .select('first_names, last_names, photo_url')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setConductorNombre(data ? `${data.first_names} ${data.last_names}`.trim() : (user.email ?? 'Usuario'));
          setConductorPhoto(data?.photo_url ?? null);
        });
    }

    Promise.all([
      supabase.from('pedidos')
        .select('id, numero')
        .eq('status', 'confirmado')
        .order('numero'),

      supabase.from('pedido_sucursal_status')
        .select('pedido_id, erp_sucursal_id, total_cajas, cajas_electrolit, finalizado_at')
        .not('finalizado_at', 'is', null),

      supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, es_bodega, branch:branches!inner(settings, name)')
        .order('erp_sucursal_id'),
    ]).then(([pedRes, pssRes, coordRes]) => {
      const pedidoMap = {};
      for (const p of (pedRes.data ?? [])) pedidoMap[p.id] = p;

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

      const items = [];
      for (const pss of (pssRes.data ?? [])) {
        const p = pedidoMap[pss.pedido_id];
        if (!p) continue;
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

  // ── Timeline con tiempos acumulados (reactivo al orden) ───────────────────
  const timeline = useMemo(() => {
    let cumul = 0;
    return paradas.map(stop => {
      const cajas = stop.items?.reduce((s, it) => s + (it.total_cajas ?? 0), 0) ?? 0;
      const drive = stop.dur_min ?? 0;
      const svc   = svcMin(cajas);
      cumul += drive;
      return { stop, cajas, drive, svc, cumul };
    });
  }, [paradas]);

  const totalDriveMin = paradas.reduce((s, p) => s + (p.dur_min ?? 0), 0) + (returnLeg?.dur_min ?? 0);
  const totalTime     = (timeline[timeline.length - 1]?.cumul ?? 0) + (returnLeg?.dur_min ?? 0);
  const totalDist     = totalRoute(paradas.filter(s => s.dist_m != null)).dist_m + (returnLeg?.dist_m ?? 0);

  // ── Map rendering (Google Maps JS → Leaflet + proxy fallback) ───────────
  useEffect(() => {
    if (step !== 2 || !paradas.length || !bodegaCoords) return;
    let cancelled = false;
    let authFailed = false;

    // Haversine return leg inmediato; se actualiza si Directions API responde
    const lastCoords = coordsMap[paradas[paradas.length - 1]?.erp_sucursal_id];
    if (lastCoords && !returnLeg) {
      const dm = haversineMeters(lastCoords.lat, lastCoords.lng, bodegaCoords.lat, bodegaCoords.lng);
      setReturnLeg({ dist_m: Math.round(dm), dur_min: Math.max(1, Math.round(dm / 1000 / 40 * 60)) });
    }

    const orderedPoints = [
      bodegaCoords,
      ...paradas.map(p => coordsMap[p.erp_sucursal_id]).filter(Boolean),
      bodegaCoords,
    ];
    const fallbackLatLngs = orderedPoints.map(p => [p.lat, p.lng]);

    // Leaflet con polyline (real vía proxy o recta como último recurso)
    async function initLeaflet(useProxyPolyline = true) {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapRef.current) return;
        mapRef.current.innerHTML = '';
        const lmap = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(lmap);

        let polylineLatLngs = fallbackLatLngs;
        if (useProxyPolyline) {
          try {
            const dirs = await getDirectionsREST(orderedPoints);
            if (dirs && !cancelled) {
              polylineLatLngs = dirs.polylinePoints;
              if (dirs.returnLeg) setReturnLeg(dirs.returnLeg);
              setMapsMode(true);
              console.log('[maps] Directions proxy OK — ruta real dibujada');
            }
          } catch (e) {
            console.warn('[maps] Directions proxy falló:', e?.message ?? e);
          }
        }

        if (cancelled) return;
        L.polyline(polylineLatLngs, { color: '#6366f1', weight: 5, opacity: 0.85 }).addTo(lmap);
        L.marker([bodegaCoords.lat, bodegaCoords.lng], {
          icon: L.divIcon({ className: '', html: `<div style="width:30px;height:30px;border-radius:50%;background:#1e1b4b;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:13px">🏭</div>`, iconSize: [30,30], iconAnchor: [15,15] }),
          title: 'Bodega',
        }).addTo(lmap);
        paradas.forEach((stop, i) => {
          const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
          L.marker([c.lat, c.lng], {
            icon: L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50%;background:#6366f1;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">${i+1}</div>`, iconSize: [26,26], iconAnchor: [13,13] }),
            title: stop.suc_name,
          }).addTo(lmap);
        });
        lmap.fitBounds(polylineLatLngs.filter(p => p[0] && p[1]), { padding: [20, 20] });
      } catch (e) {
        console.error('[maps] Leaflet init error:', e);
        if (!cancelled) setMapError(true);
      }
    }

    // Intentar Google Maps JS SDK primero
    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      console.warn('[maps] gm_authFailure — Maps JS key inválida, usando Leaflet');
      if (!authFailed) { authFailed = true; initLeaflet(); }
      if (prevAuthFailure) prevAuthFailure();
    };

    loadGoogleMaps().then(maps => {
      if (cancelled || !mapRef.current) return;
      console.log('[maps] Google Maps JS cargado OK');
      const origin  = new maps.LatLng(bodegaCoords.lat, bodegaCoords.lng);
      const mapInst = new maps.Map(mapRef.current, {
        zoom: 11, center: { lat: bodegaCoords.lat, lng: bodegaCoords.lng },
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
        styles: [{ featureType:'poi', stylers:[{visibility:'off'}] }, { featureType:'transit', stylers:[{visibility:'off'}] }],
      });
      if (authFailed) return;
      const dr = new maps.DirectionsRenderer({ map: mapInst, suppressMarkers: true, polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5, strokeOpacity: 0.85 } });
      new maps.DirectionsService().route({
        origin, destination: origin,
        waypoints: paradas.filter(p => coordsMap[p.erp_sucursal_id]).map(p => ({ location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng), stopover: true })),
        travelMode: maps.TravelMode.DRIVING, optimizeWaypoints: false,
      }, (result, status) => {
        if (cancelled || authFailed) return;
        console.log('[maps] DirectionsService status:', status);
        if (status === 'OK') {
          dr.setDirections(result);
          const retLeg = result.routes[0].legs.at(-1);
          if (retLeg) setReturnLeg({ dist_m: retLeg.distance.value, dur_min: Math.max(1, Math.round(retLeg.duration.value / 60)) });
          setMapsMode(true);
        } else {
          new maps.Polyline({ path: fallbackLatLngs.map(p => ({ lat: p[0], lng: p[1] })), map: mapInst, strokeColor: '#6366f1', strokeWeight: 4, strokeOpacity: 0.7 });
        }
        const mkSvg = (label, fill, size) => encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-1.5}" fill="${fill}" stroke="white" stroke-width="2.5"/><text x="${size/2}" y="${size/2+4}" text-anchor="middle" fill="white" font-size="${size*0.4}" font-weight="bold">${label}</text></svg>`);
        new maps.Marker({ position: origin, map: mapInst, zIndex: 100, title: 'Bodega', icon: { url: `data:image/svg+xml;utf8,${mkSvg('🏭','#1e1b4b',34)}`, scaledSize: new maps.Size(34,34), anchor: new maps.Point(17,17) } });
        paradas.forEach((stop, i) => {
          const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
          new maps.Marker({ position: { lat: c.lat, lng: c.lng }, map: mapInst, zIndex: 90-i, title: stop.suc_name, icon: { url: `data:image/svg+xml;utf8,${mkSvg(i+1,'#6366f1',30)}`, scaledSize: new maps.Size(30,30), anchor: new maps.Point(15,15) } });
        });
      });
    }).catch(err => {
      console.warn('[maps] loadGoogleMaps error:', err?.message ?? err);
      if (!cancelled && !authFailed) initLeaflet();
    });

    return () => {
      cancelled = true;
      window.gm_authFailure = prevAuthFailure;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bodegaCoords]);

  // ── Step 1 → 2: optimize ──────────────────────────────────────────────────
  const handleOptimize = useCallback(async () => {
    if (!selectedItems.length) return;
    setOptimizing(true);
    setReturnLeg(null);

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
      optimized = await optimizeRouteGoogleMaps(stopsWithCoords, bodega);
      usedMaps  = true;
    } catch {
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

  // ── Reorder ────────────────────────────────────────────────────────────────
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
        p_distancia_total_m: (totalDist || totals.dist_m) || null,
        p_duracion_min:      totalDriveMin || totals.dur_min || null,
        p_creado_por:        user?.id ?? null,
      });
      if (error) throw error;

      useStaff.getState().appendAuditLog('RUTA_CREADA', rutaId, {
        conductor: conductorNombre,
        paradas:   rpcParadas.length,
      });

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
          target_type:  'BRANCH', target_value: [mapa.branch_id],
          read_by: [], is_archived: false,
          created_by: user?.id ?? null, priority: 'NORMAL',
        }).catch(() => {});

        supabase.functions.invoke('send-push-notification', {
          body: {
            title:        `Pedido ${numeros} en camino`,
            message:      `Tu pedido ya salió de bodega${cajasStr}. Prepárate para recibirlo.`,
            url:          '/pedidos',
            target_type:  'BRANCH', target_value: [mapa.branch_id],
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
  }, [conductorNombre, paradas, submitting, user, totalDist, totalDriveMin, onCreated, onClose]);

  if (!open) return null;

  return (
    <PedidoModal open onClose={onClose} maxWidth="max-w-xl">
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

      <PedidoModal.Body className="px-5 py-4 space-y-4">
        {loadingData ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : step === 1 ? (
          <>
            {/* Conductor (auto = usuario actual) */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-indigo-50 rounded-xl border border-indigo-100">
              {conductorPhoto
                ? <img src={conductorPhoto} className="w-7 h-7 rounded-full object-cover border-2 border-indigo-200 shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0"><User size={13} className="text-white" /></div>
              }
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
                  <button onClick={toggleAll} className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors">
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
                      <button key={item.key} onClick={() => toggleItem(item.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          isSel ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                        }`}>
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
            {/* ── Mapa ──────────────────────────────────────────────────── */}
            <div className="relative rounded-2xl overflow-hidden border border-indigo-100 shadow-sm" style={{ height: 220 }}>
              {mapError ? (
                <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center gap-2 text-center px-4">
                  <MapPin size={20} className="text-slate-300" />
                  <p className="text-[11px] font-semibold text-slate-500">Mapa no disponible</p>
                  <p className="text-[10px] text-slate-400 max-w-[220px]">
                    La API key de Google Maps no está habilitada para Maps JavaScript API o tiene restricciones de dominio.
                  </p>
                </div>
              ) : (
                <div ref={mapRef} className="w-full h-full" />
              )}
              {/* Badge fuente */}
              {!mapError && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 text-[9px] font-semibold text-slate-600 shadow-sm border border-white/60">
                  {mapsMode
                    ? <><Navigation size={8} className="text-emerald-500" />Ruta real · Google</>
                    : <><MapPin size={8} className="text-amber-400" />Estimado · OpenStreetMap</>
                  }
                </div>
              )}
            </div>

            {/* ── Conductor ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200">
              {conductorPhoto
                ? <img src={conductorPhoto} className="w-6 h-6 rounded-full object-cover border border-slate-200 shrink-0" />
                : <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0"><User size={11} className="text-white" /></div>
              }
              <span className="text-[12px] text-slate-600 font-medium">Conductor:</span>
              <span className="text-[12px] font-bold text-slate-800">{conductorNombre}</span>
            </div>

            {/* ── Timeline de paradas ───────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
                <Clock size={10} />Orden y tiempos estimados
              </p>

              <div className="relative">
                {/* Línea vertical de fondo */}
                <div className="absolute left-[13px] top-7 bottom-7 w-px bg-gradient-to-b from-slate-300 via-indigo-200 to-slate-300" />

                {/* Bodega (partida) */}
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-7 h-7 rounded-full bg-slate-800 border-2 border-white shadow-md flex items-center justify-center shrink-0 z-10">
                    <Warehouse size={11} className="text-white" />
                  </div>
                  <div className="flex-1 py-1">
                    <p className="text-[11px] font-bold text-slate-700">Bodega — Punto de partida</p>
                  </div>
                </div>

                {/* Paradas */}
                {timeline.map(({ stop, cajas, drive, svc, cumul }, idx) => (
                  <div key={stop.erp_sucursal_id}>
                    {/* Tramo de conducción */}
                    <div className="flex items-center gap-3 my-0.5 ml-3">
                      <div className="w-px h-5 bg-indigo-200 mx-auto" style={{ marginLeft: 0 }} />
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-medium pl-0">
                        <Clock size={8} className="text-indigo-300" />
                        {stop.dist_m ? `${fmtDist(stop.dist_m)} · ` : ''}{drive > 0 ? `${drive} min conduciendo` : 'sin datos'}
                      </div>
                    </div>

                    {/* Card de la parada */}
                    <div className="flex items-start gap-3">
                      {/* Número + flechas */}
                      <div className="flex flex-col items-center gap-0.5 z-10">
                        <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-black shrink-0">
                          {stop.orden}
                        </div>
                        <div className="flex flex-col gap-0">
                          <button onClick={() => moveStop(idx, -1)} disabled={idx === 0}
                            className="p-0 text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors leading-none">
                            <ChevronUp size={11} />
                          </button>
                          <button onClick={() => moveStop(idx, 1)} disabled={idx === paradas.length - 1}
                            className="p-0 text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors leading-none">
                            <ChevronDown size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Info de la parada */}
                      <div className="flex-1 bg-indigo-50/70 border border-indigo-100 rounded-xl px-3 py-2 mb-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-bold text-slate-800 truncate">{stop.suc_name}</p>
                            <p className="text-[10px] text-slate-500 mt-px">
                              {stop.items.map(it => `#${it.numero}`).join(', ')}
                              {cajas > 0 && <> · {cajas} caja{cajas !== 1 ? 's' : ''}</>}
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                              Descarga en cálculo
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[8px] text-slate-400 uppercase tracking-wider">acumulado</p>
                            <p className="text-[15px] font-black text-indigo-700 leading-tight">{fmtMin(cumul)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Tramo de vuelta a bodega */}
                {returnLeg && (
                  <>
                    <div className="flex items-center gap-3 my-0.5 ml-3">
                      <div className="w-px h-5 bg-slate-200 mx-auto" style={{ marginLeft: 0 }} />
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-medium">
                        <Clock size={8} className="text-slate-300" />
                        {fmtDist(returnLeg.dist_m)} · {returnLeg.dur_min} min regreso a base
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border-2 border-white shadow-md flex items-center justify-center shrink-0 z-10">
                        <Warehouse size={11} className="text-white" />
                      </div>
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-bold text-slate-700">Bodega — Vuelta en base</p>
                          <div className="text-right">
                            <p className="text-[8px] text-slate-400 uppercase tracking-wider">total estimado</p>
                            <p className="text-[15px] font-black text-slate-800 leading-tight">{fmtMin(totalTime)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Resumen total */}
              {totalDist > 0 && (
                <div className="mt-3 flex gap-2">
                  <div className="flex-1 bg-indigo-50 rounded-xl px-3 py-2 border border-indigo-100 text-center">
                    <p className="text-[9px] text-indigo-400 font-semibold uppercase tracking-wider">Distancia</p>
                    <p className="text-[15px] font-black text-indigo-700">{fmtDist(totalDist)}</p>
                    <p className="text-[8px] text-indigo-300">ida + vuelta a bodega</p>
                  </div>
                  <div className="flex-1 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100 text-center">
                    <p className="text-[9px] text-amber-500 font-semibold uppercase tracking-wider">Tiempo total</p>
                    <p className="text-[15px] font-black text-amber-700">{fmtMin(totalTime)}</p>
                    <p className="text-[8px] text-amber-300">conducir + descargas</p>
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200 text-center">
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Solo conducir</p>
                    <p className="text-[15px] font-black text-slate-600">{fmtMin(totalDriveMin)}</p>
                    <p className="text-[8px] text-slate-300">sin descargas</p>
                  </div>
                </div>
              )}
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
            <button onClick={handleOptimize} disabled={selectedItems.length === 0 || optimizing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {optimizing
                ? <><Loader2 size={14} className="animate-spin" />Calculando ruta…</>
                : <><ArrowRight size={14} />Ver ruta optimizada</>
              }
            </button>
          </>
        ) : (
          <>
            <button onClick={() => { setStep(1); setReturnLeg(null); }}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors">
              ← Atrás
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              Crear Ruta
            </button>
          </>
        )}
      </PedidoModal.Footer>
    </PedidoModal>
  );
}
