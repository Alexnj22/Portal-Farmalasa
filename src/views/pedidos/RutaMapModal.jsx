import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { X, MapPin, CheckCircle2, Clock, Crosshair, Truck, Radio, RefreshCw } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { loadGoogleMaps, loadLeaflet } from '../../plataforma/mapas';
import { fetchSucursalesConCoords, fetchRutaLocationSingle, upsertRutaLocation } from '@nucleo/data/pedidos';
import { seguirPosicion } from '../../plataforma/ubicacion';
import useMontadoParaSalida from '../../plataforma/useMontadoParaSalida';
import { hora12 } from '@nucleo/utils/hora';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import { hayRastreoDeFondo } from '../../plataforma/rastreoRuta';
import { claveDePuntos, crearCache, debeRecalcular } from './logicaDeRutas';

// ── Lo que no cambia mientras la página vive ────────────────────────────────
// Cada trazado por carretera es una petición que se paga. Abrir el mapa de la
// misma ruta dos veces pedía dos trazados idénticos, y cada apertura volvía a
// leer las coordenadas de las salas, que no cambian en el día. Las dos cosas
// quedan en memoria del módulo hasta recargar la página.
let coordsPromesa = null;
function coordenadasDeSalas() {
  if (!coordsPromesa) {
    coordsPromesa = fetchSucursalesConCoords().then((res) => {
      if (res.error) { coordsPromesa = null; throw res.error; }
      return res.data ?? [];
    }, (err) => { coordsPromesa = null; throw err; });
  }
  return coordsPromesa;
}
const trazados = crearCache(30);   // clave de puntos → DirectionsResult

// El recálculo desde la posición del conductor NO se cachea (el origen cambia
// siempre), así que lleva su propio freno: nunca dos en menos de un minuto,
// aunque el GPS siga diciendo «desviado» (un desvío largo a propósito, o un
// GPS que salta).
const RECALCULO_MIN_MS = 60_000;

/** El trazado de un DirectionsResult como `[{lat,lng}]`, para medir desvíos. */
function trazadoDe(result) {
  const path = result?.routes?.[0]?.overview_path ?? [];
  return path.map(p => ({ lat: p.lat(), lng: p.lng() }));
}


function fmtTime(iso) {
  if (!iso) return null;
  return hora12(iso);
}

