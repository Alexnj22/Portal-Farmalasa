// Una ruta de reparto con su MAPA, NATIVA — el `RutaMapModal` y la tarjeta de
// `TabRutas` del portal en una sola pantalla: bodega, las paradas numeradas
// en su orden (verdes las entregadas) y el trazo bodega → salas → bodega.
//
// Quien CONDUCE ve su punto y, mientras esta pantalla está abierta, su
// posición se anota cada 30 s (la primera enseguida), igual que el portal: es
// la que ve Bodega «en vivo». Quien NO conduce ve dónde va el camión, con la
// última posición y si es reciente. Las acciones del conductor —iniciar la
// ruta, «Entregué», volver a base— son las mismas funciones del núcleo y se
// confirman. El trazo es en línea recta entre paradas: el recálculo por calles
// del portal usa el servicio de Google y no está en el teléfono.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useAuth } from '@nucleo/context/AuthContext';
import { completarRuta, fetchRutaLocationSingle, iniciarRuta, updateRutaPedidoEntregado, upsertRutaLocation } from '@nucleo/data/pedidos';
import { fetchCoordenadasDeSucursales, fetchRutasDeEntrega } from '@nucleo/data/rutasDeEntrega';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import { INTERVALO_POSICION_CONDUCTOR_MS, avanceDeEntrega, conductorEnVivo, distanciaTexto, estadoDeRuta, ordenarParadas, trazoDeReparto } from '@nucleo/utils/rutasDeEntrega';
import { encuadre } from '@nucleo/utils/encuadreDelMapa';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { seguirPosicion } from '@plataforma/ubicacion';
import { activarRutaDeFondo, escucharFondo, fondoActivo, quitarRutaDeFondo, rutasDeFondo } from '../../../plataforma/rastreoDeFondo';
import AvisoUbicacionSiempre from '../../../componentes/AvisoUbicacionSiempre';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../../componentes/formulario/Piezas';
import { Esqueleto } from '../../../componentes/inicio/Widget';
import Vidrio from '../../../componentes/Vidrio';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';

const INDIGO = '#6366f1';
const coord = (p) => ({ latitude: p.lat, longitude: p.lng });

