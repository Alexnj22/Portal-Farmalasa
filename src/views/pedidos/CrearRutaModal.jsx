import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Checkbox from '../../components/common/Checkbox';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { X, Truck, ChevronUp, ChevronDown, MapPin, User, Package, Clock, ArrowRight, CheckCircle2, Loader2, Navigation, Warehouse, Plus, Trash2, Building2, AlertTriangle, RotateCcw } from 'lucide-react';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import { useAuth } from '@nucleo/context/AuthContext';
import PedidoModal from './PedidoModal';
import { optimizeRoute, optimizarPorCarretera, armarRuta, tramoEnLineaRecta, totalRoute, getDirectionsREST } from '@nucleo/utils/routeOptimizer';
import { loadGoogleMaps, loadLeaflet, matrizPorCarretera } from '../../plataforma/mapas';
import { crearRuta, fetchSalasListasParaRuta, fetchReenviosPorDespachar, fetchPedidosDisponiblesParaRuta, fetchSucursalesConCoords, updateRutaStatus } from '@nucleo/data/pedidos';
import { fetchConductoresPosibles } from '@nucleo/data/rutas';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import { claveDePuntos, crearCache, duracionConParadas, llegadasEstimadas, MIN_POR_PARADA } from './logicaDeRutas';
import { describirFaltantes } from '@nucleo/utils/tableroDePedidos';

import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useMontadoParaSalida from '../../plataforma/useMontadoParaSalida';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
function fmtDist(m) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtMin(min) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// El tiempo de descarga por parada es `MIN_POR_PARADA` (logicaDeRutas.js).

// ── El mapa y lo que cuesta ─────────────────────────────────────────────────
// Antes, CADA subida/bajada de una parada borraba el mapa (`innerHTML = ''`),
// creaba un `google.maps.Map` nuevo —una carga de mapa que se paga— y pedía un
// trazado nuevo —otra petición que se paga—, aunque el orden ya se hubiera
// visto. Ahora: el mapa se crea UNA vez por apertura del paso 2, sólo se
// cambia el trazado; el trazado se pide ~800 ms después del último cambio
// (subir tres veces seguidas una parada es UN pedido, no tres) y queda en
// memoria por clave de puntos mientras la página viva. Los números de cada
// tramo y del regreso salen de la tabla de distancias de la optimización
// —que ya los trae—, no del trazado.
const ESPERA_TRAZADO_MS = 800;
const TOPE_TABLA_MS = 10_000;
const trazados = crearCache(40);   // `${tipo}:${claveDePuntos}` → trazado

// La bodega cuando todavía no llegaron sus coordenadas (antes, un literal
// escrito en la línea que lo usaba).
const BODEGA_POR_DEFECTO = { lat: 14.041177, lng: -88.963111 };

// El «sin claves» por defecto tiene que ser UNO SOLO para siempre. Con
// `initialKeys = []` en la firma, cada render recibía un arreglo NUEVO, y como
// el efecto que carga los pedidos depende de `initialKeys`, cada carga
// disparaba la siguiente: el modal reiniciaba el paso, borraba la selección y
// volvía a pedir todo, sin fin. Medido el 2026-09-25 abriéndolo desde «Rutas
// de entrega» (que no pasa claves): 20,315 consultas en 10 segundos y la lista
// de pedidos nunca llegaba a pintarse.
const SIN_CLAVES = [];