export default function RutaMapModal({ ruta, open, onClose, currentUserId }) {
    const montadoParaSalida = useMontadoParaSalida(open);
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
  const trazadoRef      = useRef([]);     // el trazado vigente, para medir desvíos
  const claveRecalcRef  = useRef('');     // qué paradas pendientes tenía ese trazado
  const ultimoRecalcRef = useRef(0);

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
  // Memorizada: el efecto del recálculo depende de ella, y recalculada en cada
  // render era un arreglo nuevo cada vez (ver el recálculo más abajo).
  const paradas = useMemo(
    () => [...(localParadas ?? ruta?.ruta_pedidos ?? [])].sort((a, b) => a.orden_entrega - b.orden_entrega),
    [localParadas, ruta?.ruta_pedidos],
  );
  const entregadas = paradas.filter(p => p.entregado_at).length;
  // Clave ESTABLE (una cadena) de lo que falta por entregar. `paradas` es un
  // arreglo nuevo en cada render: depender de él reiniciaba el efecto siempre.
  const clavePendientes = claveDePuntos(paradas
    .filter(p => !p.entregado_at && !p.no_entregado_at)
    .map(p => coordsMap[p.erp_sucursal_id]));

  // ── Sync GPS pos → ref (evita stale closures en intervalos) ────────────────
  useEffect(() => { latestGpsPosRef.current = gpsPos; }, [gpsPos]);

  // ── Suscripción live a ruta_pedidos (actualiza marcadores sin reabrir modal) ─
  useEffect(() => {
    if (!open || !ruta?.id) return;
    return escucharCambios(`ruta-stops-live-${ruta.id}`,
      [{ tabla: 'ruta_pedidos', evento: 'UPDATE', filtro: `ruta_id=eq.${ruta.id}` }], (payload) => {
        setLocalParadas(prev => {
          const base = prev ?? [...(ruta?.ruta_pedidos ?? [])];
          return base.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
        });
      });
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
    trazadoRef.current      = [];
    claveRecalcRef.current  = '';
    ultimoRecalcRef.current = 0;
    watchIdRef.current?.();
    watchIdRef.current = null;
  }, [open]);

  // ── Cargar coordenadas de sucursales ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    coordenadasDeSalas()
      .then((data) => {
        const cm = {};
        let bodega = null;
        for (const row of data) {
          const loc = row.branch?.settings?.location ?? {};
          const lat = parseFloat(loc.lat), lng = parseFloat(loc.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            cm[row.erp_sucursal_id] = { lat, lng };
            if (row.es_bodega) bodega = { lat, lng };
          }
        }
        setCoordsMap(cm);
        setBodegaCoords(bodega);
      })
      .catch((err) => console.error('[RutaMap] coordenadas:', err?.message ?? err));
  }, [open]);

  // ── GPS propio — solo conductor ─────────────────────────────────────────────
  // Cómo se mide lo decide la plataforma (`plataforma/ubicacion`), la misma
  // que usa el rastreo de fondo de `usePedidosData`. `watchIdRef` guarda la
  // función que lo detiene.
  const startGps = useCallback(async () => {
    setGpsStatus('loading');
    try {
      watchIdRef.current = await seguirPosicion(
        (pos) => { setGpsPos(pos); setGpsStatus('ok'); },
        {
          mensaje: 'Rastreando tu posición para la entrega.',
          alFallar: (motivo) => setGpsStatus(motivo === 'sin-senal' ? 'timeout' : 'denied'),
        },
      );
    } catch (err) {
      console.warn('[GPS] startGps error:', err);
      setGpsStatus('denied');
    }
  }, []);

  const stopGps = useCallback(async () => {
    const detener = watchIdRef.current;
    watchIdRef.current = null;
    await detener?.();
  }, []);

  useEffect(() => {
    if (!open || !isConductor) return;
    startGps();
    return () => { stopGps(); };
  }, [open, isConductor, startGps, stopGps]);

  // ── Admin: posición inicial + suscripción Realtime ──────────────────────────
  useEffect(() => {
    if (!open || isConductor) return;

    fetchRutaLocationSingle(ruta.id)
      .then(({ data }) => {
        if (!data) return;
        setDriverPos({ lat: parseFloat(data.lat), lng: parseFloat(data.lng) });
        const ageMin = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
        setDriverOnline(ageMin < 3);
      });

    return escucharCambios(`ruta-loc-${ruta.id}`,
      [{ tabla: 'ruta_locations', filtro: `ruta_id=eq.${ruta.id}` }], ({ new: row }) => {
        if (row?.lat != null && row?.lng != null) {
          setDriverPos({ lat: parseFloat(row.lat), lng: parseFloat(row.lng) });
          setDriverOnline(true);
        }
      });
  }, [open, isConductor, ruta.id]);

  // ── Conductor: escribir posición en DB cada 30 s ───────────────────────────
  // Sólo si NO hay rastreo de fondo (`usePedidosData`) escribiendo ya la
  // posición de esta ruta: eran dos escritores sobre la misma fila. Se
  // pregunta en cada vuelta, no al montar, porque el de fondo puede arrancar o
  // detenerse con el mapa abierto.
  useEffect(() => {
    if (!open || !isConductor) return;
    const interval = setInterval(() => {
      const pos = latestGpsPosRef.current;
      if (!pos || hayRastreoDeFondo(String(ruta.id))) return;
      upsertRutaLocation(ruta.id, pos.lat, pos.lng).then(() => {}, () => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [open, isConductor, ruta.id]);

  // ── Conductor: recalcular el trazado cuando hace falta ───────────────────
  // Antes era «cada 2 minutos» y en la práctica NUNCA: el efecto dependía de
  // `paradas`, un arreglo nuevo en cada render, así que el intervalo se
  // reiniciaba antes de cumplirse. Ahora no hay reloj: se pide un trazado nuevo
  // desde la posición del conductor sólo si se alejó más de
  // `UMBRAL_DESVIO_M` del vigente o si cambió lo que falta por entregar — y
  // nunca dos en menos de `RECALCULO_MIN_MS`.
  useEffect(() => {
    if (!open || !isConductor || !mapReady || !bodegaCoords || !gpsPos) return;
    const maps = mapsApiRef.current;
    if (!maps || !dirRendererRef.current) return;
    // Mientras el primer trazado no llegó, la polilínea vacía se lee como
    // «desviado» y se pedían dos rutas a Google al abrir. Se espera a tenerlo,
    // y lo que falta por entregar en ese momento es la referencia.
    if (!trazadoRef.current?.length) return;
    if (claveRecalcRef.current == null) claveRecalcRef.current = clavePendientes;
    const recalcular = debeRecalcular({
      pos: gpsPos, polilinea: trazadoRef.current,
      clavePendientes, claveAnterior: claveRecalcRef.current,
    });
    if (!recalcular) return;
    if (Date.now() - ultimoRecalcRef.current < RECALCULO_MIN_MS) return;
    const pending = paradas.filter(p => !p.entregado_at && !p.no_entregado_at && coordsMap[p.erp_sucursal_id]);
    if (!pending.length) return;
    ultimoRecalcRef.current = Date.now();
    claveRecalcRef.current  = clavePendientes;
    new maps.DirectionsService().route({
      origin:      new maps.LatLng(gpsPos.lat, gpsPos.lng),
      destination: new maps.LatLng(bodegaCoords.lat, bodegaCoords.lng),
      waypoints:   pending.map(p => ({
        location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng),
        stopover: true,
      })),
      travelMode:        maps.TravelMode.DRIVING,
      optimizeWaypoints: false,
    }, (result, status) => {
      if (status === 'OK' && dirRendererRef.current) {
        dirRendererRef.current.setDirections(result);
        trazadoRef.current = trazadoDe(result);
        setRecalcCount(c => c + 1);
      }
    });
  }, [open, isConductor, mapReady, bodegaCoords, gpsPos, clavePendientes, coordsMap, paradas]);

  // ── Actualizar marcador GPS conductor en el mapa ────────────────────────────
  useEffect(() => {
    if (!gpsPos || !isConductor) return;

    // Primera posición: escribir inmediatamente a DB — salvo que el rastreo
    // de fondo ya la esté escribiendo (ver arriba).
    if (!firstWriteRef.current && !hayRastreoDeFondo(String(ruta.id))) {
      firstWriteRef.current = true;
      upsertRutaLocation(ruta.id, gpsPos.lat, gpsPos.lng).then(() => {}, () => {});
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

      // El trazado de la ruta completa depende sólo de los puntos y su orden:
      // si ya se pidió en esta página, se reusa (ver `trazados`).
      const clave = claveDePuntos([bodegaCoords, ...withCoords.map(p => coordsMap[p.erp_sucursal_id]), bodegaCoords]);
      const pintar = (result) => {
        dr.setDirections(result);
        trazadoRef.current = trazadoDe(result);
        claveRecalcRef.current = clavePendientes;
      };
      if (clave && trazados.has(clave)) {
        pintar(trazados.get(clave));
      } else if (clave) {
        new maps.DirectionsService().route({
          origin, destination: origin,
          waypoints: withCoords.map(p => ({
            location: new maps.LatLng(coordsMap[p.erp_sucursal_id].lat, coordsMap[p.erp_sucursal_id].lng),
            stopover: true,
          })),
          travelMode: maps.TravelMode.DRIVING, optimizeWaypoints: false,
        }, (result, status) => {
          if (status === 'OK') trazados.set(clave, result);
          if (!cancelled && !authFailed && status === 'OK') pintar(result);
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

  // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

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
    ? (gpsStatus === 'ok' ? 'text-brand-text' : gpsStatus === 'denied' ? 'text-danger' : 'text-content-3')
    : (driverOnline ? 'text-success' : driverPos ? 'text-warning' : 'text-content-3');

  return (
    <PedidoModal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <PedidoModal.Header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-chart-3/10 rounded-xl border border-chart-3/30">
              <MapPin size={15} className="text-chart-3-text" />
            </div>
            <div>
              <p className="text-caption font-semibold text-chart-3-text uppercase tracking-wider">
                {isConductor ? 'Tu ruta activa' : 'Rastreo en vivo'}
              </p>
              <h3 className="text-subtitle font-black text-content leading-tight">
                Ruta #{ruta.numero} · {ruta.conductor_nombre}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Indicador rastreo — admin */}
            {!isConductor && (
              <Badge variant={driverOnline ? 'success' : driverPos ? 'warning' : 'neutral'} size="sm" uppercase={false}>
                <Radio size={8} className={driverOnline ? 'animate-pulse' : ''} />
                {driverOnline ? 'En vivo' : driverPos ? 'Última posición' : 'Sin señal'}
              </Badge>
            )}
            {/* Recálculos conductor */}
            {isConductor && recalcCount > 0 && (
              <Badge variant="chart-3" size="sm" icon={RefreshCw} uppercase={false}>{recalcCount} recálculo{recalcCount !== 1 ? 's' : ''}</Badge>
            )}
            <Button variant="ghost" icon={X} iconOnly onClick={onClose} />
          </div>
        </div>
      </PedidoModal.Header>

      <PedidoModal.Body className="px-5 pb-4 space-y-3">
        {/* Mapa */}
        <div className="relative rounded-2xl overflow-hidden border border-chart-3/30 shadow-sm" style={{ height: 420 }}>
          <div ref={mapRef} className="w-full h-full" />

          {/* Botón centrar */}
          {/* Era `title="conductorBtnLabel"`: el nombre de la variable en
              comillas, o sea el tooltip decía literalmente eso. */}
          <Button variant="secondary" disabled={conductorBtnDisabled} title={conductorBtnLabel} onClick={conductorBtnClick}>{isConductor
              ? <Crosshair size={11} className={gpsIconColor} />
              : <Truck size={11} className={gpsIconColor} />
            }
            {conductorBtnLabel}</Button>

          {/* Badge mapa */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-surface-card rounded-lg px-2 py-1 text-micro font-semibold text-content-2 shadow-sm border border-border-card">
            {mapsMode
              ? <><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />Google Maps</>
              : <><span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />OpenStreetMap</>
            }
          </div>

          {/* Info recálculo automático — conductor */}
          {isConductor && gpsStatus === 'ok' && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-brand rounded-lg px-2 py-1 text-micro font-semibold text-white shadow-sm">
              <RefreshCw size={8} /> Recalcula si te desvías
            </div>
          )}
        </div>

        {/* Lista de paradas */}
        <div>
          <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">
            Paradas · {entregadas}/{paradas.length} entregadas
          </p>
          <div className="space-y-1.5">
            {paradas.map((stop, i) => (
              <div key={stop.id} data-surface={stop.entregado_at ? undefined : 'card'} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${stop.entregado_at ? 'bg-success/10 border-success/30' : ''}`}>
                <span className={`w-5 h-5 rounded-full text-micro font-black flex items-center justify-center shrink-0 ${
                  stop.entregado_at ? 'bg-success-solid text-white' : 'bg-chart-3/10 text-chart-3-text'
                }`}>{i + 1}</span>
                <p className="text-body-sm font-semibold text-content-2 flex-1 truncate">{stop.suc_name}</p>
                {stop.entregado_at
                  ? <span className="text-caption text-success-text font-semibold flex items-center gap-1 shrink-0"><CheckCircle2 size={10} />{fmtTime(stop.entregado_at)}</span>
                  : <span className="text-caption text-content-3 flex items-center gap-1 shrink-0"><Clock size={10} />Pendiente</span>
                }
              </div>
            ))}
          </div>
        </div>
      </PedidoModal.Body>
    </PedidoModal>
  );
}
