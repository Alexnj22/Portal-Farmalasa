import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Navigation, MapPin, CheckCircle2, Clock, Crosshair } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import PedidoModal from './PedidoModal';
import { loadGoogleMaps, loadLeaflet } from '../../utils/routeOptimizer';

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

export default function RutaMapModal({ ruta, open, onClose }) {
  const mapRef      = useRef(null);
  const mapInstRef  = useRef(null); // Google Maps Map instance
  const mapsApiRef  = useRef(null); // google.maps namespace
  const gpsMarkerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletGpsRef = useRef(null);

  const [coordsMap,    setCoordsMap]    = useState({});
  const [bodegaCoords, setBodegaCoords] = useState(null);
  const [gpsPos,       setGpsPos]       = useState(null);
  const [gpsStatus,    setGpsStatus]    = useState('idle'); // idle | loading | ok | denied
  const [mapsMode,     setMapsMode]     = useState(false);  // true = Google Maps, false = Leaflet

  // ── Reset on close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setCoordsMap({});
      setBodegaCoords(null);
      setGpsPos(null);
      setGpsStatus('idle');
      setMapsMode(false);
      mapInstRef.current  = null;
      mapsApiRef.current  = null;
      gpsMarkerRef.current = null;
      leafletMapRef.current = null;
      leafletGpsRef.current = null;
    }
  }, [open]);

  // ── Load branch coordinates ─────────────────────────────────────────────────
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

  // ── GPS tracking ────────────────────────────────────────────────────────────
  const startGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('denied'); return; }
    setGpsStatus('loading');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus('ok');
        setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!open) return;
    const cleanup = startGps();
    return cleanup;
  }, [open, startGps]);

  // ── Update GPS marker when position changes ─────────────────────────────────
  useEffect(() => {
    if (!gpsPos) return;

    // Google Maps
    if (mapsApiRef.current && mapInstRef.current) {
      const maps = mapsApiRef.current;
      const pos  = new maps.LatLng(gpsPos.lat, gpsPos.lng);
      if (gpsMarkerRef.current) {
        gpsMarkerRef.current.setPosition(pos);
      } else {
        gpsMarkerRef.current = new maps.Marker({
          position: pos,
          map: mapInstRef.current,
          title: 'Tu ubicación',
          zIndex: 200,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: 'white',
            strokeWeight: 2.5,
          },
        });
      }
      return;
    }

    // Leaflet
    if (leafletMapRef.current && window.L) {
      const L = window.L;
      const lpos = [gpsPos.lat, gpsPos.lng];
      if (leafletGpsRef.current) {
        leafletGpsRef.current.setLatLng(lpos);
      } else {
        leafletGpsRef.current = L.circleMarker(lpos, {
          radius: 10, fillColor: '#3b82f6', color: 'white',
          weight: 2.5, fillOpacity: 1,
        }).addTo(leafletMapRef.current).bindTooltip('Tu ubicación', { permanent: false });
      }
    }
  }, [gpsPos]);

  // ── Render map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !bodegaCoords || !mapRef.current) return;
    let cancelled = false;
    let authFailed = false;

    const paradas = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
    const mkSvg = (label, fill, size) =>
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-1.5}" fill="${fill}" stroke="white" stroke-width="2.5"/><text x="${size/2}" y="${size/2+4}" text-anchor="middle" fill="white" font-size="${size*0.4}" font-weight="bold">${label}</text></svg>`);

    async function initLeaflet() {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapRef.current) return;
        mapRef.current.innerHTML = '';
        const lmap = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
        leafletMapRef.current = lmap;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(lmap);

        const pts = [
          [bodegaCoords.lat, bodegaCoords.lng],
          ...paradas.map(p => coordsMap[p.erp_sucursal_id]).filter(Boolean).map(c => [c.lat, c.lng]),
          [bodegaCoords.lat, bodegaCoords.lng],
        ];
        L.polyline(pts, { color: '#6366f1', weight: 5, opacity: 0.8 }).addTo(lmap);

        L.marker([bodegaCoords.lat, bodegaCoords.lng], {
          icon: L.divIcon({ className: '', html: `<div style="width:30px;height:30px;border-radius:50%;background:#1e1b4b;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px">🏭</div>`, iconSize: [30,30], iconAnchor: [15,15] }),
        }).addTo(lmap).bindTooltip('Bodega', { permanent: false });

        paradas.forEach((stop, i) => {
          const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
          const fill = stop.entregado_at ? '#10b981' : '#6366f1';
          L.marker([c.lat, c.lng], {
            icon: L.divIcon({ className: '', html: `<div style="width:28px;height:28px;border-radius:50%;background:${fill};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">${i+1}</div>`, iconSize: [28,28], iconAnchor: [14,14] }),
          }).addTo(lmap).bindTooltip(stop.suc_name ?? `Parada ${i+1}`, { permanent: false });
        });

        lmap.fitBounds(pts.filter(p => p[0] && p[1]), { padding: [30, 30] });

        // Si ya hay GPS, añadir marcador
        if (gpsPos) {
          leafletGpsRef.current = L.circleMarker([gpsPos.lat, gpsPos.lng], {
            radius: 10, fillColor: '#3b82f6', color: 'white', weight: 2.5, fillOpacity: 1,
          }).addTo(lmap).bindTooltip('Tu ubicación', { permanent: false });
        }
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
        zoom: 12,
        center: bodegaCoords,
        disableDefaultUI: false,
        zoomControl: true,
        gestureHandling: 'greedy',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
      });
      mapInstRef.current = mapInst;

      // Ruta con DirectionsService
      const origin = new maps.LatLng(bodegaCoords.lat, bodegaCoords.lng);
      const stopCoords = paradas.filter(p => coordsMap[p.erp_sucursal_id]);
      if (stopCoords.length > 0) {
        const dr = new maps.DirectionsRenderer({
          map: mapInst, suppressMarkers: true,
          polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5, strokeOpacity: 0.85 },
        });
        new maps.DirectionsService().route({
          origin, destination: origin,
          waypoints: stopCoords.map(p => ({ location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng), stopover: true })),
          travelMode: maps.TravelMode.DRIVING, optimizeWaypoints: false,
        }, (result, status) => {
          if (cancelled || authFailed) return;
          if (status === 'OK') dr.setDirections(result);
        });
      }

      // Bodega marker
      new maps.Marker({
        position: origin, map: mapInst, zIndex: 100, title: 'Bodega',
        icon: { url: `data:image/svg+xml;utf8,${mkSvg('🏭','#1e1b4b',34)}`, scaledSize: new maps.Size(34,34), anchor: new maps.Point(17,17) },
      });

      // Stop markers — verde si entregado, índigo si pendiente
      paradas.forEach((stop, i) => {
        const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
        const fill = stop.entregado_at ? '#10b981' : '#6366f1';
        new maps.Marker({
          position: { lat: c.lat, lng: c.lng }, map: mapInst, zIndex: 90 - i, title: stop.suc_name,
          icon: { url: `data:image/svg+xml;utf8,${mkSvg(i+1, fill, 30)}`, scaledSize: new maps.Size(30,30), anchor: new maps.Point(15,15) },
        });
      });

      // GPS marker si ya hay posición
      if (gpsPos && !authFailed) {
        gpsMarkerRef.current = new maps.Marker({
          position: gpsPos, map: mapInst, zIndex: 200, title: 'Tu ubicación',
          icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#3b82f6', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2.5 },
        });
      }
    }).catch(() => {
      if (!cancelled && !authFailed) initLeaflet();
    });

    return () => {
      cancelled = true;
      window.gm_authFailure = prevAuth;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bodegaCoords, coordsMap]);

  const centerOnGps = useCallback(() => {
    if (!gpsPos) return;
    if (mapInstRef.current && mapsApiRef.current) {
      mapInstRef.current.setCenter(new mapsApiRef.current.LatLng(gpsPos.lat, gpsPos.lng));
      mapInstRef.current.setZoom(16);
    } else if (leafletMapRef.current) {
      leafletMapRef.current.setView([gpsPos.lat, gpsPos.lng], 16);
    }
  }, [gpsPos]);

  if (!open) return null;

  const paradas = [...(ruta.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega);
  const entregadas = paradas.filter(p => p.entregado_at).length;

  return (
    <PedidoModal open onClose={onClose} maxWidth="max-w-2xl">
      <PedidoModal.Header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
              <MapPin size={15} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">Mapa de ruta</p>
              <h3 className="text-[15px] font-black text-slate-800 leading-tight">
                Ruta #{ruta.numero} · {ruta.conductor_nombre}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 transition-colors">
            <X size={16} />
          </button>
        </div>
      </PedidoModal.Header>

      <PedidoModal.Body className="px-5 pb-4 space-y-3">
        {/* Mapa */}
        <div className="relative rounded-2xl overflow-hidden border border-indigo-100 shadow-sm" style={{ height: 420 }}>
          <div ref={mapRef} className="w-full h-full" />

          {/* Botón centrar en GPS */}
          <button
            onClick={centerOnGps}
            disabled={!gpsPos}
            title={gpsPos ? 'Centrar en mi posición' : 'Esperando GPS…'}
            className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-white shadow-md border border-slate-200 rounded-xl px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Crosshair size={11} className={gpsStatus === 'ok' ? 'text-blue-500' : 'text-slate-400'} />
            {gpsStatus === 'loading' ? 'Buscando GPS…' : gpsStatus === 'denied' ? 'GPS bloqueado' : gpsStatus === 'ok' ? 'Centrar en mí' : 'GPS'}
          </button>

          {/* Badge mapa */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 text-[9px] font-semibold text-slate-600 shadow-sm border border-white/60">
            {mapsMode
              ? <><Navigation size={8} className="text-emerald-500" />Google Maps</>
              : <><MapPin size={8} className="text-amber-400" />OpenStreetMap</>
            }
          </div>
        </div>

        {/* Lista de paradas */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Paradas · {entregadas}/{paradas.length} entregadas
          </p>
          <div className="space-y-1.5">
            {paradas.map((stop, i) => (
              <div key={stop.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left ${
                stop.entregado_at ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'
              }`}>
                <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${
                  stop.entregado_at ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-700'
                }`}>{i + 1}</span>
                <p className="text-[12px] font-semibold text-slate-700 flex-1 truncate">{stop.suc_name}</p>
                {stop.entregado_at
                  ? <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 shrink-0">
                      <CheckCircle2 size={10} /> {fmtTime(stop.entregado_at)}
                    </span>
                  : <span className="text-[10px] text-slate-400 flex items-center gap-1 shrink-0">
                      <Clock size={10} /> Pendiente
                    </span>
                }
              </div>
            ))}
          </div>
        </div>
      </PedidoModal.Body>
    </PedidoModal>
  );
}