export default function CrearRutaModal({ open, onClose, onCreated, initialKeys = SIN_CLAVES }) {
  const montadoParaSalida = useMontadoParaSalida(open);
  const { user } = useAuth();

  const [step, setStep] = useState(1);

  // Data
  // `conductorNombre` es el nombre COMPLETO: es lo que queda guardado en la ruta
  // y en la bitácora. Lo que se ve —y lo que dice el aviso a la sucursal— es el
  // corto (`conductorCorto`).
  // El conductor ya no es siempre quien arma la ruta: se elige entre la gente
  // que puede mover rutas (`fetchConductoresPosibles`). Por defecto, uno mismo.
  const [conductores,     setConductores]     = useState([]);
  const [conductorId,     setConductorId]     = useState(null);
  // «Salir ahora» arranca la ruta al crearla (es lo que dispara los avisos de
  // «en camino» a las salas y marca los reenvíos como salidos —trigger
  // `avisar_salida_de_ruta`—). «Dejarla lista» la deja en `pendiente`, y se
  // arranca después con «Iniciar ruta» en la pestaña de Rutas: el mismo
  // contrato, sólo que más tarde.
  const [salida,          setSalida]          = useState('ahora');
  const [pedidosDisp,     setPedidosDisp]     = useState([]);
  const [coordsMap,       setCoordsMap]       = useState({});
  const [bodegaCoords,    setBodegaCoords]    = useState(null);
  const [loadingData,     setLoadingData]     = useState(true);
  // Un error de carga NO es «no hay pedidos»: se dice y se ofrece reintentar.
  const [loadError,       setLoadError]       = useState(null);
  const [intentoCarga,    setIntentoCarga]    = useState(0);
  const [sucNameMap,      setSucNameMap]      = useState({}); // erp_sucursal_id → nombre

  // Step 1
  const [selected, setSelected] = useState(new Set());

  // Step 2
  const [paradas,        setParadas]        = useState([]);
  // Con qué se miden los tramos: carretera si la optimización pudo pedir la
  // tabla a Google, línea recta si no. Lo usan también los cambios a mano.
  // Estado y no ref: el regreso a bodega se deriva de él en el render.
  const [medir,          setMedir]          = useState(() => tramoEnLineaRecta);
  const [optimizing,     setOptimizing]     = useState(false);
  const [mapsMode,       setMapsMode]       = useState(false);
  const [showAddVisita,  setShowAddVisita]  = useState(false); // picker de encargo extra
  const mapRef  = useRef(null);
  const mapaRef = useRef(null);   // { div, tipo, map, … } — el mapa vivo del paso 2
  const [mapaListo, setMapaListo] = useState(0);

  // Submit
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState(null);
  const [mapError,     setMapError]     = useState(false);

  // ── Load data on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setStep(1);
    setSelected(new Set());
    setParadas([]);
    setMapError(false);
    setLoadError(null);
    setLoadingData(true);
    setSalida('ahora');
    setConductorId(null);

    // Los conductores posibles. Si la lista no llega, el conductor queda en
    // quien arma la ruta (lo de siempre) y no se bloquea nada.
    fetchConductoresPosibles().then(async ({ data, error }) => {
      if (!vivo) return;
      if (error) console.error('[CrearRutaModal] conductores:', error);
      const lista = (data ?? []).map(e => ({
        id: e.id, photo_url: e.photo_url ?? null,
        nombre: `${e.first_names ?? ''} ${e.last_names ?? ''}`.trim(),
        corto: shortEmployeeName(e),
      }));
      if (lista.some(c => c.photo_url)) await signPhotosDeep(lista).catch(() => {});
      if (!vivo) return;
      setConductores(lista);
      setConductorId(prev => prev ?? (user?.id ?? null));
    });

    // Primero los pedidos abiertos y DESPUÉS sus salas: así la segunda
    // consulta va acotada a esos pedidos y descarta las que ya salieron.
    fetchPedidosDisponiblesParaRuta().then(async (pedRes) => {
      // Un error no puede pasar por «no hay pedidos para despachar».
      if (pedRes.error) throw pedRes.error;
      const [pssRes, coordRes, reenRes] = await Promise.all([
        fetchSalasListasParaRuta((pedRes.data ?? []).map(p => p.id)),
        fetchSucursalesConCoords(),
        fetchReenviosPorDespachar(),
      ]);
      if (pssRes.error) throw pssRes.error;
      if (reenRes.error) throw reenRes.error;
      // Sin coordenadas no hay nombres de sala ni bodega: antes este error se
      // ignoraba y la lista salía con «Suc. 3» y la ruta sin mapa.
      if (coordRes.error) throw coordRes.error;
      return [pedRes, pssRes, coordRes, reenRes];
    }).then(([pedRes, pssRes, coordRes, reenRes]) => {
      if (!vivo) return;
      const pedidoMap = {};
      for (const p of (pedRes.data ?? [])) pedidoMap[p.id] = p;

      const snm = {};
      const cm = {};
      let bodega = null;
      for (const row of (coordRes.data ?? [])) {
        snm[row.erp_sucursal_id] = row.branch?.name ?? `Suc. ${row.erp_sucursal_id}`;
        const loc = row.branch?.settings?.location ?? {};
        const lat = parseFloat(loc.lat);
        const lng = parseFloat(loc.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          cm[row.erp_sucursal_id] = { lat, lng };
          if (row.es_bodega) bodega = { lat, lng };
        }
      }
      setCoordsMap(cm);
      setSucNameMap(snm);
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
          suc_name:         snm[pss.erp_sucursal_id] ?? `Suc. ${pss.erp_sucursal_id}`,
          total_cajas:      pss.total_cajas      ?? 0,
          cajas_electrolit: pss.cajas_electrolit  ?? 0,
          cajas_especiales: pss.cajas_especiales  ?? [],
        });
      }
      // Reenvíos de cajas faltantes: van PRIMERO y ya marcados (regla del
      // usuario, 2026-10-07). Son paradas como cualquiera —mismo optimizador de
      // ruta— pero viajan con su `reenvio_ciclo`, que es lo que hace que la
      // base las dé por salidas cuando la ruta sale.
      const reenvios = (reenRes.data ?? []).map(r => ({
        ...r,
        esReenvio:        true,
        suc_name:         snm[r.erp_sucursal_id] ?? `Suc. ${r.erp_sucursal_id}`,
        total_cajas:      (r.cajas ?? []).length + (r.especiales ?? []).length,
        cajas_electrolit: r.electrolits ?? 0,
        cajas_especiales: [],
      }));
      setPedidosDisp([...reenvios, ...items]);
      const todos = [...reenvios, ...items];
      const preKeys = new Set([
        ...reenvios.map(r => r.key),
        ...(initialKeys ?? []).filter(k => todos.some(i => i.key === k)),
      ]);
      if (preKeys.size) {
        const validKeys = preKeys;
        if (validKeys.size) setSelected(validKeys);
      }
    }).catch(err => {
      console.error('[CrearRutaModal] load error:', err?.message ?? err);
      if (vivo) setLoadError(mensajeAmigable(err, 'No se pudieron cargar los pedidos listos para salir.'));
    }).finally(() => {
      if (vivo) setLoadingData(false);
    });
    return () => { vivo = false; };
  }, [open, user?.id, initialKeys, intentoCarga]);

  // El conductor elegido (y su nombre COMPLETO, que es lo que queda guardado en
  // la ruta y en la bitácora; lo que se ve es el corto). Si la lista no llegó
  // o quien arma no está en ella, se usa la sesión como antes.
  const conductorElegido = useMemo(() => {
    const c = conductores.find(x => String(x.id) === String(conductorId));
    if (c) return c;
    return { id: user?.id ?? null, nombre: user?.name ?? user?.email ?? 'Usuario', corto: user?.name ? shortEmployeeName({ name: user.name }) : (user?.email ?? 'Usuario'), photo_url: null };
  }, [conductores, conductorId, user]);
  const conductorNombre = conductorElegido.nombre;
  const conductorCorto  = conductorElegido.corto;
  const conductorPhoto  = conductorElegido.photo_url;
  const esUnoMismo      = String(conductorElegido.id) === String(user?.id);
  const opcionesConductor = useMemo(() => {
    const ops = conductores.map(c => ({ value: String(c.id), label: c.corto + (String(c.id) === String(user?.id) ? ' (tú)' : '') }));
    if (user?.id && !ops.some(o => o.value === String(user.id))) ops.unshift({ value: String(user.id), label: `${conductorElegido.corto} (tú)` });
    return ops;
  }, [conductores, user?.id, conductorElegido.corto]);

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
  // El acumulado de cada parada es la hora de LLEGADA: conducción hasta ahí más
  // las descargas de las paradas anteriores. Antes sólo sumaba conducción —el
  // `svc` se calculaba y no se usaba—, y una ruta de tres salas se estimaba en
  // 15 min cuando duró 125.
  const timeline = useMemo(() => {
    const llegadas = llegadasEstimadas(paradas);
    return paradas.map((stop, i) => {
      const cajas      = stop.items?.reduce((s, it) => s + (it.total_cajas      ?? 0), 0) ?? 0;
      const electrolit = stop.items?.reduce((s, it) => s + (it.cajas_electrolit ?? 0), 0) ?? 0;
      // `cajas_especiales` es la LISTA de cajas, no un número: `0 + [{…}]` daba
      // la cadena «0[object Object]», y `"0[object Object]" > 0` es NaN > 0, o
      // sea falso. Por eso el badge «⭐ N especiales» no apareció nunca — ni
      // cuando había cajas especiales ni cuando no.
      const especiales = stop.items?.reduce((s, it) => s + (it.cajas_especiales?.length ?? 0), 0) ?? 0;
      const drive = stop.dur_min ?? 0;
      return { stop, cajas, electrolit, especiales, drive, cumul: llegadas[i] };
    });
  }, [paradas]);

  // El regreso a bodega se mide con la MISMA medida que los tramos (la tabla
  // de carretera de la optimización, o la línea recta): ya no hace falta pedir
  // un trazado a Google para conocer este número.
  const returnLeg = useMemo(() => {
    if (!paradas.length || !bodegaCoords) return null;
    const ultima = [...paradas].reverse().find(p => coordsMap[p.erp_sucursal_id]);
    return ultima ? medir(coordsMap[ultima.erp_sucursal_id], bodegaCoords) : null;
  }, [paradas, coordsMap, bodegaCoords, medir]);

  const totalDriveMin = paradas.reduce((s, p) => s + (p.dur_min ?? 0), 0) + (returnLeg?.dur_min ?? 0);
  const totalTime     = duracionConParadas(totalDriveMin, paradas.length);
  const totalDist     = totalRoute(paradas.filter(s => s.dist_m != null)).dist_m + (returnLeg?.dist_m ?? 0);

  // Clave estable que cambia cuando el orden o composición de paradas cambia
  const paradasKey = paradas.map(p => `${p._uid ?? p.erp_sucursal_id}-${p.orden}`).join('|');

  // ── El mapa: se crea UNA vez por paso 2 (Google Maps JS → Leaflet) ───────
  useEffect(() => {
    if (step !== 2 || !bodegaCoords || !mapRef.current || mapError) return;
    const div = mapRef.current;
    if (mapaRef.current?.div === div) return;          // ya está
    let cancelled = false;
    let authFailed = false;

    async function initLeaflet() {
      try {
        const L = await loadLeaflet();
        if (cancelled || mapRef.current !== div) return;
        div.innerHTML = '';
        const lmap = L.map(div, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(lmap);
        mapaRef.current = { div, tipo: 'leaflet', L, map: lmap, capa: L.layerGroup().addTo(lmap) };
        setMapaListo(n => n + 1);
      } catch (e) {
        console.error('[maps] Leaflet init error:', e);
        if (!cancelled) setMapError(true);
      }
    }

    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      console.warn('[maps] gm_authFailure — usando Leaflet');
      if (!authFailed) { authFailed = true; mapaRef.current = null; initLeaflet(); }
      if (prevAuthFailure) prevAuthFailure();
    };

    loadGoogleMaps().then(maps => {
      if (cancelled || authFailed || mapRef.current !== div) return;
      const map = new maps.Map(div, {
        zoom: 11, center: { lat: bodegaCoords.lat, lng: bodegaCoords.lng },
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
        styles: [{ featureType:'poi', stylers:[{visibility:'off'}] }, { featureType:'transit', stylers:[{visibility:'off'}] }],
      });
      const dr = new maps.DirectionsRenderer({ map, suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5, strokeOpacity: 0.85 } });
      mapaRef.current = { div, tipo: 'google', maps, map, dr, capas: [] };
      setMapaListo(n => n + 1);
    }).catch(err => {
      console.warn('[maps] loadGoogleMaps error:', err?.message ?? err);
      if (!cancelled && !authFailed) initLeaflet();
    });

    return () => {
      cancelled = true;
      window.gm_authFailure = prevAuthFailure;
    };
  }, [step, bodegaCoords, mapError]);

  // Al salir del paso 2 el `<div>` del mapa se desmonta: el mapa vivo se suelta.
  useEffect(() => { if (step !== 2) mapaRef.current = null; }, [step]);

  // ── El trazado: marcadores al instante, carretera con espera y caché ─────
  useEffect(() => {
    const m = mapaRef.current;
    if (!m || step !== 2 || !paradas.length || !bodegaCoords) return;
    let vigente = true;

    const conCoords = paradas.filter(p => coordsMap[p.erp_sucursal_id]);
    const puntos = [bodegaCoords, ...conCoords.map(p => coordsMap[p.erp_sucursal_id]), bodegaCoords];
    const latLngs = puntos.map(p => [p.lat, p.lng]);
    const clave = `${m.tipo}:${claveDePuntos(puntos)}`;

    // Marcadores y encuadre: no cuestan nada, se pintan ya.
    if (m.tipo === 'google') {
      const { maps, map } = m;
      m.capas.forEach(c => c.setMap(null));
      m.capas = [];
      const mkSvg = (label, fill, size) => encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-1.5}" fill="${fill}" stroke="white" stroke-width="2.5"/><text x="${size/2}" y="${size/2+4}" text-anchor="middle" fill="white" font-size="${size*0.4}" font-weight="bold">${label}</text></svg>`);
      m.capas.push(new maps.Marker({ position: bodegaCoords, map, zIndex: 100, title: 'Bodega', icon: { url: `data:image/svg+xml;utf8,${mkSvg('🏭','#1e1b4b',34)}`, scaledSize: new maps.Size(34,34), anchor: new maps.Point(17,17) } }));
      paradas.forEach((stop, i) => {
        const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
        m.capas.push(new maps.Marker({ position: c, map, zIndex: 90-i, title: stop.suc_name, icon: { url: `data:image/svg+xml;utf8,${mkSvg(i+1,'#6366f1',30)}`, scaledSize: new maps.Size(30,30), anchor: new maps.Point(15,15) } }));
      });
      const b = new maps.LatLngBounds();
      puntos.forEach(p => b.extend(p));
      map.fitBounds(b, 30);
    } else {
      const { L, map, capa } = m;
      capa.clearLayers();
      L.marker([bodegaCoords.lat, bodegaCoords.lng], {
        icon: L.divIcon({ className: '', html: `<div style="width:30px;height:30px;border-radius:50%;background:#1e1b4b;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:13px">🏭</div>`, iconSize: [30,30], iconAnchor: [15,15] }),
        title: 'Bodega',
      }).addTo(capa);
      paradas.forEach((stop, i) => {
        const c = coordsMap[stop.erp_sucursal_id]; if (!c) return;
        L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50%;background:#6366f1;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">${i+1}</div>`, iconSize: [26,26], iconAnchor: [13,13] }),
          title: stop.suc_name,
        }).addTo(capa);
      });
      map.fitBounds(latLngs, { padding: [20, 20] });
    }

    // La línea del trazado: de la caché, o recta mientras llega la de verdad.
    const pintar = (trazado) => {
      if (!vigente) return;
      if (m.tipo === 'google') {
        m.recta?.setMap(null); m.recta = null;
        if (trazado) { m.dr.setMap(m.map); m.dr.setDirections(trazado); }
        else {
          m.dr.setMap(null);
          m.recta = new m.maps.Polyline({ path: puntos, map: m.map, strokeColor: '#6366f1', strokeWeight: 4, strokeOpacity: 0.7 });
        }
      } else {
        m.linea?.remove();
        m.linea = m.L.polyline(trazado ?? latLngs, { color: '#6366f1', weight: 5, opacity: 0.85 }).addTo(m.map);
      }
      setMapsMode(!!trazado);
    };

    const enCache = trazados.get(clave);
    if (enCache) { pintar(enCache); return () => { vigente = false; }; }
    pintar(null);
    if (conCoords.length === 0) return () => { vigente = false; };

    const t = setTimeout(() => {
      if (!vigente) return;
      if (m.tipo === 'google') {
        new m.maps.DirectionsService().route({
          origin: bodegaCoords, destination: bodegaCoords,
          waypoints: conCoords.map(p => ({ location: coordsMap[p.erp_sucursal_id], stopover: true })),
          travelMode: m.maps.TravelMode.DRIVING, optimizeWaypoints: false,
        }, (result, status) => {
          if (status === 'OK') { trazados.set(clave, result); pintar(result); }
          else console.warn('[maps] trazado:', status);
        });
      } else {
        getDirectionsREST(puntos)
          .then(dirs => { if (dirs?.polylinePoints) { trazados.set(clave, dirs.polylinePoints); pintar(dirs.polylinePoints); } })
          .catch(e => console.warn('[maps] trazado por el intermediario falló:', e?.message ?? e));
      }
    }, ESPERA_TRAZADO_MS);

    return () => { vigente = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaListo, paradasKey]);

  // ── Step 1 → 2: optimize ──────────────────────────────────────────────────
  const handleOptimize = useCallback(async () => {
    if (!selectedItems.length) return;
    setOptimizing(true);

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
    const bodega = bodegaCoords ?? BODEGA_POR_DEFECTO;

    let optimized;
    try {
      // Con tope: si la tabla no contesta (llave rechazada, sin red), la
      // promesa de Google no termina NUNCA y el botón quedaba en «Calculando
      // ruta…» para siempre — medido en el entorno de pruebas el 2026-10-08.
      // A los `TOPE_TABLA_MS` se cae a la línea recta, como ante un error.
      const r = await optimizarPorCarretera(stopsWithCoords, bodega, (puntos) => Promise.race([
        matrizPorCarretera(puntos),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('la tabla de distancias no contestó')), TOPE_TABLA_MS)),
      ]));
      optimized = r.paradas;
      setMedir(() => r.medir);
    } catch {
      optimized = optimizeRoute(stopsWithCoords, bodega);
      setMedir(() => tramoEnLineaRecta);
    }

    const ts = Date.now();
    const allOrdered = [
      ...optimized,
      ...stopsNoCoords.map((s, i) => ({
        ...s, orden: optimized.length + i + 1, dist_m: null, dur_min: null,
      })),
    ].map((s, i) => ({ ...s, _uid: `stop-${i}-${ts}` }));

    setParadas(allOrdered);
    setMapsMode(false);   // lo dice el trazado cuando llega
    setOptimizing(false);
    setStep(2);
  }, [selectedItems, coordsMap, bodegaCoords]);

  // ── Reorder / remove / add encargo ────────────────────────────────────────
  // Mover, quitar o agregar una parada cambia desde DÓNDE se llega a cada una,
  // así que se vuelve a armar la ruta entera con la misma medida de la
  // optimización. Antes sólo se renumeraba: cada parada conservaba la distancia
  // desde la que tenía antes y los totales —que se guardan con la ruta—
  // quedaban mal.
  const rearmar = useCallback(
    (lista) => armarRuta(lista, bodegaCoords ?? BODEGA_POR_DEFECTO, medir),
    [bodegaCoords, medir],
  );

  const moveStop = useCallback((idx, dir) => {
    setParadas(prev => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return rearmar(next);
    });
  }, [rearmar]);

  const removeStop = useCallback((uid) => {
    setParadas(prev => rearmar(prev.filter(s => s._uid !== uid)));
  }, [rearmar]);

  const addEncargo = useCallback((sucId) => {
    const coords = coordsMap[sucId];
    const name = sucNameMap[sucId] ?? `Suc. ${sucId}`;
    setParadas(prev => rearmar([...prev, {
      erp_sucursal_id: sucId, suc_name: name, lat: coords?.lat, lng: coords?.lng,
      isEncargo: true, items: [], _uid: `enc-${sucId}-${Date.now()}`,
    }]));
    setShowAddVisita(false);
  }, [coordsMap, sucNameMap, rearmar]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!paradas.length || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Solo paradas con pedido real (los encargos se guardan en rutas.visitas)
      const rpcParadas = paradas
        .filter(stop => !stop.isEncargo)
        .flatMap(stop =>
          stop.items.map(item => ({
            pedido_id:       item.pedido_id,
            erp_sucursal_id: item.erp_sucursal_id,
            orden_entrega:   stop.orden,
            dist_m:          stop.dist_m  ?? null,
            dur_min:         stop.dur_min ?? null,
            reenvio_ciclo:   item.reenvio_ciclo ?? null,
          }))
        );

      const totals = totalRoute(paradas.filter(s => s.dist_m != null));

      const { data: rutaId, error } = await crearRuta({
        p_conductor_id:      conductorElegido.id ?? user?.id ?? null,
        p_conductor_nombre:  conductorNombre,
        p_paradas:           rpcParadas,
        p_distancia_total_m: (totalDist || totals.dist_m) || null,
        // Con las descargas (`MIN_POR_PARADA` por parada), no sólo conducir.
        p_duracion_min:      totalTime || totals.dur_min || null,
        p_creado_por:        user?.id ?? null,
      });
      if (error) throw error;

      // Iniciar (si sale ahora) + guardar encargos extra
      const visitasData = paradas
        .filter(s => s.isEncargo)
        .map(s => ({ erp_sucursal_id: s.erp_sucursal_id, suc_name: s.suc_name, orden: s.orden, dist_m: s.dist_m ?? null, dur_min: s.dur_min ?? null }));
      // El `error` de acá NO se miraba, y es el que decide si la ruta salió:
      // si falla, la ruta queda en «pendiente» y abajo igual se avisaba a las
      // salas que su pedido «salió de bodega». Se corta antes — la ruta ya
      // existe y se arranca desde la pestaña de Rutas, que es la recuperación.
      const patch = {
        ...(salida === 'ahora' ? { status: 'en_ruta', salida_at: new Date().toISOString() } : {}),
        ...(visitasData.length > 0 ? { visitas: visitasData } : {}),
      };
      if (Object.keys(patch).length > 0) {
        const { error: salidaErr } = await updateRutaStatus(rutaId, patch);
        if (salidaErr) throw salidaErr;
      }

      // `RUTA_CREADA` lo anota `crearRuta` en la capa de datos.

      // «En camino» a cada sala lo escribe la base al pasar la ruta a
      // `en_ruta` (`avisar_salida_de_ruta`, 2026-09-28): uno por sala, con sus
      // pedidos, sus cajas y el conductor, venga de este botón o de otro.

      onCreated?.();
      onClose();
    } catch (e) {
      console.error('[CrearRutaModal] submit error:', e);
      setSubmitError(mensajeAmigable(e, 'Error al crear la ruta. Intenta de nuevo.'));
    } finally {
      setSubmitting(false);
    }
  }, [conductorElegido.id, conductorNombre, paradas, submitting, user, totalDist, totalTime, salida, onCreated, onClose]);

  // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
  // mismo tick del cierre desmontaba el componente antes de que
  // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
  if (!montadoParaSalida) return null;

  return (
    <PedidoModal open={open} onClose={onClose} maxWidth="max-w-3xl">
      <PedidoModal.Header className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-chart-3/10 rounded-xl border border-chart-3/30">
              <Truck size={16} className="text-chart-3-text" />
            </div>
            <div>
              <p className="text-caption font-semibold text-chart-3-text uppercase tracking-wider">
                {step === 1 ? 'Paso 1 de 2' : 'Paso 2 de 2'}
              </p>
              <h3 className="text-body-xl font-black text-content leading-tight">
                {step === 1 ? 'Nueva Ruta de Entrega' : 'Confirmar ruta'}
              </h3>
            </div>
          </div>
          <Button variant="ghost" icon={X} iconOnly onClick={onClose} />
        </div>
      </PedidoModal.Header>

      <PedidoModal.Body className="px-5 py-4 space-y-4">
        {loadingData ? (
          <div className="flex items-center justify-center py-10"><SkeletonText lines={4} className="w-full max-w-md" /></div>
        ) : loadError ? (
          <EmptyState
            compact
            icon={AlertTriangle}
            iconClass="text-danger-text"
            title="No se pudieron cargar los pedidos"
            subtitle={loadError}
            action={<Button variant="secondary" icon={RotateCcw} onClick={() => setIntentoCarga(n => n + 1)}>Reintentar</Button>}
          />
        ) : step === 1 ? (
          <>
            {/* Conductor: por defecto quien arma la ruta, pero se puede elegir
                a otra persona que pueda mover rutas. */}
            <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 bg-chart-3/10 rounded-xl border border-chart-3/30">
              {conductorPhoto
                ? <img src={conductorPhoto} alt="" className="w-7 h-7 rounded-full object-cover border-2 border-chart-3/30 shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-chart-3-solid flex items-center justify-center shrink-0"><User size={13} className="text-white" /></div>
              }
              <div className="min-w-0 flex-1">
                <p className="text-micro font-semibold text-chart-3-text uppercase tracking-wider">{esUnoMismo ? 'Conductor (tú)' : 'Conductor'}</p>
                {opcionesConductor.length > 1 ? (
                  <div className="mt-1 max-w-[260px]">
                    <LiquidSelect
                      ariaLabel="Conductor"
                      value={String(conductorElegido.id ?? '')}
                      onChange={v => setConductorId(v || null)}
                      options={opcionesConductor}
                      compact clearable={false}
                    />
                  </div>
                ) : (
                  <p className="text-body-sm font-bold text-chart-3-text">{conductorCorto || '…'}</p>
                )}
              </div>
            </div>

            {/* Pedidos disponibles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={rotuloCampo('text-content-3')}><span className="flex items-center gap-1.5"><Package size={10} />Pedidos a incluir</span></label>
                {pedidosDisp.length > 0 && (
                  <Button variant="ghost" onClick={toggleAll}>{selected.size === pedidosDisp.length ? 'Deseleccionar todo' : 'Seleccionar todo'}</Button>
                )}
              </div>

              {pedidosDisp.length === 0 ? (
                <div className="text-center py-6 text-content-3 text-body-sm">
                  No hay pedidos confirmados disponibles para despachar.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {pedidosDisp.map((item, idx) => {
                    const isSel = selected.has(item.key);
                    // Encabezados de sección: los reenvíos arriba, como prioridad.
                    const primeroNormal = !item.esReenvio && idx > 0 && pedidosDisp[idx - 1].esReenvio;
                    const encabezado = item.esReenvio && idx === 0
                      ? <p key={`h-${item.key}`} className="text-caption font-semibold text-warning-text flex items-center gap-1.5 pt-1"><RotateCcw size={11} aria-hidden="true" />Reenvíos de cajas faltantes · prioridad</p>
                      : primeroNormal
                        ? <p key={`h-${item.key}`} className="text-caption font-semibold text-content-3 pt-2">Pedidos listos</p>
                        : null;
                    return (
                      <React.Fragment key={item.key}>
                      {encabezado}
                      <ListRow
                        key={item.key}
                        onClick={() => toggleItem(item.key)}
                        active={isSel}
                        className={isSel ? 'border-chart-3/30 bg-chart-3/10' : 'border-divider bg-surface-card hover:border-chart-3/30'}
                        trailing={<MapPin size={12} className={coordsMap[item.erp_sucursal_id] ? 'text-success' : 'text-content-3'} />}
                      >
                        {/* La casilla es INDICADOR, no control: la fila entera ya
                            responde al click. Sin `onChange` el canónico la deja
                            readOnly y fuera del orden de tabulación. */}
                        <span className="flex items-center gap-3">
                          <Checkbox checked={isSel} size="sm" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="text-body-sm font-bold text-content-2">#{item.numero}</span>
                              <span className="text-label text-content-3 font-medium">— {item.suc_name}</span>
                            </span>
                            {item.esReenvio && (
                              <span className="block text-caption text-warning-text font-semibold">
                                Reenvío: {describirFaltantes({ cajas: item.cajas, electrolits: item.electrolits, especiales: (item.especiales ?? []).map(l => ({ label: l })) }).join(' · ')}
                              </span>
                            )}
                            {!item.esReenvio && item.total_cajas > 0 && (
                              <span className="block text-caption text-content-3">
                                {item.total_cajas} caja{item.total_cajas !== 1 ? 's' : ''}
                                {item.cajas_electrolit > 0 && ` · ${item.cajas_electrolit} Electrolit`}
                              </span>
                            )}
                          </span>
                        </span>
                      </ListRow>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}

              {selectedItems.length > 0 && (
                <p className="text-caption text-chart-3-text font-semibold mt-2">
                  {selectedItems.length} pedido{selectedItems.length !== 1 ? 's' : ''} seleccionado{selectedItems.length !== 1 ? 's' : ''}
                  {' · '}{selectedItems.reduce((s, i) => s + (i.total_cajas ?? 0), 0)} cajas en total
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── Mapa ──────────────────────────────────────────────────── */}
            <div className="relative rounded-2xl overflow-hidden border border-chart-3/30 shadow-sm" style={{ height: 260 }}>
              {mapError ? (
                <div className="w-full h-full bg-surface-card-hover flex flex-col items-center justify-center gap-2 text-center px-4">
                  <MapPin size={20} className="text-content-3" />
                  <p className="text-label font-semibold text-content-3">Mapa no disponible</p>
                  <p className="text-caption text-content-3 max-w-[220px]">
                    El mapa no se pudo cargar. La ruta, los tiempos y las distancias de abajo siguen valiendo.
                  </p>
                </div>
              ) : (
                <div ref={mapRef} className="w-full h-full" />
              )}
              {/* Badge fuente */}
              {!mapError && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-surface-card rounded-lg px-2 py-1 text-micro font-semibold text-content-2 shadow-sm border border-border-card">
                  {mapsMode
                    ? <><Navigation size={8} className="text-success" />Ruta real · Google</>
                    : <><MapPin size={8} className="text-warning" />Estimado · OpenStreetMap</>
                  }
                </div>
              )}
            </div>

            {/* ── Conductor ─────────────────────────────────────────────── */}
            <div data-surface="card" className="flex items-center gap-2 px-3 py-2">
              {conductorPhoto
                ? <img src={conductorPhoto} className="w-6 h-6 rounded-full object-cover border border-divider shrink-0" />
                : <div className="w-6 h-6 rounded-full bg-chart-3-solid flex items-center justify-center shrink-0"><User size={11} className="text-white" /></div>
              }
              <span className="text-body-sm text-content-2 font-medium">Conductor:</span>
              <span className="text-body-sm font-bold text-content">{conductorCorto}{esUnoMismo ? ' (tú)' : ''}</span>
            </div>

            {/* ── Cuándo sale ───────────────────────────────────────────── */}
            {/* Salir es lo que avisa a las salas «en camino» y da por salidos
                los reenvíos: con «Dejarla lista» eso pasa al apretar «Iniciar
                ruta» en la pestaña de Rutas, no al crearla. */}
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl size="sm" tone="chart-3" label="Cuándo sale" value={salida} onChange={setSalida}
                options={[{ value: 'ahora', label: 'Salir ahora' }, { value: 'despues', label: 'Dejarla lista para después' }]} />
              <span className="text-caption text-content-3">
                {salida === 'ahora'
                  ? 'Las salas reciben el aviso de «en camino» al crearla.'
                  : 'Queda armada; se inicia desde Rutas y ahí avisa a las salas.'}
              </span>
            </div>

            {/* ── Timeline de paradas ───────────────────────────────────── */}
            <div>
              <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-3 flex items-center gap-1.5">
                <Clock size={10} />Orden y tiempos estimados
              </p>

              <div className="max-h-[42vh] overflow-y-auto pr-1 -mr-1">
              <div className="relative">
                {/* Línea vertical de fondo */}
                <div className="absolute left-[13px] top-7 bottom-7 w-px bg-gradient-to-b from-divider via-chart-3/30 to-divider" />

                {/* Bodega (partida) */}
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-7 h-7 rounded-full bg-chart-8 border-2 border-white shadow-md flex items-center justify-center shrink-0 z-base">
                    <Warehouse size={11} className="text-white" />
                  </div>
                  <div className="flex-1 py-1">
                    <p className="text-label font-bold text-content-2">Bodega — Punto de partida</p>
                  </div>
                </div>

                {/* Paradas */}
                {timeline.map(({ stop, cajas, electrolit, especiales, drive, cumul }, idx) => {
                  const enc = stop.isEncargo;
                  const dotCls = enc ? 'bg-warning' : 'bg-chart-3';
                  const cardCls = enc
                    ? 'bg-warning/10 border border-warning/30'
                    : 'bg-chart-3/10 border border-chart-3/30';
                  const timeCls = enc ? 'text-warning-text' : 'text-chart-3-text';
                  return (
                    <div key={stop._uid ?? `${stop.erp_sucursal_id}-${idx}`}>
                      {/* Tramo de conducción */}
                      <div className="flex items-center gap-3 my-0.5 ml-3">
                        <div className="w-px h-5 bg-chart-3/20 mx-auto" style={{ marginLeft: 0 }} />
                        <div className="flex items-center gap-1.5 text-micro text-content-3 font-medium pl-0">
                          <Clock size={8} className="text-chart-3-text" />
                          {stop.dist_m ? `${fmtDist(stop.dist_m)} · ` : ''}{drive > 0 ? `${drive} min conduciendo` : 'sin datos'}
                        </div>
                      </div>

                      {/* Card de la parada */}
                      <div className="flex items-start gap-3">
                        {/* Número + flechas */}
                        <div className="flex flex-col items-center gap-0.5 z-base">
                          <div className={`w-7 h-7 rounded-full ${dotCls} border-2 border-white shadow-md flex items-center justify-center text-white text-caption font-black shrink-0`}>
                            {stop.orden}
                          </div>
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            <Button tone="chart-3" size="xs" icon={ChevronUp} disabled={idx === 0} iconOnly onClick={() => moveStop(idx, -1)} />
                            <Button tone="chart-3" size="xs" icon={ChevronDown} disabled={idx === paradas.length - 1} iconOnly onClick={() => moveStop(idx, 1)} />
                          </div>
                        </div>

                        {/* Info de la parada */}
                        <div className={`flex-1 ${cardCls} rounded-xl px-3 py-2 mb-1`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-bold text-content truncate">{stop.suc_name}</p>
                                {enc && (
                                  <Badge variant="warning" size="sm" uppercase={false} className="shrink-0">Encargo</Badge>
                                )}
                              </div>
                              {!enc && (
                                <p className="text-caption text-content-3 mt-px">
                                  Pedido{stop.items.length > 1 ? 's' : ''} {stop.items.map(it => `#${it.numero}${it.esReenvio ? ' (reenvío)' : ''}`).join(', ')}
                                </p>
                              )}
                              {enc && (
                                <p className="text-caption text-warning-text mt-px">Visita sin pedido asociado</p>
                              )}
                              {!enc && cajas > 0 && (
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <Badge variant="chart-3" uppercase={false}>📦 {cajas} caja{cajas !== 1 ? 's' : ''}</Badge>
                                  {electrolit > 0 && (
                                    <Badge variant="chart-9" uppercase={false}>💧 {electrolit} Electrolit</Badge>
                                  )}
                                  {especiales > 0 && (
                                    <Badge variant="warning" uppercase={false}>⭐ {especiales} especial{especiales !== 1 ? 'es' : ''}</Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-start gap-2 shrink-0">
                              <div className="text-right">
                                <p className="text-micro text-content-2 uppercase tracking-wider">acumulado</p>
                                <p className={`text-subtitle font-black ${timeCls} leading-tight`}>{fmtMin(cumul)}</p>
                              </div>
                              <Button variant="destructive" icon={Trash2} title="Quitar parada" iconOnly onClick={() => removeStop(stop._uid)} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* ── Agregar visita extra ─────────────────────────────── */}
                <div className="flex items-center gap-3 my-1 ml-3">
                  <div className="w-px h-4 bg-divider" style={{ marginLeft: 0 }} />
                </div>
                {showAddVisita ? (
                  <div className="ml-10 p-3 rounded-xl border border-warning/30 bg-warning/10 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-caption font-bold text-warning-text uppercase tracking-wide">¿A qué sucursal?</p>
                      <Button variant="ghost" icon={X} iconOnly onClick={() => setShowAddVisita(false)} />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Object.entries(sucNameMap)
                        .filter(([id]) => Number(id) !== 6 && coordsMap[Number(id)])
                        .map(([id, name]) => (
                          <Button tone="warning" icon={Building2} onClick={() => addEncargo(Number(id))}><span className="text-label font-semibold text-content-2">{name}</span></Button>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="ml-10">
                    <Button tone="warning" icon={Plus} onClick={() => setShowAddVisita(true)}>Agregar visita / encargo extra</Button>
                  </div>
                )}

                {/* Tramo de vuelta a bodega */}
                {returnLeg && (
                  <>
                    <div className="flex items-center gap-3 my-0.5 ml-3">
                      <div className="w-px h-5 bg-divider mx-auto" style={{ marginLeft: 0 }} />
                      <div className="flex items-center gap-1.5 text-micro text-content-3 font-medium">
                        <Clock size={8} className="text-content-3" />
                        {fmtDist(returnLeg.dist_m)} · {returnLeg.dur_min} min regreso a base
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-chart-8 border-2 border-white shadow-md flex items-center justify-center shrink-0 z-base">
                        <Warehouse size={11} className="text-white" />
                      </div>
                      <div className="flex-1 bg-surface-card-hover border border-divider rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-label font-bold text-content-2">Bodega — Vuelta en base</p>
                          <div className="text-right">
                            <p className="text-micro text-content-2 uppercase tracking-wider">total estimado</p>
                            <p className="text-subtitle font-black text-content leading-tight">{fmtMin(totalTime)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              </div>{/* fin scroll */}

              {/* Resumen total */}
              {totalDist > 0 && (
                <div className="mt-3 flex gap-2">
                  <div className="flex-1 bg-chart-3/10 rounded-xl px-3 py-2 border border-chart-3/30 text-center">
                    <p className="text-micro text-chart-3-text font-semibold uppercase tracking-wider">Distancia</p>
                    <p className="text-subtitle font-black text-chart-3-text">{fmtDist(totalDist)}</p>
                    <p className="text-micro text-chart-3-text">ida + vuelta a bodega</p>
                  </div>
                  <div className="flex-1 bg-warning/10 rounded-xl px-3 py-2 border border-warning/30 text-center">
                    <p className="text-micro text-warning-text font-semibold uppercase tracking-wider">Tiempo total</p>
                    <p className="text-subtitle font-black text-warning-text">{fmtMin(totalTime)}</p>
                    <p className="text-micro text-warning-text/60">conducir + {MIN_POR_PARADA} min por parada</p>
                  </div>
                  <div className="flex-1 bg-surface-card-hover rounded-xl px-3 py-2 border border-divider text-center">
                    <p className="text-micro text-content-2 font-semibold uppercase tracking-wider">Solo conducir</p>
                    <p className="text-subtitle font-black text-content-2">{fmtMin(totalDriveMin)}</p>
                    <p className="text-micro text-content-3">sin descargas</p>
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
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button tone="chart-3" disabled={selectedItems.length === 0 || optimizing || !!loadError} onClick={handleOptimize}>{optimizing
                ? <><Loader2 size={14} className="animate-spin" />Calculando ruta…</>
                : <><ArrowRight size={14} />Ver ruta optimizada</>
              }</Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
              <Button variant="secondary" onClick={() => { setStep(1); setSubmitError(null); }}>← Atrás</Button>
              {submitError && (
                <p className="text-label text-danger-text flex items-center gap-1 pl-1">
                  <AlertTriangle size={11} /> {submitError}
                </p>
              )}
            </div>
            <Button tone="chart-3" disabled={submitting} onClick={handleSubmit}>{submitting ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              {salida === 'ahora' ? 'Crear y salir' : 'Crear ruta'}</Button>
          </>
        )}
      </PedidoModal.Footer>
    </PedidoModal>
  );
}
