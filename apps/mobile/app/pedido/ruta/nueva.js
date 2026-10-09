// Armar una ruta de reparto, NATIVO — el `CrearRutaModal` del portal en dos
// pasos: qué salas finalizadas suben al camión, y el orden de las paradas
// (optimizado por carretera, movible a mano, con encargos sin pedido).
//
// Quien la arma es quien conduce, como en el portal, y la ruta SALE en cuanto
// se crea: el aviso «en camino» a cada sala lo escribe la base. Las cuentas son
// del núcleo (`armarRutaDeReparto`, `routeOptimizer`) y la escritura también
// (`crearRutaYSalir`).
//
// La tabla de carretera la da el intermediario del servidor (`maps-proxy`); si
// no responde, se ordena en línea recta, igual que el portal cuando Google
// falla. El trazo del mapa va en línea recta entre paradas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmployeeDriverInfo, fetchPedidosDisponiblesParaRuta, fetchReenviosPorDespachar, fetchSalasListasParaRuta, fetchSucursalesConCoords } from '@nucleo/data/pedidos';
import { crearRutaYSalir } from '@nucleo/data/accionesDeBodega';
import {
  juntarParadas, lineaDeTiempo, minutosTexto, nombresDeSalas, paradasDeSalas, paradasParaGuardar, pedidosParaRuta, reenviosParaRuta, visitasDeRuta,
} from '@nucleo/utils/armarRutaDeReparto';
import { armarRuta, matrizPorCarreteraREST, optimizarPorCarretera, optimizeRoute, totalRoute, tramoEnLineaRecta } from '@nucleo/utils/routeOptimizer';
import { coordenadasDeSucursales, distanciaTexto } from '@nucleo/utils/rutasDeEntrega';
import { duracionConParadas } from '@nucleo/utils/logicaDeRutas';
import { encuadre } from '@nucleo/utils/encuadreDelMapa';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../../componentes/formulario/Piezas';
import Segmentos from '../../../componentes/Segmentos';
import Vidrio from '../../../componentes/Vidrio';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';

const INDIGO = MARCA.violetaClaro;
const BODEGA_POR_DEFECTO = { lat: 14.041177, lng: -88.963111 };
const coord = (p) => ({ latitude: p.lat, longitude: p.lng });

