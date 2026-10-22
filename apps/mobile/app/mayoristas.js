// Clientes Mayoristas, NATIVO — la misma vista del portal
// (`views/mayoristas/MayoristasView.jsx`): Solicitudes, Candidatos, Mayoristas
// e Historial, con la búsqueda por nombre o documento, el filtro del requisito
// (cláusula 2.3) y el orden. Qué entra en cada pestaña, el orden y cómo se lee
// el historial salen del núcleo (`utils/mayoristas`). Tocar un cliente abre su
// ficha (`mayorista/[id]`), donde se propone, se aprueba o rechaza, se cambia
// el precio o se retira.
//
// Candidatos (2026-10-19 en el portal): por defecto TODOS los que compraron a
// mayoreo en 6 meses más las fichas con «(4)»/«(5)» en el nombre, para
// decidirlos uno por uno; «cumplen», «con (4)/(5)» y «ver los no aprobados»
// son filtros. Quién decidió va con su foto y nombre corto.
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ESTADOS, ORIGENES, PRECIOS, RANGOS, fetchHistorialMayoristas, fetchMayoristas } from '@nucleo/data/mayoristas';
import { ORDENES_MAYORISTAS, filasDeMayoristas, solicitudesPendientes, textoDeAccion } from '@nucleo/utils/mayoristas';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import Tocable from '../componentes/Tocable';
import { ErrorConReintento, useColumnas } from '../componentes/ListaPaginada';
import { useEnTramos } from '../componentes/alFinal';
import { MARCA } from '../componentes/inicio/marca';
import { recordarMayorista } from '../componentes/mayoristas/elegido';
import Avatar from '../componentes/Avatar';

const COLOR_ESTADO = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, info: MARCA.azulClaro, neutral: '#8E8E93' };
const corta = (f) => fechaTexto(f, { day: 'numeric', month: 'short' });

