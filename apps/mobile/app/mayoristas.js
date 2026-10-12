// Clientes Mayoristas, NATIVO — la misma vista del portal
// (`views/mayoristas/MayoristasView.jsx`): Solicitudes, Candidatos, Mayoristas
// e Historial, con la búsqueda por nombre o documento, el filtro del requisito
// (cláusula 2.3) y el orden. Qué entra en cada pestaña, el orden y cómo se lee
// el historial salen del núcleo (`utils/mayoristas`). Tocar un cliente abre su
// ficha (`mayorista/[id]`), donde se propone, se aprueba o rechaza, se cambia
// el precio o se retira.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                  {[f.documento, f.estado === 'solicitado' ? ORIGENES[f.origen] : null, f.ficha_completa ? null : 'Ficha incompleta'].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: f.cumple ? colorSistema.texto : colorSistema.texto2, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.prom_3m)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>promedio 3 meses</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {tab === 'mayoristas' ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${PRECIOS[f.precio] ?? '—'} · ${RANGOS[f.rango]?.nombre ?? '—'}${f.retiro_programado ? ` · se retira el ${corta(f.retiro_programado)}` : ''}`}
                </Text>
              ) : estado ? <Pildora texto={estado.label} color={COLOR_ESTADO[estado.variant] ?? COLOR_ESTADO.neutral} />
                : <Pildora texto={f.cumple ? 'Cumple' : 'No cumple aún'} color={f.cumple ? MARCA.azulClaro : COLOR_ESTADO.neutral} />}
              <Text style={{ color: colorSistema.texto2, fontSize: 12, flex: 1, textAlign: 'right' }} numberOfLines={1}>
                {`a mayoreo ${formatMoney(f.a_mayoreo)}${f.ultima_compra ? ` · ${corta(f.ultima_compra)}` : ''}`}
              </Text>
            </View>
          </View>
        </Vidrio>
      </Tocable>
    </View>
  );
});

const FilaHistorial = memo(function FilaHistorial({ h, columnas }) {
  const quien = h.employees?.name ? shortEmployeeName(h.employees.name) : h.origen === 'app' ? 'El cliente (app)' : 'Sistema';
  return (
    <View style={{ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 10 }}>
      <Tocable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/mayorista/${h.customer_id}`); }}>
        <Vidrio radio={18}>
          <View style={{ padding: 14, gap: 3 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{h.customers?.name ?? '—'}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${textoDeAccion(h)}${h.nota ? ` — «${h.nota}»` : ''}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
              {`${fechaHora12(h.created_at, { day: 'numeric', month: 'short' })} · ${quien}`}
            </Text>
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
  const [soloCumplen, setSoloCumplen] = useState(true);
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
  useEffect(() => { if (tab !== 'candidatos') setSoloCumplen(true); }, [tab]); // eslint-disable-line react-hooks/set-state-in-effect -- el filtro del requisito es sólo de Candidatos

  const pendientes = useMemo(() => solicitudesPendientes(filas).length, [filas]);
  const lista = useMemo(() => (tab === 'historial'
    ? (historial ?? []).filter((h) => !busqueda || tokenMatch(h.customers?.name ?? '', busqueda))
    : filasDeMayoristas(filas, { tab, busqueda, soloCumplen, orden })), [tab, historial, filas, busqueda, soloCumplen, orden]);
  const { visibles, scroll } = useEnTramos(lista, 40, `${tab}|${busqueda}|${soloCumplen}|${orden}`);

  const grupos = tab === 'historial' ? [] : [
    ...(tab === 'candidatos' ? [{ id: 'requisito', titulo: 'Requisito', activa: soloCumplen ? 'cumplen' : 'todos', porDefecto: 'cumplen',
      onCambiar: (v) => setSoloCumplen(v !== 'todos'),
      opciones: [{ id: 'cumplen', label: 'Cumplen el requisito' }, { id: 'todos', label: 'Todos los que compraron a mayoreo' }] }] : []),
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
                <Aviso texto="Compraron a precio de mayoreo en los últimos 6 meses. Para pedirlo deben cumplir la cláusula 2.3: promedio de $100 al mes en los últimos 3 meses o una factura de $500, con la ficha completa. Nadie entra solo: alguien lo propone y Administración decide." />
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