function Pin({ texto, color, alto = 28 }) {
  return (
    <View style={{ width: alto, height: alto, borderRadius: alto / 2, backgroundColor: color, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{texto}</Text>
    </View>
  );
}

function Fila({ titulo, detalle, marcado, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 22, color: marcado ? MARCA.verde : colorSistema.texto2 }}>{marcado ? '●' : '○'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
    </Pressable>
  );
}

function Mini({ texto, onPress, color = MARCA.azulClaro, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function NuevaRuta() {
  const { con } = useLocalSearchParams();
  const { user } = useAuth();
  const [paso, setPaso] = useState('1');
  const [conductor, setConductor] = useState({ nombre: '', corto: '' });
  const [disponibles, setDisponibles] = useState(null);
  const [coords, setCoords] = useState({ porSucursal: {}, bodega: null });
  const [nombres, setNombres] = useState({});
  const [elegidos, setElegidos] = useState(new Set());
  const [paradas, setParadas] = useState([]);
  const [carretera, setCarretera] = useState(false);
  const [optimizando, setOptimizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const medir = useRef(tramoEnLineaRecta);

  useEffect(() => {
    if (user?.id) {
      Promise.resolve(fetchEmployeeDriverInfo(user.id)).then(({ data }) => setConductor({
        nombre: data ? `${data.first_names} ${data.last_names}`.trim() : (user.email ?? 'Usuario'),
        corto: data ? shortEmployeeName(data) : (user.email ?? 'Usuario'),
      })).catch(() => {});
    }
    (async () => {
      try {
        // Como el portal: primero los pedidos abiertos y DESPUÉS sus salas, así
        // la segunda consulta va acotada a esos pedidos y descarta las que ya
        // salieron o llegaron. Los reenvíos de cajas faltantes van primero y
        // ya marcados.
        const ped = await fetchPedidosDisponiblesParaRuta();
        if (ped.error) throw ped.error;
        const [pss, suc, reen] = await Promise.all([
          fetchSalasListasParaRuta((ped.data ?? []).map((p) => p.id)),
          fetchSucursalesConCoords(),
          fetchReenviosPorDespachar(),
        ]);
        if (pss.error) throw pss.error;
        if (reen.error) throw reen.error;
        if (suc.error) throw suc.error;
        const nm = nombresDeSalas(suc.data ?? []);
        const reenvios = reenviosParaRuta(reen.data ?? [], nm);
        const items = [...reenvios, ...pedidosParaRuta(ped.data ?? [], pss.data ?? [], nm)];
        setNombres(nm);
        setCoords(coordenadasDeSucursales(suc.data ?? []));
        setDisponibles(items);
        setElegidos(new Set([
          ...reenvios.map((r) => r.key),
          ...(con && items.some((i) => i.key === con) ? [con] : []),
        ]));
      } catch (e) {
        setError(mensajeAmigable(e));
        setDisponibles([]);
      }
    })();
  }, [user?.id, user?.email, con]);

  const bodega = coords.bodega ?? BODEGA_POR_DEFECTO;
  const seleccion = useMemo(() => (disponibles ?? []).filter((p) => elegidos.has(p.key)), [disponibles, elegidos]);
  const alternar = (k) => { Haptics.selectionAsync().catch(() => {}); setElegidos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };

  const optimizar = async () => {
    setOptimizando(true);
    const { conUbicacion, sinUbicacion } = paradasDeSalas(seleccion, coords.porSucursal);
    let ordenadas;
    try {
      const r = await optimizarPorCarretera(conUbicacion, bodega, matrizPorCarreteraREST);
      ordenadas = r.paradas;
      medir.current = r.medir;
      setCarretera(true);
    } catch {
      ordenadas = optimizeRoute(conUbicacion, bodega);
      medir.current = tramoEnLineaRecta;
      setCarretera(false);
    }
    setParadas(juntarParadas(ordenadas, sinUbicacion));
    setOptimizando(false);
    setPaso('2');
  };

  const rearmar = useCallback((lista) => armarRuta(lista, bodega, medir.current), [bodega]);
  const mover = (i, d) => setParadas((prev) => {
    const t = i + d;
    if (t < 0 || t >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[t]] = [next[t], next[i]];
    return rearmar(next);
  });
  const quitar = (uid) => setParadas((prev) => rearmar(prev.filter((s) => s._uid !== uid)));
  const agregarEncargo = () => {
    const usadas = new Set(paradas.map((p) => Number(p.erp_sucursal_id)));
    const opciones = Object.entries(nombres).filter(([id]) => !usadas.has(Number(id)) && coords.porSucursal[id]);
    if (!opciones.length) { fallo('Sin salas', 'Todas las salas con ubicación ya están en la ruta.'); return; }
    Alert.alert('Agregar un encargo', 'Una parada sin pedido (recoger, llevar papeles…).', [
      ...opciones.slice(0, 8).map(([id, nombre]) => ({
        text: nombre,
        onPress: () => setParadas((prev) => rearmar([...prev, {
          erp_sucursal_id: Number(id), suc_name: nombre, lat: coords.porSucursal[id]?.lat, lng: coords.porSucursal[id]?.lng,
          isEncargo: true, items: [], _uid: `enc-${id}-${Date.now()}`,
        }])),
      })),
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const linea = useMemo(() => lineaDeTiempo(paradas), [paradas]);
  const ultima = paradas[paradas.length - 1];
  const vuelta = ultima && ultima.lat != null ? medir.current({ lat: ultima.lat, lng: ultima.lng }, bodega) : null;
  const totales = totalRoute(paradas.filter((s) => s.dist_m != null));
  const distancia = totales.dist_m + (vuelta?.dist_m ?? 0);
  const manejo = totales.dur_min + (vuelta?.dur_min ?? 0);
  const trazo = [bodega, ...paradas.filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lng })), bodega];
  const region = paradas.length ? encuadre(trazo) : null;

  const crear = async () => {
    setGuardando(true);
    trabajando('Creando la ruta…');
    try {
      const rutaId = await crearRutaYSalir({
        conductorId: user?.id ?? null, conductorNombre: conductor.nombre,
        paradas: paradasParaGuardar(paradas), visitas: visitasDeRuta(paradas),
        // Con las descargas (`MIN_POR_PARADA` por parada), no sólo conducir: como el portal.
        distanciaM: distancia || null, duracionMin: duracionConParadas(manejo, paradas.length) || null, creadoPor: user?.id ?? null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('La ruta salió', 'Cada sala recibe el aviso de que va en camino.');
      router.replace({ pathname: '/pedido/ruta/[id]', params: { id: String(rutaId) } });
    } catch (e) {
      fallo('No se pudo crear la ruta', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };
  const confirmar = () => Alert.alert('Crear y salir',
    `${paradas.length} parada${paradas.length === 1 ? '' : 's'}${distancia ? ` · ${distanciaTexto(distancia)}` : ''}. Conduces tú (${conductor.corto}) y la ruta sale ya: cada sala recibe el aviso.`,
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Crear y salir', onPress: crear }]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Armar ruta', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48, gap: 14 }}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        <Segmentos activa={paso} onCambiar={(v) => { if (v === '1' || paradas.length) setPaso(v); }}
          opciones={[{ id: '1', label: 'Pedidos' }, { id: '2', label: 'Paradas' }]} />
        {disponibles == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : paso === '1' ? (
          <View style={{ marginHorizontal: 16, gap: 12 }}>
            {!disponibles.length ? <Aviso texto="No hay salas finalizadas esperando salir." /> : (
              <Seccion titulo={`Listos para salir · ${disponibles.length}`} pie={conductor.corto ? `Conduce ${conductor.corto}.` : null}>
                {disponibles.length > 1 ? (
                  <Pressable onPress={() => setElegidos(elegidos.size === disponibles.length ? new Set() : new Set(disponibles.map((p) => p.key)))} style={{ minHeight: 40, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{elegidos.size === disponibles.length ? 'Quitar todos' : 'Elegir todos'}</Text>
                  </Pressable>
                ) : null}
                {disponibles.map((p) => (
                  <Fila key={p.key} marcado={elegidos.has(p.key)} onPress={() => alternar(p.key)}
                    titulo={`${p.esReenvio ? 'Reenvío · ' : ''}Pedido #${p.numero} · ${p.suc_name}`}
                    detalle={[`${p.total_cajas} caja${p.total_cajas === 1 ? '' : 's'}`, p.cajas_electrolit ? `${p.cajas_electrolit} Electrolit` : null,
                      p.cajas_especiales?.length ? `${p.cajas_especiales.length} especiales` : null].filter(Boolean).join(' · ')} />
                ))}
              </Seccion>
            )}
            <BotonGrande texto={optimizando ? 'Ordenando…' : `Ordenar ${seleccion.length ? `(${new Set(seleccion.map((s) => s.erp_sucursal_id)).size} paradas)` : ''}`}
              deshabilitado={!seleccion.length || optimizando} onPress={optimizar} />
          </View>
        ) : (
          <View style={{ marginHorizontal: 16, gap: 12 }}>
            {region ? (
              <Vidrio radio={20}>
                <View style={{ height: 300, borderRadius: 20, overflow: 'hidden' }}>
                  <MapView style={{ flex: 1 }} region={region} showsPointsOfInterest={false}>
                    {trazo.length > 1 ? <Polyline coordinates={trazo.map(coord)} strokeColor={INDIGO} strokeWidth={4} /> : null}
                    <Marker coordinate={coord(bodega)} title="Bodega"><Pin texto="B" color="#1e1b4b" alto={32} /></Marker>
                    {paradas.map((p, i) => (p.lat != null ? (
                      <Marker key={p._uid} coordinate={coord(p)} title={`${i + 1}. ${p.suc_name}`}><Pin texto={i + 1} color={p.isEncargo ? MARCA.ambar : INDIGO} /></Marker>
                    ) : null))}
                  </MapView>
                </View>
              </Vidrio>
            ) : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
              {[distancia ? distanciaTexto(distancia) : null, manejo ? `${minutosTexto(manejo)} manejando` : null, carretera ? 'por carretera' : 'en línea recta'].filter(Boolean).join(' · ')}
            </Text>
            <Seccion titulo="Paradas">
              {linea.map(({ stop, cajas, electrolit, especiales, acumulado }, i) => (
                <View key={stop._uid} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
                  <Pin texto={i + 1} color={stop.isEncargo ? MARCA.ambar : INDIGO} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{stop.suc_name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {stop.isEncargo ? 'Encargo, sin pedido' : [`${cajas} caja${cajas === 1 ? '' : 's'}`, electrolit ? `${electrolit} Electrolit` : null, especiales ? `${especiales} especiales` : null,
                        stop.dist_m != null ? distanciaTexto(stop.dist_m) : 'sin ubicación', acumulado ? `llega a los ${minutosTexto(acumulado)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Mini texto="↑" deshabilitado={i === 0} onPress={() => mover(i, -1)} />
                  <Mini texto="↓" deshabilitado={i === paradas.length - 1} onPress={() => mover(i, 1)} />
                  <Mini texto="✕" color={MARCA.rojo} onPress={() => quitar(stop._uid)} />
                </View>
              ))}
              {vuelta ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Regreso a bodega: ${distanciaTexto(vuelta.dist_m)}${vuelta.dur_min ? ` · ${minutosTexto(vuelta.dur_min)}` : ''}`}</Text> : null}
            </Seccion>
            <BotonGrande texto="Agregar un encargo" borde onPress={agregarEncargo} />
            <BotonGrande texto={guardando ? 'Creando…' : 'Crear y salir'} color={MARCA.verde}
              deshabilitado={guardando || !paradas.some((p) => !p.isEncargo)} onPress={confirmar} />
          </View>
        )}
      </ScrollView>
    </>
  );
}