const FilaCliente = memo(function FilaCliente({ f, tab, columnas }) {
  const estado = f.estado ? ESTADOS[f.estado] : null;
  return (
    <View style={{ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 10 }}>
      <Tocable accessibilityRole="button" accessibilityLabel={f.nombre}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); recordarMayorista(f); router.push(`/mayorista/${f.customer_id}`); }}>
        <Vidrio radio={18}>
          <View style={{ padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{f.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>
                  {[f.documento, f.estado === 'solicitado' ? ORIGENES[f.origen] : null,
                    tab === 'candidatos' && f.precio_en_nombre ? `${PRECIOS[f.precio_en_nombre]} en el nombre` : null,
                    f.ficha_completa ? null : 'Ficha incompleta'].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
              {tab === 'candidatos' ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.total)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`comprado (6 m) · ${f.facturas ?? 0} fact.`}</Text>
                </View>
              ) : (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: f.cumple ? colorSistema.texto : colorSistema.texto2, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.prom_3m)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>promedio 3 meses</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {tab === 'mayoristas' ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${PRECIOS[f.precio] ?? '—'} · ${RANGOS[f.rango]?.nombre ?? '—'}${f.retiro_programado ? ` · se retira el ${corta(f.retiro_programado)}` : ''}${!f.retiro_programado && f.precio_programado_el ? ` · pasa a Mayoreo el ${corta(f.precio_programado_el)}` : ''}`}
                </Text>
              ) : estado ? <Pildora texto={estado.label} color={COLOR_ESTADO[estado.variant] ?? COLOR_ESTADO.neutral} />
                : <Pildora texto={f.cumple ? 'Cumple' : 'No cumple aún'} color={f.cumple ? MARCA.azulClaro : COLOR_ESTADO.neutral} />}
              <Text style={{ color: colorSistema.texto2, fontSize: 12, flex: 1, textAlign: 'right' }} numberOfLines={1}>
                {tab === 'candidatos'
                  ? [f.a_mayoreo > 0 ? `${formatMoney(f.a_mayoreo)} a mayoreo` : null, RANGOS[f.rango_sugerido]?.nombre ? `tendría ${RANGOS[f.rango_sugerido].nombre}` : null, f.ultima_compra ? corta(f.ultima_compra) : null].filter(Boolean).join(' · ')
                  : `a mayoreo ${formatMoney(f.a_mayoreo)}${f.ultima_compra ? ` · ${corta(f.ultima_compra)}` : ''}`}
              </Text>
            </View>
          </View>
        </Vidrio>
      </Tocable>
    </View>
  );
});

const FilaHistorial = memo(function FilaHistorial({ h, columnas }) {
  const persona = h.employees?.name ? { id: h.employees.id, name: h.employees.name } : null;
  const quien = persona ? shortEmployeeName(persona.name) : h.origen === 'app' ? 'El cliente (app)' : 'Sistema';
  return (
    <View style={{ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 10 }}>
      <Tocable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/mayorista/${h.customer_id}`); }}>
        <Vidrio radio={18}>
          <View style={{ padding: 14, gap: 3 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{h.customers?.name ?? '—'}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${textoDeAccion(h)}${h.nota ? ` — «${h.nota}»` : ''}`}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {persona ? <Avatar empleado={persona} tamano={18} /> : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                {`${quien} · ${fechaHora12(h.created_at, { day: 'numeric', month: 'short' })}`}
              </Text>
            </View>
          </View>
        </Vidrio>
      </Tocable>
    </View>
  );
});

export default function Mayoristas() {
  const [filas, setFilas] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('solicitudes');
  const [busqueda, setBusqueda] = useState('');
  const [soloCumplen, setSoloCumplen] = useState(false);
  const [soloConNombre, setSoloConNombre] = useState(false);
  const [verDescartados, setVerDescartados] = useState(false);
  const [orden, setOrden] = useState('mayoreo');
  const [recargando, setRecargando] = useState(false);
  const columnas = useColumnas();

  const cargar = useCallback(async () => {
    try { setFilas(await fetchMayoristas()); setError(null); }
    catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar la lista.')); setFilas((f) => f ?? []); }
    Promise.resolve(fetchHistorialMayoristas()).then(setHistorial).catch(() => setHistorial([]));
  }, []);
  // Se relee al volver de la ficha: lo que se aprobó o retiró se ve al instante.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const pendientes = useMemo(() => solicitudesPendientes(filas).length, [filas]);
  const lista = useMemo(() => (tab === 'historial'
    ? (historial ?? []).filter((h) => !busqueda || tokenMatch(h.customers?.name ?? '', busqueda))
    : filasDeMayoristas(filas, { tab, busqueda, soloCumplen, orden, soloConNombre, verDescartados })),
  [tab, historial, filas, busqueda, soloCumplen, orden, soloConNombre, verDescartados]);
  const { visibles, scroll } = useEnTramos(lista, 40, `${tab}|${busqueda}|${soloCumplen}|${soloConNombre}|${verDescartados}|${orden}`);

  const grupos = tab === 'historial' ? [] : [
    ...(tab === 'candidatos' ? [
      { id: 'requisito', titulo: 'Requisito', activa: soloCumplen ? 'cumplen' : 'todos', porDefecto: 'todos',
        onCambiar: (v) => setSoloCumplen(v === 'cumplen'),
        opciones: [{ id: 'todos', label: 'Todos los que compraron a mayoreo' }, { id: 'cumplen', label: 'Cumplen el requisito' }] },
      { id: 'ficha', titulo: 'Ficha', activa: soloConNombre ? 'nombre' : 'todas', porDefecto: 'todas',
        onCambiar: (v) => setSoloConNombre(v === 'nombre'),
        opciones: [{ id: 'todas', label: 'Todas las fichas' }, { id: 'nombre', label: 'Con «(4)» o «(5)» en el nombre' }] },
      { id: 'descartados', titulo: 'No aprobados', activa: verDescartados ? 'ver' : 'ocultar', porDefecto: 'ocultar',
        onCambiar: (v) => setVerDescartados(v === 'ver'),
        opciones: [{ id: 'ocultar', label: 'Ocultar los no aprobados' }, { id: 'ver', label: 'Mostrar también los no aprobados' }] },
    ] : []),
    { id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: 'mayoreo', onCambiar: setOrden,
      opciones: ORDENES_MAYORISTAS.map((o) => ({ id: o.value, label: o.label })) },
  ];
  const cargando = tab === 'historial' ? historial == null : filas == null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Clientes Mayoristas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Nombre o documento', onChangeText: (e) => setBusqueda(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <FlatList key={`c${columnas}`} numColumns={columnas} columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        data={cargando ? [] : visibles}
        keyExtractor={(x) => String(tab === 'historial' ? x.id : x.customer_id)}
        renderItem={({ item }) => (tab === 'historial'
          ? <FilaHistorial h={item} columnas={columnas} />
          : <FilaCliente f={item} tab={tab} columnas={columnas} />)}
        {...scroll}
        contentInsetAdjustmentBehavior="automatic" initialNumToRender={12} windowSize={9} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ gap: 12 }}>
            <Segmentos activa={tab} onCambiar={setTab} opciones={[
              { id: 'solicitudes', label: pendientes ? `Solicitudes · ${pendientes}` : 'Solicitudes' },
              { id: 'candidatos', label: 'Candidatos' },
              { id: 'mayoristas', label: 'Mayoristas' },
              { id: 'historial', label: 'Historial' },
            ]} />
            <FiltrosActivos grupos={grupos} />
            {tab === 'candidatos' ? (
              <View style={{ marginHorizontal: 16 }}>
                <Aviso texto="Les vendieron a precio de mayoreo en los últimos 6 meses, o tienen «(4)»/«(5)» en el nombre de la ficha. Cada uno se aprueba o no a mano: nadie entra solo. La cláusula 2.3 pide promedio de $100 al mes en los últimos 3 meses o una factura de $500, con la ficha completa." />
              </View>
            ) : null}
            {!cargando && tab !== 'historial' ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}`}</Text>
            ) : null}
            {cargando && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          </View>
        )}
        ListEmptyComponent={cargando ? null : error ? <ErrorConReintento mensaje={error} onReintentar={() => { setFilas(null); cargar(); }} /> : (
          <Text style={{ color: colorSistema.texto2, fontSize: 16, textAlign: 'center', marginTop: 40, marginHorizontal: 24 }}>
            {tab === 'solicitudes' ? 'No hay solicitudes por resolver' : tab === 'historial' ? 'Sin movimientos. Aquí queda cada solicitud, aprobación, cambio de precio y retiro.' : 'Nadie con ese filtro'}
          </Text>
        )} />
    </>
  );
}
