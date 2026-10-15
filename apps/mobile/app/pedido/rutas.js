// Las rutas de reparto, NATIVAS — la pestaña «Rutas» de Pedidos
// (`views/pedidos/TabRutas.jsx`): las activas arriba y las completadas aparte,
// con su conductor, el avance de las paradas y la distancia. Cada ruta abre su
// mapa (`/pedido/ruta/<id>`), donde el conductor inicia, entrega y vuelve.
//
// Lo que se lee y cómo se rotula sale del núcleo (`data/` y
// `utils/rutasDeEntrega.js`), lo mismo que pinta el portal. ARMAR una ruta
// —elegir pedidos y optimizar el recorrido— es `pedido/ruta/nueva`.
//
// Arriba, las tres cifras de HOY del portal (en la calle, por salir,
// completadas hoy; `cifrasDeRutas`) y los mismos filtros: estado (por defecto
// sólo las activas), período de las completadas y conductor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchRutasDeEntrega } from '@nucleo/data/rutasDeEntrega';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import {
  avanceDeEntrega, cifrasDeRutas, completadasEnPeriodo, conductoresDeRutas, distanciaTexto, estadoDeRuta, filtrarRutas, ordenarParadas, separarRutas,
} from '@nucleo/utils/rutasDeEntrega';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import Kpi, { Avance, FilaDeKpis } from '../../componentes/inicio/Kpi';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
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
  const [estado, setEstado] = useState('activas');      // 'activas' | 'completadas' | 'todas'
  const [periodo, setPeriodo] = useState('7d');
  const [conductor, setConductor] = useState('');

  const cargar = useCallback(async () => {
    try { setRutas(await fetchRutasDeEntrega()); setError(''); }
    catch (e) { setError(mensajeAmigable(e)); setRutas((r) => r ?? []); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
  // Como el portal: cualquier cambio de una ruta o de una parada se ve solo.
  useEffect(() => escucharCambios('rutas-app', [{ tabla: 'rutas' }, { tabla: 'ruta_pedidos' }], () => { cargar(); }), [cargar]);

  const { activas: todasActivas, completadas: todasCompletadas } = useMemo(() => separarRutas(filtrarRutas(rutas ?? [], buscar)
    .filter((r) => !conductor || r.conductor_nombre === conductor)), [rutas, buscar, conductor]);
  const activas = estado !== 'completadas' ? todasActivas : [];
  const completadas = estado !== 'activas' ? completadasEnPeriodo(todasCompletadas, periodo) : [];
  const cifras = useMemo(() => cifrasDeRutas(rutas ?? []), [rutas]);
  const conductores = useMemo(() => conductoresDeRutas(rutas ?? []), [rutas]);
  const grupos = [
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'activas', onCambiar: setEstado,
      opciones: [{ id: 'activas', label: 'Activas' }, { id: 'completadas', label: 'Completadas' }, { id: 'todas', label: 'Todas' }] },
    ...(estado !== 'activas' ? [{ id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: '7d', onCambiar: setPeriodo,
      opciones: [{ id: 'hoy', label: 'Hoy' }, { id: '7d', label: '7 días' }, { id: '30d', label: '30 días' }] }] : []),
    ...(conductores.length > 1 ? [{ id: 'conductor', titulo: 'Conductor', activa: conductor, porDefecto: '', onCambiar: setConductor,
      opciones: [{ id: '', label: 'Todos' }, ...conductores.map((c) => ({ id: c, label: c }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Rutas de reparto', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Número o conductor', onChangeText: (e) => setBuscar(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {rutas ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Truck" rotulo="En la calle" valor={String(cifras.enCalle.length)} color={MARCA.azulClaro} pide={estado === 'activas'}
                apoyo={`${cifras.entregadasVivas}/${cifras.paradasVivas} paradas entregadas`} onPress={() => setEstado('activas')} />
              <Kpi icono="Clock" rotulo="Por salir" valor={String(cifras.pendientes.length)} color={MARCA.ambar} apoyo="rutas armadas, sin salir" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="CheckCircle2" rotulo="Completadas hoy" valor={String(cifras.cerradasHoy.length)} color={MARCA.verde} pide={estado === 'completadas'}
                apoyo="ver las completadas" onPress={() => setEstado('completadas')} />
            </FilaDeKpis>
          </>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {rutas == null ? (
          <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14 }}><Esqueleto lineas={4} /></View></Vidrio></View>
        ) : null}
        {rutas && !activas.length && !completadas.length ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40, fontSize: 15, marginHorizontal: 24 }}>
            {buscar.trim() ? `Ninguna ruta coincide con «${buscar.trim()}».`
              : conductor || estado !== 'activas' ? 'Ninguna ruta con ese filtro.'
                : 'No hay rutas en la calle. Las completadas están en el filtro de estado.'}
          </Text>
        ) : null}
        {activas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>Activas</Text> : null}
        {activas.map((r) => <TarjetaRuta key={r.id} ruta={r} yo={user?.id} />)}
        {completadas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32, marginTop: 8 }}>Completadas</Text> : null}
        {completadas.map((r) => <TarjetaRuta key={r.id} ruta={r} yo={user?.id} />)}
        {puedeArmar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Crear ruta" borde onPress={() => router.push('/pedido/ruta/nueva')} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
