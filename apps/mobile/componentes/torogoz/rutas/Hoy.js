// La ruta del día (la pestaña «Hoy» de `TabRutas`): los clientes de las rutas
// que tocan ese día, en su orden, con lo que conviene saber antes de entrar
// —qué debe, si está atrasado, cuándo compró— y qué pasó en la visita. Quien
// administra elige el vendedor; cada quien ve la suya.
//
// La visita se registra con un toque: «Vender» abre la venta con el cliente
// puesto; «Registrar visita» pregunta qué pasó (el diálogo ES la confirmación).
// La visita lleva la ubicación del teléfono si la da en 8 segundos (como el
// portal en la app); sin ella cuenta igual. «Iniciar ruta» anota el recorrido
// —un punto por minuto— aun con la app cerrada si hay permiso «siempre»; si
// no, mientras la app está abierta. Ver `rastreo.js`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchRecorrido, fetchRutaDelDia, mensajeDeDistribucion, registrarVisita } from '@nucleo/data/distribucion';
import { rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { RESULTADOS_VISITA, ROTULO_RESULTADO, avanceDeRuta, comoLlegar, enElMapa } from '@nucleo/utils/distribucionRutas';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { diasDesde, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { posicionActual, ubicacionNegada } from '@plataforma/ubicacion';
import { colorSistema } from '../../Formulario';
import Vidrio from '../../Vidrio';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { Esqueleto } from '../../inicio/Widget';
import { Aviso } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import PasoDeDia from './PasoDeDia';
import Etiqueta from './Etiqueta';
import MapaDeRuta from './MapaDeRuta';
import { iniciarRuta, terminarRuta, useRastreoDeRuta } from './rastreo';
import AvisoUbicacionSiempre from '../../AvisoUbicacionSiempre';

const PROBLEMA_GPS = {
  denegado: 'El teléfono no da permiso de ubicación: la ruta sigue, pero sin recorrido. Se activa en Ajustes › Farmalasa › Ubicación.',
  'sin-senal': 'Sin señal de GPS por ahora: el recorrido sigue en cuanto vuelva.',
  'sin-gps': 'El GPS del teléfono no respondió: la ruta sigue, pero sin recorrido.',
};

const PETROLEO = '#0f6e7d';

function Accion({ texto, color = PETROLEO, lleno = false, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center',
        backgroundColor: lleno ? color : `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: lleno ? '#fff' : color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function TarjetaCliente({ c, i, puedeActuar, ocupado, onVisita }) {
  const saldo = Number(c.saldo) || 0;
  const vencido = Number(c.vencido) || 0;
  const hace = c.ultima_compra ? diasDesde(c.ultima_compra) : null;
  return (
    <View style={{ marginHorizontal: 16, opacity: c.estado !== 'pendiente' ? 0.75 : 1 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: `${PETROLEO}40` }}>
              <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '800' }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{c.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{rotuloTipoCliente(c.tipo)}{c.direccion ? ` · ${c.direccion}` : ''}</Text>
            </View>
            {c.estado === 'venta' ? <Etiqueta variante="success" texto={`Vendió ${formatMoney(Number(c.venta))}`} />
              : c.estado === 'visitado' ? <Etiqueta variante="neutral" texto={ROTULO_RESULTADO[c.visita?.resultado] ?? 'Visitado'} />
                : <Etiqueta variante="warning" texto="Pendiente" />}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {saldo > 0 ? <Etiqueta variante={vencido > 0 ? 'danger' : 'neutral'} texto={`Debe ${formatMoney(saldo)}${vencido > 0 ? ` · ${formatMoney(vencido)} atrasado` : ''}`} /> : null}
            {hace != null ? <Etiqueta variante={hace > 30 ? 'warning' : 'neutral'} texto={`Compró hace ${hace} días`} />
              : <Etiqueta variante="info" texto="Nunca ha comprado" />}
          </View>
          {puedeActuar ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Accion texto="Vender" lleno onPress={() => router.push(`/torogoz/venta?cliente=${c.id}`)} />
              <Accion texto={ocupado ? 'Guardando…' : 'Registrar visita'} deshabilitado={!!ocupado} onPress={() => onVisita(c)} />
              <Accion texto="Cómo llegar" color={MARCA.azulClaro} onPress={() => Linking.openURL(comoLlegar(c)).catch(() => {})} />
              {c.telefono ? <Accion texto="Llamar" color={MARCA.verde} onPress={() => Linking.openURL(`tel:${String(c.telefono).replace(/[^\d+]/g, '')}`).catch(() => {})} /> : null}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}

export default function Hoy({ puedeConfigurar, fecha, vendedorElegido, onFecha, vendedores = [] }) {
  const { user } = useAuth();
  const vendedorId = (puedeConfigurar && vendedorElegido) || user?.id;
  const [datos, setDatos] = useState(null);
  const [recorrido, setRecorrido] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    if (!vendedorId) return;
    // El recorrido es ayuda: si no se puede leer, la ruta abre igual.
    fetchRecorrido(vendedorId, fecha).then(setRecorrido).catch(() => setRecorrido(null));
    setError('');
    try { setDatos(await fetchRutaDelDia(vendedorId, fecha)); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
  }, [vendedorId, fecha]);
  useEffect(() => { setCargando(true); cargar(); }, [cargar]);

  const clientes = useMemo(() => datos?.clientes ?? [], [datos]);
  const n = avanceDeRuta(clientes);
  const esHoy = fecha === hoySV();
  const esMio = vendedorId === user?.id;
  const nombreVendedor = vendedores.find((v) => v.id === vendedorId);
  const rastreo = useRastreoDeRuta(user?.id);

  // Anotar el recorrido es escribir: se confirma, igual que en el portal.
  const pedirIniciar = () => {
    Alert.alert('Iniciar ruta', 'Se anota tu ubicación cada minuto, aun con la app cerrada, hasta que termines la ruta.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Iniciar', onPress: async () => {
        const modo = await Promise.resolve(iniciarRuta(user?.id)).catch(() => 'sin-fondo');
        useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_RUTA_INICIADA', String(user?.id ?? ''), { fecha, desde: 'app', fondo: modo === 'fondo' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // Si el permiso ya estaba negado, se dice UNA vez, acá.
        if (modo === 'denegado' || await ubicacionNegada()) Alert.alert('Sin permiso de ubicación', PROBLEMA_GPS.denegado);
      } },
    ]);
  };
  const pedirTerminar = () => {
    Alert.alert('Terminar ruta', 'Se deja de anotar tu ubicación.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Terminar', style: 'destructive', onPress: () => {
        Promise.resolve(terminarRuta(user?.id)).catch(() => {});
        useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_RUTA_TERMINADA', String(user?.id ?? ''), { fecha, desde: 'app' });
        Haptics.selectionAsync().catch(() => {});
      } },
    ]);
  };

  const visitar = (c) => {
    Alert.alert(`Visita a ${c.nombre}`, '¿Qué pasó?', [
      ...RESULTADOS_VISITA.map((r) => ({
        text: r.label,
        onPress: async () => {
          setOcupado(c.id);
          try {
            const gps = await posicionActual();
            await registrarVisita(c.id, r.value, gps ?? {});
            useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_VISITA', String(c.id), { resultado: r.value, con_gps: !!gps, desde: 'app' });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            if (gps && c.lat == null) Alert.alert(c.nombre, 'Se guardó la ubicación del cliente.');
            await cargar();
          } catch (e) {
            Alert.alert('No se pudo registrar la visita', mensajeDeDistribucion(e));
          } finally {
            setOcupado(null);
          }
        },
      })),
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ gap: 14 }}>
      <PasoDeDia fecha={fecha} onCambiar={onFecha} />
      {puedeConfigurar && nombreVendedor && !esMio ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`Ruta de ${nombreVendedor.label}`}</Text>
      ) : null}
      <FilaDeKpis>
        <Kpi icono="Truck" rotulo="Por visitar" color={PETROLEO} valor={cargando ? '…' : formatQty(n.porVisitar)} apoyo={`de ${formatQty(n.total)} clientes`} />
        <Kpi icono="ShoppingCart" rotulo="Con venta" color={MARCA.verde} valor={cargando ? '…' : formatQty(n.venta)}
          apoyo={n.pctVenta != null ? `${n.pctVenta}% de los visitados` : 'Todavía nadie'} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="Check" rotulo="Visitados" color={MARCA.violetaClaro} valor={cargando ? '…' : formatQty(n.visitados)}
          apoyo={datos?.fuera_de_ruta ? `+ ${datos.fuera_de_ruta} ventas fuera de ruta` : 'Venta o visita registrada'} />
        <Kpi icono="Gauge" rotulo="Recorrido" color={MARCA.azulClaro}
          valor={recorrido?.ultima ? hora12(recorrido.ultima.at) : '—'}
          apoyo={recorrido?.ultima ? `${formatQty(recorrido.puntos?.length ?? 0)} puntos · ver en el mapa` : 'Sin ubicaciones'}
          onPress={recorrido?.ultima ? () => Linking.openURL(enElMapa(recorrido.ultima)).catch(() => {}) : undefined} />
      </FilaDeKpis>
      {esMio && esHoy ? (
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          {rastreo.enRuta ? (
            <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600', marginHorizontal: 4 }}>
              {rastreo.fondo
                ? 'En ruta: tu ubicación se anota cada minuto, aun con la app cerrada. Al terminar, toca «Terminar ruta».'
                : 'En ruta: tu ubicación se anota cada minuto mientras la app esté abierta. Al terminar, toca «Terminar ruta».'}
            </Text>
          ) : null}
          {rastreo.sinFondo && rastreo.sinFondo !== 'denegado' && !rastreo.problema ? <AvisoUbicacionSiempre /> : null}
          {rastreo.problema ? <Aviso tono="cuidado" texto={PROBLEMA_GPS[rastreo.problema] ?? PROBLEMA_GPS['sin-gps']} /> : null}
          <View style={{ flexDirection: 'row' }}>
            {rastreo.enRuta
              ? <Accion texto="Terminar ruta" color={MARCA.rojo} onPress={pedirTerminar} />
              : <Accion texto="Iniciar ruta" lleno onPress={pedirIniciar} />}
          </View>
        </View>
      ) : null}
      {datos?.rutas?.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{datos.rutas.map((r) => r.nombre).join(' · ')}</Text>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {cargando && !datos ? <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14 }}><Esqueleto lineas={4} /></View></Vidrio></View> : null}
      {!cargando && !error && clientes.length === 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso texto={`${datos?.rutas?.length ? 'Las rutas de este día no tienen clientes.' : 'Este día no tiene rutas asignadas.'}${puedeConfigurar ? ' Se arman en «Armar rutas».' : ''}`} />
        </View>
      ) : null}
      {clientes.length ? <MapaDeRuta clientes={clientes} recorrido={recorrido} /> : null}
      {clientes.map((c, i) => (
        <TarjetaCliente key={c.id} c={c} i={i} puedeActuar={esHoy && esMio} ocupado={ocupado === c.id} onVisita={visitar} />
      ))}
    </View>
  );
}
