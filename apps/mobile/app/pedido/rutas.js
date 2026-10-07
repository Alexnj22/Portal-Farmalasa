// Las rutas de reparto, NATIVAS — la pestaña «Rutas» de Pedidos
// (`views/pedidos/TabRutas.jsx`): las activas arriba y las completadas aparte,
// con su conductor, el avance de las paradas y la distancia. Cada ruta abre su
// mapa (`/pedido/ruta/<id>`), donde el conductor inicia, entrega y vuelve.
//
// Lo que se lee y cómo se rotula sale del núcleo (`data/` y
// `utils/rutasDeEntrega.js`), lo mismo que pinta el portal. ARMAR una ruta
// —elegir pedidos y optimizar el recorrido— sigue en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchRutasDeEntrega } from '@nucleo/data/rutasDeEntrega';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import { avanceDeEntrega, distanciaTexto, estadoDeRuta, filtrarRutas, ordenarParadas, separarRutas } from '@nucleo/utils/rutasDeEntrega';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Avance } from '../../componentes/inicio/Kpi';
import { Esqueleto } from '../../componentes/inicio/Widget';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';

const COLOR_ESTADO = { warning: MARCA.ambar, 'chart-9': MARCA.azulClaro, success: MARCA.verde, danger: MARCA.rojo };

function TarjetaRuta({ ruta, yo }) {
  const paradas = ordenarParadas(ruta);
  const { entregadas, total } = avanceDeEntrega(paradas);
  const estado = estadoDeRuta(ruta.status);
  const color = COLOR_ESTADO[estado.variante] ?? MARCA.azulClaro;
  const mia = ruta.conductor_id === yo;
  return (
    <Pressable style={{ marginHorizontal: 16 }} accessibilityRole="button" accessibilityLabel={`Ruta ${ruta.numero}, ${estado.label}`}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/pedido/ruta/${ruta.id}`); }}>
      {({ pressed }) => (
        <Vidrio radio={20} interactivo>
          <View style={{ padding: 14, gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', flex: 1 }}>{`Ruta #${ruta.numero}`}</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: `${color}33` }}>
                <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{estado.label}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={2}>
              {[mia ? 'Tú conduces' : ruta.conductor_nombre, ruta.salida_at ? `salió ${hora12(ruta.salida_at)}` : null,
                distanciaTexto(ruta.distancia_total_m)].filter(Boolean).join(' · ')}
            </Text>
            {total > 0 ? (
              <View style={{ gap: 4 }}>
                <Avance parte={entregadas} total={total} color={MARCA.verde} />
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${entregadas} de ${total} paradas entregadas`}</Text>
              </View>
            ) : null}
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export default function RutasDeReparto() {
  const { user, hasPermission, getScope } = useAuth();
  const puedeArmar = hasPermission('pedidos_tab_rutas', 'can_edit') && getScope?.('pedidos_tab_rutas') === 'ALL';
  const [rutas, setRutas] = useState(null);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setRutas(await fetchRutasDeEntrega()); setError(''); }
    catch (e) { setError(mensajeAmigable(e)); setRutas((r) => r ?? []); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
  // Como el portal: cualquier cambio de una ruta o de una parada se ve solo.
  useEffect(() => escucharCambios('rutas-app', [{ tabla: 'rutas' }, { tabla: 'ruta_pedidos' }], () => { cargar(); }), [cargar]);

  const { activas, completadas } = useMemo(() => separarRutas(filtrarRutas(rutas ?? [], buscar)), [rutas, buscar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Rutas de reparto', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Número o conductor', onChangeText: (e) => setBuscar(e.nativeEvent.text) } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {rutas == null ? (
          <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14 }}><Esqueleto lineas={4} /></View></Vidrio></View>
        ) : null}
        {rutas && !activas.length && !completadas.length ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40, fontSize: 15, marginHorizontal: 24 }}>
            {buscar.trim() ? `Ninguna ruta coincide con «${buscar.trim()}».` : 'Aquí aparecen las entregas cuando bodega arma una ruta.'}
          </Text>
        ) : null}
        {activas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>Activas</Text> : null}
        {activas.map((r) => <TarjetaRuta key={r.id} ruta={r} yo={user?.id} />)}
        {completadas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32, marginTop: 8 }}>Completadas</Text> : null}
        {completadas.map((r) => <TarjetaRuta key={r.id} ruta={r} yo={user?.id} />)}
        {puedeArmar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            {/* Armar una ruta elige pedidos y optimiza el recorrido: sigue en el portal. */}
            <BotonGrande texto="Crear ruta (portal)" borde
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/pedidos', nombre: 'Pedidos' } })} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
