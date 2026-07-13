import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, MapPin, CheckCircle2, Clock, Crosshair, Truck, Radio, RefreshCw } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import PedidoModal from './PedidoModal';
import { loadGoogleMaps, loadLeaflet } from '../../utils/routeOptimizer';

// Capacitor geolocation nativa — solo disponible en app nativa (Android/iOS)
const isNative = !!(window.Capacitor?.isNativePlatform?.());
let CapGeo = null;
let BgGeo  = null;
if (isNative) {
  import(/* @vite-ignore */ '@capacitor/geolocation').then(m => { CapGeo = m.Geolocation; }).catch(() => {});
  import(/* @vite-ignore */ '@capacitor-community/background-geolocation').then(m => { BgGeo = m.BackgroundGeolocation; }).catch(() => {});
}

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function RutaMapModal({ ruta, open, onClose, currentUserId }) {
  const isConductor = !!(currentUserId && ruta?.conductor_id && String(currentUserId) === String(ruta.conductor_id));

  // ── DOM / Maps refs ─────────────────────────────────────────────────────────
  const mapRef          = useRef(null);
  const mapInstRef      = useRef(null);
  const mapsApiRef      = useRef(null);
  const gpsMarkerRef    = useRef(null);   // punto azul — GPS propio del conductor
  const driverMarkerRef = useRef(null);   // camión — posición conductor vista por admin
  const dirRendererRef  = useRef(null);   // DirectionsRenderer para recálculo
  const leafletMapRef   = useRef(null);
  const leafletGpsRef   = useRef(null);
  const leafletDrvRef   = useRef(null);
  const watchIdRef      = useRef(null);
  const latestGpsPosRef = useRef(null);   // sin stale closures en intervalos
  const firstWriteRef   = useRef(false);

  // ── State ──────────────────────────────────────────────────────────────────
  const [coordsMap,    setCoordsMap]    = useState({});
  const [bodegaCoords, setBodegaCoords] = useState(null);
  const [gpsPos,       setGpsPos]       = useState(null);
  const [gpsStatus,    setGpsStatus]    = useState('idle');
  const [driverPos,    setDriverPos]    = useState(null);
  const [driverOnline, setDriverOnline] = useState(false);
  const [mapReady,     setMapReady]     = useState(false);
  const [mapsMode,     setMapsMode]     = useState(false);
  const [recalcCount,  setRecalcCount]  = useState(0);

  const [localParadas, setLocalParadas] = useState(null);
  const paradas = (localParadas ?? [...(ruta?.ruta_pedidos ?? [])]).sort((a, b) => a.orden_entrega - b.orden_entrega);
  const entregadas = paradas.filter(p => p.entregado_at).length;

  // ── Sync GPS pos → ref (evita stale closures en intervalos) ────────────────
  useEffect(() => { latestGpsPosRef.current = gpsPos; }, [gpsPos]);

  // ── Suscripción live a ruta_pedidos (actualiza marcadores sin reabrir modal) ─
  useEffect(() => {
    if (!open || !ruta?.id) return;
    const ch = supabase.channel(`ruta-stops-live-${ruta.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ruta_pedidos',
        filter: `ruta_id=eq.${ruta.id}` }, (payload) => {
        setLocalParadas(prev => {
          const base = prev ?? [...(ruta?.ruta_pedidos ?? [])];
          return base.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
        });
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [open, ruta?.id]); // eslint-disable-line

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) return;
    setLocalParadas(null);
    setCoordsMap({});
    setBodegaCoords(null);
    setGpsPos(null);
    setGpsStatus('idle');
    setDriverPos(null);
    setDriverOnline(false);
    setMapReady(false);
    setMapsMode(false);
    setRecalcCount(0);
    mapInstRef.current    = null;
    mapsApiRef.current    = null;
    gpsMarkerRef.current  = null;
    driverMarkerRef.current = null;
    dirRendererRef.current  = null;
    leafletMapRef.current   = null;
    leafletGpsRef.current   = null;
    leafletDrvRef.current   = null;
    latestGpsPosRef.current = null;
    firstWriteRef.current   = false;
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, [open]);

  // ── Cargar coordenadas de sucursales ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    supabase.from('erp_sucursal_map')
      .select('erp_sucursal_id, es_bodega, branch:branches!inner(settings, name)')
      .then(({ data }) => {
        const cm = {};
        let bodega = null;
        for (const row of data ?? []) {
          const loc = row.branch?.settings?.location ?? {};
          const lat = parseFloat(loc.lat), lng = parseFloat(loc.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            cm[row.erp_sucursal_id] = { lat, lng };
            if (row.es_bodega) bodega = { lat, lng };
          }
        }
        setCoordsMap(cm);
        setBodegaCoords(bodega);
      });
  }, [open]);

  // ── GPS propio — solo conductor ─────────────────────────────────────────────
  const startGps = useCallback(async () => {
    setGpsStatus('loading');
    try {
      if (isNative && BgGeo) {
        // App nativa: background geolocation — funciona con pantalla apagada
        const id = await BgGeo.addWatcher(
          { backgroundTitle: 'Ruta activa', backgroundMessage: 'Rastreando tu posición para la entrega.', requestPermissions: true, stale: false, distanceFilter: 20 },
          (loc, err) => {
            if (err) { console.warn('[BgGeo]', err); return; }
            setGpsPos({ lat: loc.latitude, lng: loc.longitude });
            setGpsStatus('ok');
          }
        );
        watchIdRef.current = id;
      } else if (isNative && CapGeo) {
        // App nativa sin BgGeo — usar @capacitor/geolocation (solo foreground)
        await CapGeo.requestPermissions({ permissions: ['location'] });
        const pos = await CapGeo.getCurrentPosition({ enableHighAccuracy: true });
        setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus('ok');
        const id = await CapGeo.watchPosition({ enableHighAccuracy: true, timeout: 10000 },
          (p, err) => {
            if (err) return;
            setGpsPos({ lat: p.coords.latitude, lng: p.coords.longitude });
          }
        );
        watchIdRef.current = id;
      } else if (navigator.geolocation) {
        // Web — watchPosition estándar
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setGpsStatus('ok');
            setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            watchIdRef.current = navigator.geolocation.watchPosition(
              (p) => setGpsPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
              (err) => console.warn('[GPS] watch:', err.code),
              { enableHighAccuracy: true, maximumAge: 5000 },
            );
          },
          (err) => { setGpsStatus(err.code === 1 ? 'denied' : 'timeout'); },
          { enableHighAccuracy: true, timeout: 15000 },
        );
      } else {
        setGpsStatus('denied');
      }
    } catch (err) {
      console.warn('[GPS] startGps error:', err);
      setGpsStatus('denied');
    }
  }, []);

  const stopGps = useCallback(async () => {
    if (watchIdRef.current === null) return;
    try {
      if (isNative && BgGeo) {
        await BgGeo.removeWatcher({ id: watchIdRef.current });
      } else if (isNative && CapGeo) {
        await CapGeo.clearWatch({ id: watchIdRef.current });
      } else {
        navigator.geolocation?.clearWatch(watchIdRef.current);
      }
    } catch { /* ignore cleanup errors */ }
    watchIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!open || !isConductor) return;
    startGps();
    return () => { stopGps(); };
  }, [open, isConductor, startGps, stopGps]);

  // ── Admin: posición inicial + suscripción Realtime ──────────────────────────
  useEffect(() => {
    if (!open || isConductor) return;

    supabase.from('ruta_locations').select('lat, lng, updated_at')
      .eq('ruta_id', ruta.id).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setDriverPos({ lat: parseFloat(data.lat), lng: parseFloat(data.lng) });
        const ageMin = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
        setDriverOnline(ageMin < 3);
      });

    const channel = supabase.channel(`ruta-loc-${ruta.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ruta_locations',
        filter: `ruta_id=eq.${ruta.id}`,
      }, ({ new: row }) => {
        if (row?.lat != null && row?.lng != null) {
          setDriverPos({ lat: parseFloat(row.lat), lng: parseFloat(row.lng) });
          setDriverOnline(true);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [open, isConductor, ruta.id]);

  // ── Conductor: escribir posición en DB cada 30 s ───────────────────────────
  useEffect(() => {
    if (!open || !isConductor) return;
    const interval = setInterval(() => {
      const pos = latestGpsPosRef.current;
      if (!pos) return;
      supabase.from('ruta_locations').upsert(
        { ruta_id: ruta.id, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() },
        { onConflict: 'ruta_id' },
      ).then(() => {}, () => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [open, isConductor, ruta.id]);

  // ── Conductor: recalcular ruta cada 2 minutos ───────────────────────────────
  useEffect(() => {
    if (!open || !isConductor || !mapReady || !bodegaCoords) return;
    const interval = setInterval(() => {
      const pos = latestGpsPosRef.current;
      if (!pos || !mapsApiRef.current || !dirRendererRef.current) return;
      const pending = paradas.filter(p => !p.entregado_at && coordsMap[p.erp_sucursal_id]);
      if (!pending.length) return;
      const maps = mapsApiRef.current;
      new maps.DirectionsService().route({
        origin:      new maps.LatLng(pos.lat, pos.lng),
        destination: new maps.LatLng(bodegaCoords.lat, bodegaCoords.lng),
        waypoints:   pending.map(p => ({
          location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng),
          stopover: true,
        })),
        travelMode:        maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
      }, (result, status) => {
        if (status === 'OK') {
          dirRendererRef.current.setDirections(result);
          setRecalcCount(c => c + 1);
        }
      });
    }, 120_000); // 2 minutos
    return () => clearInterval(interval);
  }, [open, isConductor, mapReady, bodegaCoords, paradas, coordsMap]);

  // ── Actualizar marcador GPS conductor en el mapa ────────────────────────────
  useEffect(() => {
    if (!gpsPos || !isConductor) return;

    // Primera posición: escribir inmediatamente a DB
    if (!firstWriteRef.current) {
      firstWriteRef.current = true;
      supabase.from('ruta_locations').upsert(
        { ruta_id: ruta.id, lat: gpsPos.lat, lng: gpsPos.lng, updated_at: new Date().toISOString() },
        { onConflict: 'ruta_id' },
      ).then(() => {}, () => {});
    }

    if (mapsApiRef.current && mapInstRef.current) {
      const maps = mapsApiRef.current;
      const pos  = new maps.LatLng(gpsPos.lat, gpsPos.lng);
      if (gpsMarkerRef.current) {
        gpsMarkerRef.current.setPosition(pos);
      } else {
        gpsMarkerRef.current = new maps.Marker({
          position: pos, map: mapInstRef.current, zIndex: 200, title: 'Tu ubicación',
          icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#3b82f6', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2.5 },
        });
      }
    } else if (leafletMapRef.current && window.L) {
      const L = window.L, lpos = [gpsPos.lat, gpsPos.lng];
      if (leafletGpsRef.current) leafletGpsRef.current.setLatLng(lpos);
      else leafletGpsRef.current = window.L.circleMarker(lpos, {
        radius: 10, fillColor: '#3b82f6', color: 'white', weight: 2.5, fillOpacity: 1,
      }).addTo(leafletMapRef.current).bindTooltip('Tu ubicación');
    }
  }, [gpsPos, isConductor, ruta.id]);

  // ── Actualizar marcador conductor visto por admin ───────────────────────────
  useEffect(() => {
    if (!driverPos || isConductor) return;
    const mkTruck = (sz) => encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle cx="${sz/2}" cy="${sz/2}" r="${sz/2-1.5}" fill="#1d4ed8" stroke="white" stroke-width="2.5"/><text x="${sz/2}" y="${sz/2+5}" text-anchor="middle" fill="white" font-size="${sz*0.45}">🚚</text></svg>`
    );
    if (mapsApiRef.current && mapInstRef.current) {
      const maps = mapsApiRef.current;
      const latlng = new maps.LatLng(driverPos.lat, driverPos.lng);
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setPosition(latlng);
      } else {
        driverMarkerRef.current = new maps.Marker({
          position: latlng, map: mapInstRef.current, zIndex: 200,
          title: `Conductor: ${ruta.conductor_nombre}`,
          icon: { url: `data:image/svg+xml;utf8,${mkTruck(36)}`, scaledSize: new maps.Size(36, 36), anchor: new maps.Point(18, 18) },
        });
      }
    } else if (leafletMapRef.current && window.L) {
      const L = window.L, lpos = [driverPos.lat, driverPos.lng];
      if (leafletDrvRef.current) leafletDrvRef.current.setLatLng(lpos);
      else leafletDrvRef.current = L.marker(lpos, {
        icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18],
          html: `<div style="width:36px;height:36px;border-radius:50%;background:#1d4ed8;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">🚚</div>` }),
      }).addTo(leafletMapRef.current).bindTooltip(`Conductor: ${ruta.conductor_nombre}`);
    }
  }, [driverPos, isConductor, ruta.conductor_nombre]);

  // ── Renderizar mapa ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !bodegaCoords || !mapRef.current) return;
    let cancelled = false, authFailed = false;

    const mkSvg = (label, fill, size) =>
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-1.5}" fill="${fill}" stroke="white" stroke-width="2.5"/><text x="${size/2}" y="${size/2+4}" text-anchor="middle" fill="white" font-size="${size*0.4}" font-weight="bold">${label}</text></svg>`);

    async function initLeaflet() {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapRef.current) return;
        mapRef.current.innerHTML = '';
        const lmap = L.map(mapRef.current, { zoomControl: true });
        leafletMapRef.current = lmap;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
        }).addTo(lmap);

        const pts = [
          [bodegaCoords.lat, bodegaCoords.lng],
          ...paradas.filter(p => coordsMap[p.erp_sucursal_id]).map(p => [coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng]),
          [bodegaCoords.lat, bodegaCoords.lng],
        ];
        L.polyline(pts, { color: '#6366f1', weight: 5, opacity: 0.8 }).addTo(lmap);

        L.marker([bodegaCoords.lat, bodegaCoords.lng], {
          icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
            html: `<div style="width:30px;height:30px;border-radius:50%;background:#1e1b4b;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px">🏭</div>` }),
        }).addTo(lmap).bindTooltip('Bodega');

        paradas.forEach((stop, i) => {
          const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
          const fill = stop.entregado_at ? '#10b981' : '#6366f1';
          L.marker([c.lat, c.lng], {
            icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
              html: `<div style="width:28px;height:28px;border-radius:50%;background:${fill};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">${i+1}</div>` }),
          }).addTo(lmap).bindTooltip(stop.suc_name ?? `Parada ${i+1}`);
        });

        if (pts.length > 1) lmap.fitBounds(pts, { padding: [30, 30] });
        setMapReady(true);
      } catch (e) { console.error('[RutaMap] Leaflet error:', e); }
    }

    const prevAuth = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (!authFailed) { authFailed = true; initLeaflet(); }
      if (prevAuth) prevAuth();
    };

    loadGoogleMaps().then(maps => {
      if (cancelled || !mapRef.current) return;
      mapsApiRef.current = maps;
      setMapsMode(true);

      const mapInst = new maps.Map(mapRef.current, {
        zoom: 12, center: bodegaCoords,
        disableDefaultUI: false, zoomControl: true, gestureHandling: 'greedy',
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
      });
      mapInstRef.current = mapInst;

      const origin = new maps.LatLng(bodegaCoords.lat, bodegaCoords.lng);
      const withCoords = paradas.filter(p => coordsMap[p.erp_sucursal_id]);

      const dr = new maps.DirectionsRenderer({
        map: mapInst, suppressMarkers: true,
        polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5, strokeOpacity: 0.85 },
      });
      dirRendererRef.current = dr;

      if (withCoords.length > 0) {
        new maps.DirectionsService().route({
          origin, destination: origin,
          waypoints: withCoords.map(p => ({
            location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng),
            stopover: true,
          })),
          travelMode: maps.TravelMode.DRIVING, optimizeWaypoints: false,
        }, (result, status) => {
          if (!cancelled && !authFailed && status === 'OK') dr.setDirections(result);
        });
      }

      // Bodega
      new maps.Marker({
        position: origin, map: mapInst, zIndex: 100, title: 'Bodega',
        icon: { url: `data:image/svg+xml;utf8,${mkSvg('🏭','#1e1b4b',34)}`, scaledSize: new maps.Size(34,34), anchor: new maps.Point(17,17) },
      });

      // Paradas
      paradas.forEach((stop, i) => {
        const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
        const fill = stop.entregado_at ? '#10b981' : '#6366f1';
        new maps.Marker({
          position: { lat: c.lat, lng: c.lng }, map: mapInst, zIndex: 90 - i, title: stop.suc_name,
          icon: { url: `data:image/svg+xml;utf8,${mkSvg(i+1, fill, 30)}`, scaledSize: new maps.Size(30,30), anchor: new maps.Point(15,15) },
        });
      });

      setMapReady(true);
    }).catch(() => { if (!cancelled && !authFailed) initLeaflet(); });

    return () => {
      cancelled = true;
      window.gm_authFailure = prevAuth;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bodegaCoords, coordsMap]);

  // ── Centrar mapa ────────────────────────────────────────────────────────────
  const centerOnPosition = useCallback(() => {
    const pos = isConductor ? gpsPos : driverPos;
    if (!pos) return;
    if (mapInstRef.current && mapsApiRef.current)
      mapInstRef.current.setCenter(new mapsApiRef.current.LatLng(pos.lat, pos.lng)), mapInstRef.current.setZoom(16);
    else if (leafletMapRef.current)
      leafletMapRef.current.setView([pos.lat, pos.lng], 16);
  }, [isConductor, gpsPos, driverPos]);

  if (!open) return null;

  // ── Badges de estado ────────────────────────────────────────────────────────
  const conductorBtnLabel = isConductor
    ? (gpsStatus === 'loading' ? 'Buscando GPS…'
      : gpsStatus === 'denied'  ? 'GPS bloqueado'
      : gpsStatus === 'timeout' ? 'Sin señal — reintentar'
      : gpsStatus === 'ok'      ? 'Centrar en mí'
      : 'Activar GPS')
    : (driverPos ? 'Ver conductor' : 'Sin ubicación aún');

  const conductorBtnDisabled = isConductor
    ? (gpsStatus === 'loading' || gpsStatus === 'denied')
    : !driverPos;

  const conductorBtnClick = isConductor && (gpsStatus === 'denied' || gpsStatus === 'timeout')
    ? startGps
    : centerOnPosition;

  const gpsIconColor = isConductor
    ? (gpsStatus === 'ok' ? 'text-blue-500' : gpsStatus === 'denied' ? 'text-red-400' : 'text-slate-400')
    : (driverOnline ? 'text-emerald-500' : driverPos ? 'text-amber-400' : 'text-slate-400');

  return (
    <PedidoModal open onClose={onClose} maxWidth="max-w-2xl">
      <PedidoModal.Header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <MapPin size={15} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">
                {isConductor ? 'Tu ruta activa' : 'Rastreo en vivo'}
              </p>
              <h3 className="text-[15px] font-black text-slate-800 leading-tight">
                Ruta #{ruta.numero} · {ruta.conductor_nombre}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Indicador rastreo — admin */}
            {!isConductor && (
              <span className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg border ${
                driverOnline ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : driverPos ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}>
                <Radio size={8} className={driverOnline ? 'animate-pulse' : ''} />
                {driverOnline ? 'En vivo' : driverPos ? 'Última posición' : 'Sin señal'}
              </span>
            )}
            {/* Recálculos conductor */}
            {isConductor && recalcCount > 0 && (
              <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
                <RefreshCw size={8} /> {recalcCount} recálculo{recalcCount !== 1 ? 's' : ''}
              </span>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      </PedidoModal.Header>

      <PedidoModal.Body className="px-5 pb-4 space-y-3">
        {/* Mapa */}
        <div className="relative rounded-2xl overflow-hidden border border-indigo-100 shadow-sm" style={{ height: 420 }}>
          <div ref={mapRef} className="w-full h-full" />

          {/* Botón centrar */}
          <button
            onClick={conductorBtnClick}
            disabled={conductorBtnDisabled}
            title={conductorBtnLabel}
            className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-white shadow-md border border-slate-200 rounded-xl px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isConductor
              ? <Crosshair size={11} className={gpsIconColor} />
              : <Truck size={11} className={gpsIconColor} />
            }
            {conductorBtnLabel}
          </button>

          {/* Badge mapa */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 text-[9px] font-semibold text-slate-600 shadow-sm border border-white/60">
            {mapsMode
              ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Google Maps</>
              : <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />OpenStreetMap</>
            }
          </div>

          {/* Info recálculo automático — conductor */}
          {isConductor && gpsStatus === 'ok' && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-blue-600/90 backdrop-blur-sm rounded-lg px-2 py-1 text-[9px] font-semibold text-white shadow-sm">
              <RefreshCw size={8} /> Recalcula c/2 min
            </div>
          )}
        </div>

        {/* Lista de paradas */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Paradas · {entregadas}/{paradas.length} entregadas
          </p>
          <div className="space-y-1.5">
            {paradas.map((stop, i) => (
              <div key={stop.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${
                stop.entregado_at ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'
              }`}>
                <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                  stop.entregado_at ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                }`}>{i + 1}</span>
                <p className="text-[12px] font-semibold text-slate-700 flex-1 truncate">{stop.suc_name}</p>
                {stop.entregado_at
                  ? <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 shrink-0"><CheckCircle2 size={10} />{fmtTime(stop.entregado_at)}</span>
                  : <span className="text-[10px] text-slate-400 flex items-center gap-1 shrink-0"><Clock size={10} />Pendiente</span>
                }
              </div>
            ))}
          </div>
        </div>
      </PedidoModal.Body>
    </PedidoModal>
  );
}