function Pin({ texto, color, alto = 28 }) {
  return (
    <View style={{ width: alto, height: alto, borderRadius: alto / 2, backgroundColor: color, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{texto}</Text>
    </View>
  );
}

const MOTIVO_GPS = {
  denegado: 'El teléfono no da permiso de ubicación: Bodega no ve dónde vas. Se activa en Ajustes › Farmalasa › Ubicación.',
  'sin-senal': 'Sin señal de GPS por ahora.',
  'sin-gps': 'El GPS del teléfono no respondió.',
};

export default function RutaDeReparto() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const canEdit = hasPermission('pedidos_tab_rutas', 'can_edit');
  const deSala = getScope?.('pedidos_tab_rutas') !== 'ALL';
  const [ruta, setRuta] = useState(null);
  const [error, setError] = useState('');
  const [coords, setCoords] = useState({ porSucursal: {}, bodega: null });
  const [mio, setMio] = useState(null);          // mi posición (conductor)
  const [gps, setGps] = useState(null);          // problema del GPS
  const [fondo, setFondo] = useState(() => fondoActivo('reparto'));   // ¿la tarea de fondo anota esta ruta?
  const [sinFondo, setSinFondo] = useState(null); // por qué no: 'en-uso' | 'denegado' | 'sin-fondo'
  const [camion, setCamion] = useState(null);    // { lat, lng, at } visto por los demás
  const [ocupado, setOcupado] = useState(null);
  const mapa = useRef(null);
  const ultima = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const todas = await fetchRutasDeEntrega();
      const r = todas.find((x) => String(x.id) === String(id));
      setRuta(r ?? false);
      setError(r ? '' : 'Esta ruta ya no está entre las recientes.');
    } catch (e) { setError(mensajeAmigable(e)); setRuta((r) => r ?? false); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => escucharCambios(`ruta-app-${id}`, [
    { tabla: 'ruta_pedidos', evento: 'UPDATE', filtro: `ruta_id=eq.${id}` },
    { tabla: 'rutas', evento: 'UPDATE', filtro: `id=eq.${id}` },
  ], () => { cargar(); }), [id, cargar]);
  useEffect(() => {
    // Con caché del núcleo: las coordenadas de las salas no cambian en el día.
    fetchCoordenadasDeSucursales()
      .then(setCoords)
      .catch(() => {});
  }, []);

  const conductor = !!(ruta && user?.id && String(ruta.conductor_id) === String(user.id));

  // ── Conductor con la ruta en marcha: el GPS de FONDO (app cerrada) ────────
  // Iniciar la ruta lo arranca; si la ruta se inició antes (en el portal, o con
  // una versión vieja de la app), se arranca al abrir esta pantalla. Una ruta
  // que ya no está «en ruta» lo suelta. Ver `plataforma/rastreoDeFondo.js`.
  useEffect(() => escucharFondo(() => setFondo(fondoActivo('reparto'))), []);
  const enRuta = ruta?.status === 'en_ruta';
  useEffect(() => {
    if (!conductor || !ruta) return;
    const mia = rutasDeFondo().reparto?.rutaId === String(id);
    if (enRuta && !mia) {
      Promise.resolve(activarRutaDeFondo('reparto', { rutaId: String(id) }))
        .then((r) => setSinFondo(r === 'fondo' ? null : r))
        .catch(() => setSinFondo('sin-fondo'));
    } else if (!enRuta && mia) {
      Promise.resolve(quitarRutaDeFondo('reparto')).catch(() => {});
    }
  }, [conductor, ruta, enRuta, id]);

  // ── Conductor: su GPS mientras la pantalla está abierta ─────────────────
  // Con el fondo corriendo, esta pantalla sólo MUESTRA la posición: no escribe
  // (sin posiciones duplicadas). Sin fondo, es el respaldo de siempre.
  useEffect(() => {
    if (!conductor) return undefined;
    let detener = null;
    let cerrado = false;
    let primera = true;
    seguirPosicion((p) => {
      ultima.current = p;
      setMio(p);
      setGps(null);
      if (primera && !fondoActivo('reparto')) { primera = false; Promise.resolve(upsertRutaLocation(id, p.lat, p.lng)).catch(() => {}); }
    }, { mensaje: 'Rastreando tu posición para la entrega.', alFallar: setGps })
      .then((d) => { if (cerrado) d(); else detener = d; })
      .catch(() => setGps('sin-gps'));
    const reloj = setInterval(() => {
      const p = ultima.current;
      if (p && !fondoActivo('reparto')) Promise.resolve(upsertRutaLocation(id, p.lat, p.lng)).catch(() => {});
    }, INTERVALO_POSICION_CONDUCTOR_MS);
    return () => { cerrado = true; detener?.(); clearInterval(reloj); };
  }, [conductor, id]);

  // ── Los demás: dónde va el camión, en vivo ───────────────────────────────
  useEffect(() => {
    if (!ruta || conductor) return undefined;
    Promise.resolve(fetchRutaLocationSingle(id))
      .then(({ data }) => { if (data) setCamion({ lat: parseFloat(data.lat), lng: parseFloat(data.lng), at: data.updated_at }); })
      .catch(() => {});
    return escucharCambios(`ruta-loc-app-${id}`, [{ tabla: 'ruta_locations', filtro: `ruta_id=eq.${id}` }], ({ new: row }) => {
      if (row?.lat != null && row?.lng != null) setCamion({ lat: parseFloat(row.lat), lng: parseFloat(row.lng), at: row.updated_at ?? new Date().toISOString() });
    });
  }, [ruta, conductor, id]);

  const paradas = useMemo(() => (ruta ? ordenarParadas(ruta) : []), [ruta]);
  const { entregadas, total, completa } = avanceDeEntrega(paradas);
  const trazo = useMemo(() => trazoDeReparto(coords.bodega, paradas, coords.porSucursal), [coords, paradas]);
  const region = useMemo(() => encuadre([...trazo, ...(mio ? [mio] : []), ...(camion ? [camion] : [])]), [trazo, mio, camion]);
  const enVivo = camion ? conductorEnVivo(camion.at) : false;

  const hacer = (titulo, mensaje, boton, accion, exito) => {
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel' },
      { text: boton, onPress: async () => {
        setOcupado(boton);
        trabajando(`${boton}…`);
        try {
          const { error: e } = await accion();
          if (e) throw e;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo(exito);
          await cargar();
        } catch (e) { fallo(`No se pudo: ${boton.toLowerCase()}`, mensajeAmigable(e)); }
        finally { setOcupado(null); }
      } },
    ]);
  };
  const entregar = (p) => hacer(`Entregar en ${p.suc_name}`, 'La sala recibe el aviso de que llegaste.', 'Entregué',
    () => updateRutaPedidoEntregado(p.id, user?.id, { sucursal_id: p.erp_sucursal_id, desde: 'app' }), 'Parada entregada');
  const iniciar = () => hacer(`Iniciar ruta #${ruta.numero}`, 'Las salas reciben el aviso de que vas en camino, y tu ubicación se ve en el mapa aun con la app cerrada hasta que vuelvas a base.', 'Iniciar',
    async () => {
      const r = await iniciarRuta(ruta.id, { desde: 'app' });
      if (!r?.error) {
        const modo = await Promise.resolve(activarRutaDeFondo('reparto', { rutaId: String(ruta.id) })).catch(() => 'sin-fondo');
        setSinFondo(modo === 'fondo' ? null : modo);
      }
      return r;
    }, 'Ruta iniciada');
  const volver = () => hacer('Volver a base', 'Se cierra la ruta: todas las paradas están entregadas. Se deja de anotar tu ubicación.', 'Cerrar ruta',
    async () => {
      const r = await completarRuta(ruta.id, { desde: 'app' });
      if (!r?.error) await Promise.resolve(quitarRutaDeFondo('reparto')).catch(() => {});
      return r;
    }, 'Ruta cerrada');

  const estado = ruta ? estadoDeRuta(ruta.status) : null;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: ruta ? `Ruta #${ruta.numero}` : 'Ruta' }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 14 }}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {ruta == null ? <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14 }}><Esqueleto lineas={5} /></View></Vidrio></View> : null}
        {ruta ? (
          <>
            <View style={{ marginHorizontal: 20, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{conductor ? 'Tu ruta' : ruta.conductor_nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {[estado.label, ruta.salida_at ? `salió ${hora12(ruta.salida_at)}` : null, distanciaTexto(ruta.distancia_total_m),
                  `${entregadas}/${total} entregadas`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {region ? (
              <View style={{ marginHorizontal: 16 }}>
                <Vidrio radio={20}>
                  <View style={{ height: 380, borderRadius: 20, overflow: 'hidden' }}>
                    <MapView ref={mapa} style={{ flex: 1 }} initialRegion={region} showsUserLocation={conductor} showsPointsOfInterest={false}>
                      {trazo.length > 1 ? <Polyline coordinates={trazo.map(coord)} strokeColor={INDIGO} strokeWidth={4} /> : null}
                      {coords.bodega ? <Marker coordinate={coord(coords.bodega)} title="Bodega"><Pin texto="B" color="#1e1b4b" alto={32} /></Marker> : null}
                      {paradas.map((p, i) => {
                        const c = coords.porSucursal[p.erp_sucursal_id];
                        return c ? (
                          <Marker key={p.id} coordinate={coord(c)} title={`${i + 1}. ${p.suc_name}`}
                            description={p.entregado_at ? `Entregado ${hora12(p.entregado_at)}` : 'Pendiente'}>
                            <Pin texto={i + 1} color={p.entregado_at ? MARCA.verde : INDIGO} />
                          </Marker>
                        ) : null;
                      })}
                      {!conductor && camion ? (
                        <Marker coordinate={coord(camion)} title={`Conductor: ${ruta.conductor_nombre}`} description={enVivo ? 'En vivo' : `Última posición ${hora12(camion.at)}`}>
                          <Pin texto="🚚" color="#1d4ed8" alto={34} />
                        </Marker>
                      ) : null}
                    </MapView>
                    <Pressable accessibilityRole="button" accessibilityLabel={conductor ? 'Centrar en mí' : 'Ver el camión'}
                      onPress={() => {
                        const p = conductor ? mio : camion;
                        mapa.current?.animateToRegion(p ? { ...coord(p), latitudeDelta: 0.01, longitudeDelta: 0.01 } : region, 350);
                      }}
                      style={({ pressed }) => ({ position: 'absolute', right: 10, top: 10, paddingHorizontal: 12, minHeight: 34, borderRadius: 17,
                        justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                        {conductor ? (mio ? 'Centrar en mí' : 'Buscando GPS…') : camion ? (enVivo ? '● En vivo' : 'Última posición') : 'Sin ubicación aún'}
                      </Text>
                    </Pressable>
                  </View>
                </Vidrio>
              </View>
            ) : (
              <View style={{ marginHorizontal: 16 }}><Aviso texto="Las salas de esta ruta todavía no tienen ubicación en el mapa." /></View>
            )}
            {conductor && gps ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={MOTIVO_GPS[gps] ?? MOTIVO_GPS['sin-gps']} /></View> : null}
            {conductor && enRuta && fondo ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Tu ubicación se ve en el mapa aun con la app cerrada, hasta que vuelvas a base." /></View> : null}
            {conductor && enRuta && !fondo && sinFondo && sinFondo !== 'denegado' && !gps ? <View style={{ marginHorizontal: 16 }}><AvisoUbicacionSiempre /></View> : null}
            {conductor && mio ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 20 }}>Mientras esta pantalla esté abierta, Bodega ve dónde vas.</Text>
            ) : null}

            <View style={{ marginHorizontal: 16 }}>
            <Seccion titulo={`Paradas · ${entregadas}/${total} entregadas`}>
              {paradas.map((p, i) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 10 : 0,
                  borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Pin texto={i + 1} color={p.entregado_at ? MARCA.verde : INDIGO} alto={26} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{p.suc_name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {[p.numeros?.length ? `Pedido ${p.numeros.map((n) => `#${n}`).join(', ')}` : null,
                        p.distancia_desde_anterior_m != null ? `${distanciaTexto(p.distancia_desde_anterior_m)} desde ${i === 0 ? 'bodega' : `parada ${i}`}` : null,
                        p.entregado_at ? `Entregado ${hora12(p.entregado_at)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {conductor && !deSala && !p.entregado_at && ruta.status === 'en_ruta' ? (
                    <Pressable onPress={() => entregar(p)} disabled={!!ocupado} accessibilityRole="button" accessibilityLabel={`Entregué en ${p.suc_name}`}
                      style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: MARCA.verde,
                        opacity: ocupado ? 0.5 : pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Entregué</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </Seccion>
            </View>

            {!deSala ? (
              <View style={{ marginHorizontal: 16, gap: 8 }}>
                {ruta.status === 'pendiente' && conductor ? <BotonGrande texto="Iniciar ruta" color={INDIGO} deshabilitado={!!ocupado} onPress={iniciar} /> : null}
                {ruta.status === 'en_ruta' && (conductor || canEdit) && completa ? (
                  <BotonGrande texto="Volver a base" color={MARCA.azul} deshabilitado={!!ocupado} onPress={volver} />
                ) : null}
                {ruta.vuelta_base_at ? <Aviso texto={`Llegó a base a las ${hora12(ruta.vuelta_base_at)}.`} /> : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
